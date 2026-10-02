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

  describe('upper final decides 1st and 2nd', () => {
    const cfg: DoubleElimConfig = { ...config, finals: 'upper-final-decides' }

    it('keeps the upper final loser out of the lower bracket', () => {
      const { matches } = computeDoubleElim({ seeds: teams(8), config: cfg, results: {} })
      const byId = Object.fromEntries(matches.map((m) => [m.id, m]))
      expect(byId['u2-0'].loserTo).toBeUndefined()
      expect(matches.some((m) => m.side === 'grand-final')).toBe(false)
      expect(matches.filter((m) => m.side === 'lower').map((m) => m.label)).toEqual([
        'Lower round 1',
        'Lower round 1',
        'Lower round 2',
        'Lower round 2',
        'Lower final',
      ])
    })

    it('places the upper finalists 1st and 2nd and the lower winner 3rd', () => {
      // t3 beats t2 in the upper semi, so t2 has to win the lower bracket for 3rd.
      const decide = (m: Match) => {
        const ids = m.slots.map((s) => s.teamId!)
        if (ids.includes('t2') && ids.includes('t3')) return m.side === 'upper' ? 't3' : 't2'
        return favouriteWins(teams(8))(m)
      }
      const state = play(8, cfg, decide)
      expect(state.complete).toBe(true)
      expect(state.ranking.slice(0, 3)).toEqual(['t1', 't3', 't2'])
    })

    it('ranks every size with each team out on its second loss, except the upper finalists', () => {
      for (const n of [3, 4, 5, 6, 8, 11, 16]) {
        for (let s = 0; s < 10; s++) {
          const state = play(n, cfg, randomWinner(s), s)
          expect(state.complete).toBe(true)
          const losses = lossesByTeam(state.matches)
          const [first, second, ...rest] = state.ranking
          expect(losses.get(first) ?? 0).toBe(0)
          expect(losses.get(second)).toBe(1)
          // 3rd may have reached it on a bye with one loss.
          for (const id of rest.slice(1)) expect(losses.get(id)).toBe(2)
          expect(new Set(state.ranking).size).toBe(n)
        }
      }
    })
  })

  describe('no grand final', () => {
    const cfg: DoubleElimConfig = { ...config, finals: 'no-grand-final' }

    it('places the upper winner 1st and the lower winner 2nd', () => {
      const { matches } = computeDoubleElim({ seeds: teams(8), config: cfg, results: {} })
      expect(matches.some((m) => m.side === 'grand-final')).toBe(false)
      expect(matches.find((m) => m.id === 'u2-0')!.loserTo).toEqual({ matchId: 'l3-0', slot: 1 })
      // t2 loses the upper final to t1, then wins the lower final.
      const state = play(8, cfg)
      expect(state.complete).toBe(true)
      expect(state.ranking).toEqual(teams(8))
    })
  })

  describe('finished places', () => {
    it('match the final ranking once the bracket is done', () => {
      for (const finals of ['grand-final', 'no-grand-final', 'upper-final-decides'] as const) {
        for (const n of [3, 5, 8, 11]) {
          for (let s = 0; s < 6; s++) {
            const state = play(n, { ...config, finals, grandFinalReset: s % 2 === 0 }, randomWinner(s), s)
            state.ranking.forEach((id, i) => expect(state.places[id]).toEqual([i + 1, i + 1]))
          }
        }
      }
    })

    it('are known for the upper finalists before the lower bracket finishes', () => {
      const cfg: DoubleElimConfig = { ...config, finals: 'upper-final-decides' }
      const upperOnly = (m: Match) => m.side === 'upper'
      // Play just the upper bracket, favourites winning.
      const state = playUntilDone(
        (results) => computeDoubleElim({ seeds: teams(8), config: cfg, results }),
        (st) => st.matches.filter(upperOnly),
        favouriteWins(teams(8)),
      )
      expect(state.places.t1).toEqual([1, 1])
      expect(state.places.t2).toEqual([2, 2])
      expect(state.places.t5).toBeUndefined()
    })
  })

  it('rejects fewer than 3 teams', () => {
    expect(() => computeDoubleElim({ seeds: teams(2), config, results: {} })).toThrow()
  })
})
