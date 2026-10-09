import { describe, expect, it } from 'vitest'
import { cs2Major } from '../data/presets/cs2-major'
import type { SwissConfig, TournamentResults } from '../types'
import { blankTournament } from './design'
import {
  bracketAsPicked,
  bracketPickStatus,
  cleanBracketCard,
  categoryLabels,
  emptySwissCard,
  pickSwiss,
  scoreBracketCard,
  scoreSwissCard,
  stageStarted,
  swissCardFromResults,
  swissPickCounts,
  swissPickStatus,
} from './pickem'
import { computeTournament, type ComputedStage } from './tournament'

const major = cs2Major.stages[0].config as SwissConfig

describe('Swiss Pick\'em cards', () => {
  it('sizes and labels a Major card like Valve’s', () => {
    expect(swissPickCounts(major, 16)).toEqual({ undefeated: 2, advance: 6, winless: 2 })
    expect(categoryLabels(major)).toEqual({ undefeated: '3-0', advance: '3-1 / 3-2', winless: '0-3' })
    // 8 teams, 2 wins to advance and 2 losses out: 2 go 2-0, 2 advance at 2-1, 2 go 0-2.
    expect(swissPickCounts({ ...major, winsToAdvance: 2, lossesToEliminate: 2 }, 8)).toEqual({ undefeated: 2, advance: 2, winless: 2 })
  })

  it('only counts the exact outcome', () => {
    expect(swissPickStatus('undefeated', major, { wins: 3, losses: 0 })).toBe('correct')
    expect(swissPickStatus('undefeated', major, { wins: 2, losses: 1 })).toBe('wrong')
    expect(swissPickStatus('advance', major, { wins: 3, losses: 0 })).toBe('wrong')
    expect(swissPickStatus('advance', major, { wins: 3, losses: 2 })).toBe('correct')
    expect(swissPickStatus('advance', major, { wins: 2, losses: 0 })).toBe('pending')
    expect(swissPickStatus('advance', major, { wins: 2, losses: 3 })).toBe('wrong')
    expect(swissPickStatus('winless', major, { wins: 0, losses: 3 })).toBe('correct')
    expect(swissPickStatus('winless', major, { wins: 1, losses: 0 })).toBe('wrong')
  })

  it('moves a team between categories and respects each one’s size', () => {
    const counts = swissPickCounts(major, 16)
    let card = pickSwiss(emptySwissCard(), 'a', 'undefeated', counts)
    card = pickSwiss(card, 'b', 'undefeated', counts)
    expect(pickSwiss(card, 'c', 'undefeated', counts)).toBe(card)
    card = pickSwiss(card, 'a', 'winless', counts)
    expect(card).toMatchObject({ undefeated: ['b'], winless: ['a'] })
    expect(pickSwiss(card, 'a', null, counts).winless).toEqual([])
  })

  it('scores against standings, with half a full card needed', () => {
    const stage = { swiss: { standings: { a: { wins: 3, losses: 0 }, b: { wins: 1, losses: 3 }, c: { wins: 2, losses: 1 } } } } as unknown as ComputedStage
    const card = { ...emptySwissCard(), undefeated: ['a', 'c'], winless: ['b'] }
    expect(scoreSwissCard(card, major, stage, 16)).toEqual({ correct: 1, wrong: 2, pending: 0, total: 3, needed: 5 })
  })

  it('fills from finished records, leaving teams still playing out', () => {
    const stage = {
      ranking: ['a', 'b', 'c', 'd'],
      swiss: { standings: { a: { wins: 3, losses: 0 }, b: { wins: 3, losses: 2 }, c: { wins: 1, losses: 1 }, d: { wins: 0, losses: 3 } } },
    } as unknown as ComputedStage
    expect(swissCardFromResults(major, stage, swissPickCounts(major, 16))).toMatchObject({ undefeated: ['a'], advance: ['b'], winless: ['d'] })
  })
})

describe('bracket Pick\'em cards', () => {
  const t = blankTournament()
  const stage = t.stages[0]
  const quarters = computeTournament(t, {}).stages[stage.id].matches.filter((m) => m.round === 0)
  const [qf1, qf2] = quarters
  const [a, b] = qf1.slots.map((s) => s.teamId!)
  const [c] = qf2.slots.map((s) => s.teamId!)

  it('fills later rounds from earlier picks and drops picks that no longer fit', () => {
    const card = { kind: 'bracket' as const, winners: { [qf1.id]: a, [qf2.id]: c } }
    const picked = bracketAsPicked(t, stage, {}, card)
    const semi = picked.matches.find((m) => m.round === 1 && m.slots.some((s) => s.teamId === a))!
    expect(semi.slots.map((s) => s.teamId)).toEqual([a, c])
    // Pick a in the semi, then change the quarter-final: the semi pick goes.
    const withSemi = { ...card, winners: { ...card.winners, [semi.id]: a } }
    const changed = { ...withSemi, winners: { ...withSemi.winners, [qf1.id]: b } }
    expect(cleanBracketCard(changed, bracketAsPicked(t, stage, {}, changed)).winners).toEqual({ [qf1.id]: b, [qf2.id]: c })
  })

  it('scores picks against actual results, including teams knocked out early', () => {
    const actual: TournamentResults = { [stage.id]: { [qf1.id]: { source: 'actual', winnerId: b } } }
    const real = computeTournament(t, actual).stages[stage.id]
    expect(stageStarted(real)).toBe(true)
    const semi = real.matches.find((m) => m.round === 1 && m.slots.some((s) => s.teamId === b))!
    expect(bracketPickStatus(qf1.id, a, real)).toBe('wrong')
    expect(bracketPickStatus(qf1.id, b, real)).toBe('correct')
    expect(bracketPickStatus(semi.id, a, real)).toBe('wrong')
    expect(bracketPickStatus(semi.id, b, real)).toBe('pending')
    const card = { kind: 'bracket' as const, winners: { [qf1.id]: b, [qf2.id]: c, [semi.id]: a } }
    expect(scoreBracketCard(card, real, 7)).toEqual({ correct: 1, wrong: 1, pending: 1, total: 3, needed: 4 })
  })
})
