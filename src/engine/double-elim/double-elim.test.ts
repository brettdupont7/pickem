import { describe, expect, it } from 'vitest'
import type { DoubleElimConfig, Match, TeamId } from '../../types'
import { favouriteWins, playUntilDone, randomWinner, teams } from '../testing'
import { computeDoubleElim, GRAND_FINAL_ID, GRAND_FINAL_RESET_ID } from './double-elim'

const config: DoubleElimConfig = {
  format: 'double-elim',
  bestOf: 3,
  grandFinalBestOf: 5,
  seeding: 'standard',
  grandFinalReset: false,
}

const play = (n: number, cfg: DoubleElimConfig, decide = favouriteWins(teams(n)), randomSeed = 0) =>
  playUntilDone(
    (results) => computeDoubleElim({ seeds: teams(n), config: cfg, results, randomSeed }),
    (s) => s.matches,
    decide,
  )

function lossesByTeam(matches: Match[]) {
  const losses = new Map<TeamId, number>()
  for (const m of matches) {
    if (!m.result || m.result.source === 'bye') continue
    const loser = m.slots.find((s) => s.teamId !== m.result!.winnerId)!.teamId!
    losses.set(loser, (losses.get(loser) ?? 0) + 1)
  }
  return losses
}

describe('computeDoubleElim', () => {
  it('builds the 8-team HLTV-style layout', () => {
    const { matches } = computeDoubleElim({ seeds: teams(8), config, results: {} })
    const labels = matches.map((m) => m.label)
    const count = (label: string) => labels.filter((l) => l === label).length
    expect(count('Upper quarter-finals')).toBe(4)
    expect(count('Upper semi-finals')).toBe(2)
    expect(count('Upper final')).toBe(1)
    expect(count('Lower round 1')).toBe(2)
    expect(count('Lower round 2')).toBe(2)
    expect(count('Lower round 3')).toBe(1)
    expect(count('Lower final')).toBe(1)
    expect(count('Grand final')).toBe(1)
    expect(matches.find((m) => m.id === GRAND_FINAL_ID)!.bestOf).toBe(5)
  })

  it('drops upper losers into the lower bracket', () => {
    const { matches } = computeDoubleElim({ seeds: teams(8), config, results: {} })
    const byId = Object.fromEntries(matches.map((m) => [m.id, m]))
    expect(byId['u0-0'].loserTo).toEqual({ matchId: 'l0-0', slot: 0 })
    // Upper semi-final losers cross over to delay rematches.
    expect(byId['u1-0'].loserTo).toEqual({ matchId: 'l1-1', slot: 1 })
    expect(byId['u1-1'].loserTo).toEqual({ matchId: 'l1-0', slot: 1 })
    expect(byId['u2-0'].loserTo).toEqual({ matchId: 'l3-0', slot: 1 })
    expect(byId['l3-0'].winnerTo).toEqual({ matchId: GRAND_FINAL_ID, slot: 1 })
  })

  it('ranks by elimination round, then seed', () => {
    const state = play(8, config)
    expect(state.complete).toBe(true)
    expect(state.ranking).toEqual(teams(8))
  })

  it('eliminates every team on its second loss', () => {
    for (const n of [3, 4, 5, 6, 8, 11, 16]) {
      for (let s = 0; s < 20; s++) {
        const grandFinalReset = s % 2 === 0
        const state = play(n, { ...config, grandFinalReset }, randomWinner(s), s)
        expect(state.complete).toBe(true)
        const losses = lossesByTeam(state.matches)
        const [champion, runnerUp, ...rest] = state.ranking
        expect(losses.get(champion) ?? 0).toBeLessThanOrEqual(1)
        // Without a reset, an upper-bracket team that loses the grand final goes out on one loss.
        if (grandFinalReset) expect(losses.get(runnerUp)).toBe(2)
        else expect([1, 2]).toContain(losses.get(runnerUp))
        for (const id of rest) expect(losses.get(id)).toBe(2)
      }
    }
  })

  it('plays a reset when the lower-bracket team wins the grand final', () => {
    // t2 loses the upper final to t1, comes through the lower bracket, then beats t1 twice.
    const t2BeatsT1 = (m: Match) => {
      const ids = m.slots.map((s) => s.teamId!)
      if (ids.includes('t1') && ids.includes('t2')) return m.side === 'upper' ? 't1' : 't2'
      return favouriteWins(teams(8))(m)
    }
    const state = play(8, { ...config, grandFinalReset: true }, t2BeatsT1)
    const reset = state.matches.find((m) => m.id === GRAND_FINAL_RESET_ID)!
    expect(reset.slots.map((s) => s.teamId)).toEqual(['t1', 't2'])
    expect(state.ranking.slice(0, 2)).toEqual(['t2', 't1'])
  })

  it('skips the reset when the upper-bracket team wins', () => {
    const state = play(8, { ...config, grandFinalReset: true })
    expect(state.matches.some((m) => m.id === GRAND_FINAL_RESET_ID)).toBe(false)
    expect(state.complete).toBe(true)
  })

  it('crowns the lower-bracket team without a reset when disabled', () => {
    const decide = (m: Match) => (m.id === GRAND_FINAL_ID ? m.slots[1].teamId! : favouriteWins(teams(8))(m))
    const state = play(8, config, decide)
    expect(state.matches.some((m) => m.id === GRAND_FINAL_RESET_ID)).toBe(false)
    expect(state.ranking.slice(0, 2)).toEqual(['t2', 't1'])
  })

  it('rejects fewer than 3 teams', () => {
    expect(() => computeDoubleElim({ seeds: teams(2), config, results: {} })).toThrow()
  })
})
