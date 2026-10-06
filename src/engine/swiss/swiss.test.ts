import { describe, expect, it } from 'vitest'
import type { Match, MatchResult, SwissConfig, TeamId } from '../../types'
import { createRng } from '../random'
import { computeSwiss, pairByMajorTable, startingRatings, type SwissState } from './swiss'

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

describe('live rating pairing', () => {
  const eslSwiss: SwissConfig = { ...cs2Swiss, bestOf: 3, firstRoundPairing: 'fold', pairing: 'rating', tiebreakers: ['rating', 'seed'] }

  it('derives starting ratings from seed order when no team is rated', () => {
    const start = startingRatings(teams(4))
    expect([...start.values()]).toEqual([1537.5, 1512.5, 1487.5, 1462.5])
  })

  it('uses team ratings when any are given, defaulting the rest to 1500', () => {
    const start = startingRatings(teams(3), { t2: 1700 })
    expect([...start.values()]).toEqual([1500, 1700, 1500])
  })

  it('moves ratings by Elo on match results only', () => {
    const results = { 't1|t2': { winnerId: 't2', source: 'pick' as const } }
    const ratings = { t1: 1500, t2: 1500 }
    const state = computeSwiss({ seeds: teams(2), config: { ...eslSwiss, winsToAdvance: 1, lossesToEliminate: 1, firstRoundPairing: 'adjacent' }, results, ratings })
    expect(state.standings.t2.rating).toBe(1516)
    expect(state.standings.t1.rating).toBe(1484)
  })

  it('pairs the highest live rating against the lowest within a record group', () => {
    // Fold: t1-t8, t2-t7, t3-t6, t4-t5. Upsets by t8 and t7 give them big gains.
    const ratings = Object.fromEntries(teams(8).map((id, i) => [id, 1800 - i * 50]))
    const results: Record<string, MatchResult> = {
      't1|t8': { winnerId: 't8', source: 'pick' },
      't2|t7': { winnerId: 't7', source: 'pick' },
      't3|t6': { winnerId: 't3', source: 'pick' },
      't4|t5': { winnerId: 't4', source: 'pick' },
    }
    const state = computeSwiss({ seeds: teams(8), config: eslSwiss, results, ratings })
    const winners = state.rounds[1].filter((m) => m.label === '1-0').map((m) => m.slots.map((s) => s.teamId))
    // 1-0 live ratings: t3 1650+, t4 1630+, t7 ~1543, t8 ~1491.
    expect(winners).toEqual([
      ['t3', 't8'],
      ['t4', 't7'],
    ])
  })

  it('plays out a 16-team stage without rematches', () => {
    const state = playOut(teams(16), eslSwiss, randomWinner(7))
    expectNoRematches(state)
  })
})

describe('Major priority table', () => {
  const six = ['s1', 's2', 's3', 's4', 's5', 's6']
  const playedPairs = (...pairs: [string, string][]) => (a: string, b: string) =>
    pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))

  it('takes the top-most row without a rematch', () => {
    expect(pairByMajorTable(six, () => false)).toEqual([['s1', 's6'], ['s2', 's5'], ['s3', 's4']])
    // 2v5 already played: row 2.
    expect(pairByMajorTable(six, playedPairs(['s2', 's5']))).toEqual([['s1', 's6'], ['s2', 's4'], ['s3', 's5']])
    // 1v6 and 2v4 played: row 3 (1v5 2v6 3v4), where highest-v-lowest search would keep 1v6 and play 2v3.
    expect(pairByMajorTable(six, playedPairs(['s1', 's6'], ['s2', 's4']))).toEqual([['s1', 's5'], ['s2', 's6'], ['s3', 's4']])
    expect(pairByMajorTable(six.slice(0, 4), () => false)).toBeNull()
  })

  it('pairs 6-team groups from round 4 by the table, over a full stage', () => {
    const config: SwissConfig = { ...cs2Swiss, majorPriorityTable: true }
    let checked = 0
    for (let seed = 0; seed < 30; seed++) {
      const final = playOut(teams(16), config, randomWinner(seed), seed)
      expectNoRematches(final)
      const results = Object.fromEntries(final.rounds.flat().filter((m) => m.result).map((m) => [m.id, m.result!]))
      for (let r = 3; r < final.rounds.length; r++) {
        // Standings before round r, from only the earlier rounds' results.
        const earlier = new Set(final.rounds.slice(0, r).flat().map((m) => m.id))
        const before = computeSwiss({ seeds: teams(16), config, results: Object.fromEntries(Object.entries(results).filter(([id]) => earlier.has(id))), randomSeed: seed })
        const played = (a: TeamId, b: TeamId) => before.standings[a].opponents.includes(b)
        const groups = new Map<string, Match[]>()
        for (const m of final.rounds[r]) groups.set(m.label!, [...(groups.get(m.label!) ?? []), m])
        for (const [label, matches] of groups) {
          if (matches.length !== 3) continue
          const inGroup = new Set(matches.flatMap((m) => m.slots.map((s) => s.teamId!)))
          const ranked = before.ranking.filter((id) => inGroup.has(id))
          expect(matches.map((m) => m.slots.map((s) => s.teamId)), `round ${r + 1} ${label}`).toEqual(pairByMajorTable(ranked, played))
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(30)
  })
})
