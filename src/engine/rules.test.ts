import { describe, expect, it } from 'vitest'
import { cs2Rules, footballRules, valorantRules } from '../data/presets/rules'
import type { GameScoring } from '../types'
import { createRng } from './random'
import { resolveReport, setGame } from './results'
import { firstToScoreModel, freeScoreModel, gameScoreStatus, scoreModelFor, termsFor } from './rules'

const state = (scoring: GameScoring, score: [number, number], inProgress?: boolean) => {
  const status = gameScoreStatus(scoring, score, inProgress)
  return status.state === 'final' ? `final:${status.winnerSlot}` : status.state
}

describe('gameScoreStatus', () => {
  it.each([
    [[13, 7], 'final:0'],
    [[11, 13], 'final:1'],
    [[7, 4], 'in-progress'],
    [[12, 12], 'in-progress'],
    [[13, 12], 'in-progress'],
    [[16, 14], 'final:0'],
    [[15, 15], 'in-progress'],
    [[19, 17], 'final:0'],
    [[17, 19], 'final:1'],
    [[16, 12], 'final:0'],
    [[14, 13], 'in-progress'],
    [[13, 11], 'final:0'],
    [[14, 10], 'invalid'],
    [[16, 13], 'final:0'],
    [[17, 13], 'invalid'],
    [[17, 12], 'invalid'],
  ] as const)('CS2 %j -> %s', (score, expected) => {
    expect(state(cs2Rules.scoring, [...score])).toBe(expected)
  })

  it.each([
    [[13, 11], 'final:0'],
    [[14, 12], 'final:0'],
    [[13, 12], 'in-progress'],
    [[13, 13], 'in-progress'],
    [[15, 13], 'final:0'],
    [[14, 11], 'invalid'],
  ] as const)('Valorant %j -> %s', (score, expected) => {
    expect(state(valorantRules.scoring, [...score])).toBe(expected)
  })

  it('handles first-to without overtime', () => {
    const raceTo5: GameScoring = { kind: 'first-to', target: 5 }
    expect(state(raceTo5, [5, 4])).toBe('final:0')
    expect(state(raceTo5, [4, 4])).toBe('in-progress')
    expect(state(raceTo5, [6, 4])).toBe('invalid')
  })

  it('treats any unequal free score as final unless marked in progress', () => {
    expect(state(footballRules.scoring, [27, 24])).toBe('final:0')
    expect(state(footballRules.scoring, [27, 24], true)).toBe('in-progress')
    expect(state(footballRules.scoring, [17, 17])).toBe('in-progress')
    expect(state(footballRules.scoring, [-1, 3])).toBe('invalid')
  })
})

describe('score models', () => {
  it.each([
    ['CS2', cs2Rules.scoring],
    ['Valorant', valorantRules.scoring],
    ['race to 21, no overtime', { kind: 'first-to', target: 21 } as GameScoring],
  ])('%s scores are always final for the winner', (_, scoring) => {
    if (scoring.kind !== 'first-to') throw new Error('expected first-to')
    const model = firstToScoreModel(scoring.target, scoring.overtime)
    const rng = createRng(4)
    for (let i = 0; i < 3000; i++) {
      const { winner, loser } = model(0.3 + rng() * 0.4, rng)
      expect(state(scoring, [winner, loser])).toBe('final:0')
    }
  })

  it('produces football-like scores', () => {
    const model = freeScoreModel(23, 9)
    const rng = createRng(2)
    const scores = Array.from({ length: 2000 }, () => model(0.5, rng))
    for (const { winner, loser } of scores) expect(winner).toBeGreaterThan(loser)
    const mean = scores.reduce((sum, s) => sum + s.winner + s.loser, 0) / (2 * scores.length)
    expect(mean).toBeGreaterThan(18)
    expect(mean).toBeLessThan(28)
  })

  it('only simulates free scores when the rules give typical values', () => {
    expect(scoreModelFor({ kind: 'free' })).toBeNull()
    expect(scoreModelFor(footballRules.scoring)).not.toBeNull()
  })
})

describe('rules in results', () => {
  const match = { slots: [{ teamId: 'a' }, { teamId: 'b' }] as [{ teamId: string }, { teamId: string }], bestOf: 3 }

  it('does not count a CS2 map that is still being played', () => {
    const report = setGame(match, undefined, 0, { name: 'Mirage', score: [7, 4] }, { scoring: cs2Rules.scoring })
    expect(report?.score).toEqual({ a: 0, b: 0 })
    const finished = setGame(match, report, 0, { name: 'Mirage', score: [13, 4] }, { scoring: cs2Rules.scoring })
    expect(finished?.score).toEqual({ a: 1, b: 0 })
  })

  it('judges the same score differently under different rules', () => {
    const report = { source: 'actual' as const, games: [{ score: { a: 7, b: 4 } }] }
    expect(resolveReport(report, 'a', 'b', 1, cs2Rules.scoring).result).toBeUndefined()
    expect(resolveReport(report, 'a', 'b', 1, footballRules.scoring).result?.winnerId).toBe('a')
  })

  it('supports a best-of-7', () => {
    const report = { source: 'actual' as const, score: { a: 4, b: 3 } }
    expect(resolveReport(report, 'a', 'b', 7).result?.winnerId).toBe('a')
    expect(resolveReport({ ...report, score: { a: 3, b: 3 } }, 'a', 'b', 7).result).toBeUndefined()
  })

  it('names things per sport, with neutral defaults', () => {
    expect(termsFor(cs2Rules)).toEqual({ game: 'Map', games: 'Maps', point: 'Round', points: 'Rounds' })
    expect(termsFor(footballRules).game).toBe('Game')
  })
})
