import { describe, expect, it } from 'vitest'
import type { SingleElimConfig } from '../../types'
import { favouriteWins, playUntilDone, randomWinner, teams } from '../testing'
import { computeSingleElim, singleElimMatchId, THIRD_PLACE_MATCH_ID } from './single-elim'

const config: SingleElimConfig = {
  format: 'single-elim',
  bestOf: 3,
  bestOfFromFinal: [5],
  seeding: 'standard',
  thirdPlaceMatch: false,
}

const play = (n: number, cfg: SingleElimConfig, decide = favouriteWins(teams(n)), randomSeed = 0) =>
  playUntilDone(
    (results) => computeSingleElim({ seeds: teams(n), config: cfg, results, randomSeed }),
    (s) => s.matches,
    decide,
  )

const firstRound = (n: number, cfg: SingleElimConfig) =>
  computeSingleElim({ seeds: teams(n), config: cfg, results: {} })
    .matches.filter((m) => m.round === 0 && m.side === 'main')
    .map((m) => m.slots.map((s) => s.teamId))

describe('computeSingleElim', () => {
  it('seeds 8 teams 1v8, 4v5, 2v7, 3v6', () => {
    expect(firstRound(8, config)).toEqual([
      ['t1', 't8'],
      ['t4', 't5'],
      ['t2', 't7'],
      ['t3', 't6'],
    ])
  })

  it('seeds as listed', () => {
    expect(firstRound(4, { ...config, seeding: 'as-listed' })).toEqual([
      ['t1', 't2'],
      ['t3', 't4'],
    ])
  })

  it('links winners forward', () => {
    const { matches } = computeSingleElim({ seeds: teams(8), config, results: {} })
    const byId = Object.fromEntries(matches.map((m) => [m.id, m]))
    expect(byId['r0-1'].winnerTo).toEqual({ matchId: 'r1-0', slot: 1 })
    expect(byId['r2-0'].winnerTo).toBeUndefined()
    expect(byId['r0-0'].loserTo).toBeUndefined()
  })

  it('labels rounds and applies best-of overrides', () => {
    const { matches } = computeSingleElim({ seeds: teams(16), config, results: {} })
    expect([...new Set(matches.map((m) => `${m.label} Bo${m.bestOf}`))]).toEqual([
      'Round of 16 Bo3',
      'Quarter-finals Bo3',
      'Semi-finals Bo3',
      'Final Bo5',
    ])
  })

  it('ranks by elimination round, then seed', () => {
    const state = play(8, config)
    expect(state.complete).toBe(true)
    expect(state.ranking).toEqual(teams(8))
  })

  it('plays a third-place match', () => {
    // t4 upsets t3 for third.
    const decide = favouriteWins(['t1', 't2', 't4', 't3', 't5', 't6', 't7', 't8'])
    const state = play(8, { ...config, thirdPlaceMatch: true }, decide)
    const third = state.matches.find((m) => m.id === THIRD_PLACE_MATCH_ID)!
    expect(third.slots.map((s) => s.teamId).sort()).toEqual(['t3', 't4'])
    expect(state.ranking.slice(0, 4)).toEqual(['t1', 't2', 't4', 't3'])
  })

  it.each([3, 5, 6, 7, 12])('gives top seeds byes with %i teams', (n) => {
    const state = play(n, config)
    const byes = state.matches.filter((m) => m.result?.source === 'bye')
    const byeTeams = byes.map((m) => m.result!.winnerId)
    expect(byeTeams.sort()).toEqual(teams(n).slice(0, 2 ** Math.ceil(Math.log2(n)) - n).sort())
    expect(state.complete).toBe(true)
    expect(state.ranking[0]).toBe('t1')
    expect(new Set(state.ranking).size).toBe(n)
  })

  it('pairs every bye with a team when seeding as listed', () => {
    const { matches } = computeSingleElim({ seeds: teams(5), config: { ...config, seeding: 'as-listed' }, results: {} })
    expect(matches.filter((m) => m.slots.every((s) => s.isBye))).toHaveLength(0)
  })

  it('drops downstream results that no longer fit', () => {
    const results = {
      [singleElimMatchId(0, 0)]: { winnerId: 't1', source: 'pick' as const },
      [singleElimMatchId(0, 1)]: { winnerId: 't4', source: 'pick' as const },
      [singleElimMatchId(1, 0)]: { winnerId: 't1', source: 'pick' as const },
    }
    expect(computeSingleElim({ seeds: teams(8), config, results }).matches[4].result?.winnerId).toBe('t1')
    results[singleElimMatchId(0, 0)] = { winnerId: 't8', source: 'pick' }
    const state = computeSingleElim({ seeds: teams(8), config, results })
    expect(state.matches[4].slots.map((s) => s.teamId)).toEqual(['t8', 't4'])
    expect(state.matches[4].result).toBeUndefined()
  })

  it('finishes with random results and random seeding', () => {
    for (let s = 0; s < 30; s++) {
      const state = play(11, { ...config, seeding: 'random', thirdPlaceMatch: true }, randomWinner(s), s)
      expect(state.complete).toBe(true)
      expect(new Set(state.ranking).size).toBe(11)
    }
  })

  it('rejects too few or duplicate teams', () => {
    expect(() => computeSingleElim({ seeds: ['t1'], config, results: {} })).toThrow()
    expect(() => computeSingleElim({ seeds: ['t1', 't1'], config, results: {} })).toThrow()
  })
})

describe('reseeding', () => {
  const reseed: SingleElimConfig = { ...config, bestOf: 1, bestOfFromFinal: undefined, reseed: true }

  it('pairs the best remaining seed with the worst after each round', () => {
    // 7 teams: the 1 seed has a bye; 7 upsets 2, so the 1 seed meets the 7 seed next.
    const decide = favouriteWins(['t1', 't7', 't3', 't4', 't5', 't6', 't2'])
    let state = computeSingleElim({ seeds: teams(7), config: reseed, results: {} })
    expect(state.matches.filter((m) => m.round === 1).every((m) => m.slots.every((s) => s.teamId === null))).toBe(true)

    state = play(7, reseed, decide)
    const divisional = state.matches.filter((m) => m.round === 1).map((m) => m.slots.map((s) => s.teamId))
    expect(divisional).toEqual([
      ['t1', 't7'],
      ['t3', 't4'],
    ])
    expect(state.complete).toBe(true)
    expect(state.ranking[0]).toBe('t1')
  })

  it('differs from a fixed bracket after an upset', () => {
    const decide = favouriteWins(['t1', 't7', 't3', 't4', 't5', 't6', 't2'])
    const fixed = play(7, { ...reseed, reseed: false }, decide)
    const fixedPairs = fixed.matches.filter((m) => m.round === 1).map((m) => m.slots.map((s) => s.teamId))
    expect(fixedPairs).toEqual([
      ['t1', 't4'],
      ['t7', 't3'],
    ])
  })

  it('finishes with random results', () => {
    for (let s = 0; s < 30; s++) {
      const state = play(14, { ...reseed, thirdPlaceMatch: true }, randomWinner(s), s)
      expect(state.complete).toBe(true)
      expect(new Set(state.ranking).size).toBe(14)
    }
  })

  it('uses custom round names', () => {
    const { matches } = computeSingleElim({
      seeds: teams(7),
      config: { ...reseed, roundNamesFromFinal: ['Conference Championship', 'Divisional Round', 'Wild Card Round'] },
      results: {},
    })
    expect([...new Set(matches.map((m) => m.label))]).toEqual([
      'Wild Card Round',
      'Divisional Round',
      'Conference Championship',
    ])
  })

  it('knows finished places before the bracket ends', () => {
    // One quarter-final played: its loser is somewhere in 5th-8th.
    const one = computeSingleElim({ seeds: teams(8), config, results: { 'r0-0': { source: 'pick', winnerId: 't1' } } })
    expect(one.places).toEqual({ t8: [5, 8] })
    // All quarter-finals played: the losers split by seed.
    const results = Object.fromEntries(['t1', 't4', 't2', 't3'].map((winnerId, i) => [`r0-${i}`, { source: 'pick' as const, winnerId }]))
    const all = computeSingleElim({ seeds: teams(8), config, results })
    expect(all.places).toEqual({ t5: [5, 5], t6: [6, 6], t7: [7, 7], t8: [8, 8] })
  })

  it('matches finished places to the final ranking', () => {
    for (const n of [2, 3, 6, 8, 13]) {
      for (const thirdPlaceMatch of [false, true]) {
        const state = play(n, { ...config, thirdPlaceMatch }, randomWinner(n))
        state.ranking.forEach((id, i) => expect(state.places[id]).toEqual([i + 1, i + 1]))
      }
    }
  })
})
