import { describe, expect, it } from 'vitest'
import type { BestOf, Match, MatchReport, SingleElimConfig } from '../types'
import {
  describeMatch,
  pickWinner,
  removeGame,
  resolveReport,
  seriesScoreError,
  setGame,
  setSeriesScore,
} from './results'
import { computeSingleElim } from './single-elim'
import { teams } from './testing'

const match = (bestOf: BestOf = 3, a = 'navi', b = 'faze'): Match => ({
  id: 'm',
  side: 'main',
  round: 0,
  bestOf,
  slots: [{ teamId: a }, { teamId: b }],
})

const resolve = (report: MatchReport | undefined, bestOf: BestOf = 3) => resolveReport(report, 'navi', 'faze', bestOf)

describe('resolveReport', () => {
  it('accepts a bare winner', () => {
    expect(resolve({ source: 'pick', winnerId: 'navi' }).result?.winnerId).toBe('navi')
  })

  it('derives the winner from a series score', () => {
    expect(resolve({ source: 'actual', score: { navi: 1, faze: 2 } }).result?.winnerId).toBe('faze')
  })

  it('treats a partial score as in progress', () => {
    const { report, result } = resolve({ source: 'actual', score: { navi: 1, faze: 0 } })
    expect(result).toBeUndefined()
    expect(report?.score).toEqual({ navi: 1, faze: 0 })
  })

  it('drops impossible scores', () => {
    expect(resolve({ source: 'pick', score: { navi: 3, faze: 0 } })).toEqual({})
    expect(resolve({ source: 'pick', score: { navi: 2, faze: 2 } })).toEqual({})
  })

  it('derives the score and winner from games, ignoring games after the clinch', () => {
    const { report, result } = resolve({
      source: 'actual',
      games: [
        { name: 'Mirage', score: { navi: 13, faze: 7 } },
        { name: 'Nuke', score: { navi: 13, faze: 11 } },
        { name: 'Inferno', score: { navi: 2, faze: 13 } },
      ],
    })
    expect(result?.winnerId).toBe('navi')
    expect(report?.score).toEqual({ navi: 2, faze: 0 })
    expect(report?.games).toHaveLength(2)
  })

  it('does not count a game without a decisive score', () => {
    const { result, report } = resolve({ source: 'actual', games: [{ score: { navi: 13, faze: 4 } }, { score: { navi: 8, faze: 8 } }] })
    expect(result).toBeUndefined()
    expect(report?.score).toEqual({ navi: 1, faze: 0 })
  })

  it('lets the score overrule a contradicting pick', () => {
    expect(resolve({ source: 'pick', winnerId: 'navi', score: { navi: 0, faze: 2 } }).result?.winnerId).toBe('faze')
  })

  it('keeps a pick but drops scores for a different opponent', () => {
    const report: MatchReport = { source: 'pick', winnerId: 'navi', score: { navi: 2, vitality: 1 } }
    const { result } = resolve(report)
    expect(result).toEqual({ source: 'pick', winnerId: 'navi' })
  })

  it('ignores a winner who is not in the match', () => {
    expect(resolve({ source: 'pick', winnerId: 'vitality' })).toEqual({})
  })
})

describe('seriesScoreError', () => {
  it.each([
    [3, [2, 1], null],
    [3, [1, 0], null],
    [1, [1, 0], null],
    [3, [3, 0], 'A Bo3 ends when a team wins 2'],
    [5, [3, 3], 'Only one team can win 3'],
    [3, [-1, 2], 'Scores must be whole numbers of 0 or more'],
  ] as const)('Bo%i %j -> %s', (bestOf, score, error) => {
    expect(seriesScoreError(bestOf, [...score])).toBe(error)
  })
})

describe('edit helpers', () => {
  it('toggles a one-click pick', () => {
    const m = match()
    const picked = pickWinner(m, undefined, 'navi')
    expect(picked).toEqual({ source: 'pick', winnerId: 'navi' })
    expect(pickWinner(m, picked, 'navi')).toBeUndefined()
    expect(pickWinner(m, picked, 'faze')).toEqual({ source: 'pick', winnerId: 'faze' })
  })

  it('keeps games entered so far when picking a winner', () => {
    const m = match()
    const live = setGame(m, undefined, 0, { score: [13, 9] })
    expect(pickWinner(m, live, 'faze')).toMatchObject({ winnerId: 'faze', games: [{ score: { navi: 13, faze: 9 } }] })
  })

  it('replaces the scores when overturning a decided match', () => {
    const m = match()
    const decided = setSeriesScore(m, [2, 0])
    expect(pickWinner(m, decided, 'faze')).toEqual({ source: 'pick', winnerId: 'faze' })
  })

  it('sets a series score in slot order and stores the winner', () => {
    expect(setSeriesScore(match(), [1, 2], { source: 'actual' })).toEqual({
      source: 'actual',
      winnerId: 'faze',
      score: { navi: 1, faze: 2 },
    })
    expect(() => setSeriesScore(match(), [3, 1])).toThrow('A Bo3 ends when a team wins 2')
  })

  it('builds a series map by map', () => {
    const m = match()
    let report = setGame(m, undefined, 0, { name: 'Ancient', score: [13, 7] })
    report = setGame(m, report, 1, { name: 'Anubis', score: [10, 13] })
    expect(resolveReport(report, 'navi', 'faze', 3).result).toBeUndefined()
    report = setGame(m, report, 2, { name: 'Dust2', score: [16, 14] })
    expect(report).toMatchObject({ winnerId: 'navi', score: { navi: 2, faze: 1 } })
    expect(report?.games?.map((g) => g.name)).toEqual(['Ancient', 'Anubis', 'Dust2'])
  })

  it('accepts a half-typed game score as in progress', () => {
    const report = setGame(match(), undefined, 0, { score: [13, null] })
    expect(report).toEqual({ source: 'pick', score: { navi: 0, faze: 0 }, games: [{ score: { navi: 13 } }] })
  })

  it('records a forfeit game by winner', () => {
    expect(setGame(match(1), undefined, 0, { winnerSlot: 1 })).toMatchObject({ winnerId: 'faze' })
  })

  it('rejects skipping a game or exceeding the best-of', () => {
    expect(() => setGame(match(), undefined, 1, { score: [13, 0] })).toThrow()
    expect(() => setGame(match(1), { source: 'pick', games: [{ score: { navi: 13, faze: 0 } }] }, 1, {})).toThrow()
  })

  it('removes a game and re-derives the result', () => {
    const m = match()
    let report = setGame(m, undefined, 0, { score: [13, 7] })
    report = setGame(m, report, 1, { score: [13, 7] })
    expect(report?.winnerId).toBe('navi')
    report = removeGame(m, report, 0)
    expect(report).toMatchObject({ score: { navi: 1, faze: 0 } })
    expect(report?.winnerId).toBeUndefined()
    expect(removeGame(m, report, 0)).toBeUndefined()
  })

  it('refuses to record a result before both teams are known', () => {
    const m: Match = { ...match(), slots: [{ teamId: 'navi' }, { teamId: null }] }
    expect(() => pickWinner(m, undefined, 'navi')).toThrow()
  })
})

describe('describeMatch', () => {
  it('reports scores in slot order even when stored the other way round', () => {
    const m = match(3, 'faze', 'navi')
    const report = setSeriesScore(match(), [2, 1])!
    const view = describeMatch({ ...m, ...resolveReport(report, 'faze', 'navi', 3) })
    expect(view).toMatchObject({ status: 'decided', teams: ['faze', 'navi'], seriesScore: [1, 2], winnerSlot: 1 })
  })

  it('shows a match in progress as live with per-game scores', () => {
    const m = match()
    const report = setGame(m, undefined, 0, { name: 'Mirage', score: [13, 11] })
    const view = describeMatch({ ...m, ...resolveReport(report, 'navi', 'faze', 3) })
    expect(view).toMatchObject({
      status: 'live',
      seriesScore: [1, 0],
      winnerSlot: null,
      games: [{ name: 'Mirage', score: [13, 11], winnerSlot: 0 }],
    })
  })

  it('distinguishes tbd, ready and bye', () => {
    expect(describeMatch(match()).status).toBe('ready')
    expect(describeMatch({ ...match(), slots: [{ teamId: 'navi' }, { teamId: null }] }).status).toBe('tbd')
    expect(describeMatch({ ...match(), slots: [{ teamId: 'navi' }, { teamId: null, isBye: true }] }).status).toBe('bye')
  })
})

describe('engines use reports', () => {
  const config: SingleElimConfig = { format: 'single-elim', bestOf: 3, seeding: 'standard', thirdPlaceMatch: false }

  it('advances on a series score and holds a live match back', () => {
    const state = computeSingleElim({
      seeds: teams(4),
      config,
      results: {
        'r0-0': { source: 'actual', score: { t1: 0, t4: 2 } },
        'r0-1': { source: 'actual', score: { t2: 1, t3: 1 } },
      },
    })
    const final = state.matches.find((m) => m.id === 'r1-0')!
    expect(final.slots.map((s) => s.teamId)).toEqual(['t4', null])
    expect(describeMatch(state.matches[1]).status).toBe('live')
  })
})
