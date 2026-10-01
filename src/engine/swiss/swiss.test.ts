import { describe, expect, it } from 'vitest'
import type { Match, MatchResult, SwissConfig, TeamId } from '../../types'
import { createRng } from '../random'
import { computeSwiss, type SwissState } from './swiss'

const cs2Swiss: SwissConfig = {
  format: 'swiss',
  winsToAdvance: 3,
  lossesToEliminate: 3,
  bestOf: 1,
  advancementBestOf: 3,
  eliminationBestOf: 3,
  firstRoundPairing: 'high-low',
  pairing: 'buchholz',
  avoidRematches: true,
  tiebreakers: ['buchholz', 'seed'],
}

const teams = (n: number): TeamId[] => Array.from({ length: n }, (_, i) => `t${i + 1}`)

type Decide = (match: Match, seeds: TeamId[]) => TeamId

const higherSeedWins: Decide = (m, seeds) => {
  const [a, b] = m.slots.map((s) => s.teamId!)
  return seeds.indexOf(a) < seeds.indexOf(b) ? a : b
}

const randomWinner = (seed: number): Decide => {
  const rng = createRng(seed)
  return (m) => m.slots[rng() < 0.5 ? 0 : 1].teamId!
}

/** Fills in results round by round until the stage is complete. */
function playOut(seeds: TeamId[], config: SwissConfig, decide: Decide, randomSeed = 0): SwissState {
  const results: Record<string, MatchResult> = {}
  for (let guard = 0; guard < 50; guard++) {
    const state = computeSwiss({ seeds, config, results, randomSeed })
    if (state.complete) return state
    for (const m of state.rounds.at(-1)!) {
      if (!m.result) results[m.id] = { winnerId: decide(m, seeds), source: 'pick' }
    }
  }
  throw new Error('Swiss stage did not finish')
}

const realMatches = (state: SwissState) => state.rounds.flat().filter((m) => m.slots[1].teamId !== null)

const recordCounts = (state: SwissState) => {
  const counts: Record<string, number> = {}
  for (const s of Object.values(state.standings)) {
    const key = `${s.wins}-${s.losses}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function expectNoRematches(state: SwissState) {
  const seen = new Set<string>()
  for (const m of realMatches(state)) {
    const key = m.slots.map((s) => s.teamId).sort().join('|')
    expect(seen.has(key), `rematch ${key}`).toBe(false)
    seen.add(key)
  }
}

describe('computeSwiss', () => {
  it('stops at the first round without results', () => {
    const state = computeSwiss({ seeds: teams(16), config: cs2Swiss, results: {} })
    expect(state.rounds).toHaveLength(1)
    expect(state.rounds[0]).toHaveLength(8)
    expect(state.complete).toBe(false)
    expect(Object.values(state.status).every((s) => s === 'active')).toBe(true)
  })

  it.each([
    ['high-low', [['t1', 't9'], ['t2', 't10'], ['t8', 't16']]],
    ['fold', [['t1', 't16'], ['t2', 't15'], ['t8', 't9']]],
    ['adjacent', [['t1', 't2'], ['t3', 't4'], ['t15', 't16']]],
  ] as const)('pairs round 1 %s', (firstRoundPairing, expected) => {
    const state = computeSwiss({ seeds: teams(16), config: { ...cs2Swiss, firstRoundPairing }, results: {} })
    const pairs = state.rounds[0].map((m) => m.slots.map((s) => s.teamId))
    for (const pair of expected) expect(pairs).toContainEqual(pair)
  })

  it('plays a 16-team 3/3 stage like a CS2 Major', () => {
    const state = playOut(teams(16), cs2Swiss, higherSeedWins)
    expect(state.rounds).toHaveLength(5)
    expect(recordCounts(state)).toEqual({ '3-0': 2, '3-1': 3, '3-2': 3, '2-3': 3, '1-3': 3, '0-3': 2 })
    expect(state.ranking.slice(0, 8).every((id) => state.status[id] === 'advanced')).toBe(true)
    expect(state.ranking.slice(8).every((id) => state.status[id] === 'eliminated')).toBe(true)
    expectNoRematches(state)
  })

  it('ranks by record, then tiebreakers', () => {
    const state = playOut(teams(16), cs2Swiss, higherSeedWins)
    const records = state.ranking.map((id) => state.standings[id].wins - state.standings[id].losses)
    expect(records).toEqual([...records].sort((a, b) => b - a))
    expect(state.ranking.slice(0, 2).sort()).toEqual(['t1', 't2'])
  })

  it('uses Bo3 only when advancement or elimination is on the line', () => {
    const state = playOut(teams(16), cs2Swiss, higherSeedWins)
    for (const m of realMatches(state)) {
      const [w, l] = m.label!.split('-').map(Number)
      expect(m.bestOf).toBe(w === 2 || l === 2 ? 3 : 1)
    }
  })

  it('never rematches with random results', () => {
    for (let s = 0; s < 50; s++) {
      expectNoRematches(playOut(teams(16), cs2Swiss, randomWinner(s), s))
    }
  })

  it.each([
    [8, 2, 2],
    [12, 3, 3],
    [32, 4, 4],
    [16, 3, 2],
    [10, 1, 1],
  ])('finishes %i teams with %i wins / %i losses', (n, winsToAdvance, lossesToEliminate) => {
    const config = { ...cs2Swiss, winsToAdvance, lossesToEliminate }
    for (let s = 0; s < 20; s++) {
      const state = playOut(teams(n), config, randomWinner(s), s)
      expect(state.rounds.length).toBeLessThanOrEqual(winsToAdvance + lossesToEliminate - 1)
      for (const st of Object.values(state.standings)) {
        expect(st.wins === winsToAdvance || st.losses === lossesToEliminate).toBe(true)
      }
    }
  })

  it('gives byes with an odd team count, one per team where possible', () => {
    for (let s = 0; s < 20; s++) {
      const state = playOut(teams(15), cs2Swiss, randomWinner(s), s)
      const byes = state.rounds.flat().filter((m) => m.result?.source === 'bye')
      const byeTeams = byes.map((m) => m.slots[0].teamId)
      expect(byes.length).toBeGreaterThan(0)
      expect(new Set(byeTeams).size).toBe(byeTeams.length)
    }
  })

  it('ignores results whose winner is not in the match', () => {
    const first = computeSwiss({ seeds: teams(4), config: cs2Swiss, results: {} })
    const id = first.rounds[0][0].id
    const state = computeSwiss({
      seeds: teams(4),
      config: cs2Swiss,
      results: { [id]: { winnerId: 'nobody', source: 'pick' } },
    })
    expect(state.rounds[0][0].result).toBeUndefined()
  })

  it('replays random pairings identically for the same seed', () => {
    const config: SwissConfig = { ...cs2Swiss, firstRoundPairing: 'random', pairing: 'random' }
    const a = playOut(teams(16), config, higherSeedWins, 42)
    const b = playOut(teams(16), config, higherSeedWins, 42)
    expect(a.rounds.map((r) => r.map((m) => m.id))).toEqual(b.rounds.map((r) => r.map((m) => m.id)))
  })

  it('rejects invalid input', () => {
    expect(() => computeSwiss({ seeds: ['t1'], config: cs2Swiss, results: {} })).toThrow()
    expect(() => computeSwiss({ seeds: ['t1', 't1'], config: cs2Swiss, results: {} })).toThrow()
    expect(() =>
      computeSwiss({ seeds: teams(4), config: { ...cs2Swiss, winsToAdvance: 0 }, results: {} }),
    ).toThrow()
  })
})
