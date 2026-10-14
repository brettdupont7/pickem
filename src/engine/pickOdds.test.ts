import { describe, expect, it } from 'vitest'
import { cs2Major } from '../data/presets/cs2-major'
import { blankTournament } from './design'
import { cardOdds, createOutcomeSampler, favouriteSwissCard, pickedSetOdds, pickKey, type OutcomeSamples } from './pickOdds'
import { emptySwissCard, swissPickCounts } from './pickem'
import type { SwissConfig } from '../types'
import type { ComputedStage } from './tournament'

const stage = cs2Major.stages[0]
const config = stage.config as SwissConfig
const counts = swissPickCounts(config, 16)

/** Samples where each team's record is given per simulation. */
const swissSamples = (records: Record<string, [number, number]>[]): OutcomeSamples =>
  records.map((r) => ({ [stage.id]: { ranking: [], records: r, winners: {} } }))

describe('createOutcomeSampler', () => {
  it('keeps every simulation’s outcome', () => {
    const t = blankTournament()
    const sampler = createOutcomeSampler(t, {}, { seed: 1 })
    sampler.run(20)
    const samples = sampler.samples()
    expect(samples).toHaveLength(20)
    expect(samples[0][t.stages[0].id].ranking).toHaveLength(8)
    expect(Object.keys(samples[0][t.stages[0].id].winners)).toHaveLength(7)
  })
})

describe('cardOdds', () => {
  it('gives each pick’s chance, the expected score, the chance to pass and each group’s chance', () => {
    const samples = swissSamples([
      { a: [3, 0], b: [3, 1], c: [0, 3] },
      { a: [3, 1], b: [3, 2], c: [0, 3] },
      { a: [3, 0], b: [0, 3], c: [1, 3] },
      { a: [3, 0], b: [3, 2], c: [0, 3] },
    ])
    const card = { ...emptySwissCard(), undefeated: ['a'], advance: ['b'], winless: ['c'] }
    const odds = cardOdds(stage, card, samples, 2)
    expect(odds.picks[pickKey(card, 'a')]).toBe(0.75)
    expect(odds.picks[pickKey(card, 'b')]).toBe(0.75)
    expect(odds.picks[pickKey(card, 'c')]).toBe(0.75)
    expect(odds.expected).toBe(2.25)
    // 3, 2, 1 and 3 right: three of four reach 2.
    expect(odds.pass).toBe(0.75)
    expect(odds.groups).toEqual({ undefeated: 0.75, advance: 0.75, winless: 0.75 })
  })

  it('builds a favourites card from the likeliest outcomes, one slot per team', () => {
    const samples = swissSamples([
      { a: [3, 0], b: [3, 0], c: [3, 1], d: [0, 3] },
      { a: [3, 0], b: [3, 1], c: [3, 0], d: [0, 3] },
    ])
    const card = favouriteSwissCard(stage, ['a', 'b', 'c', 'd'], counts, samples)
    expect(card.undefeated).toEqual(['a', 'b'])
    expect(card.winless).toEqual(['d'])
    expect(card.advance).toEqual(['c'])
  })
})

describe('pickedSetOdds', () => {
  it('compares the teams picked to advance with the favourites', () => {
    const teams = Array.from({ length: 16 }, (_, i) => `team-${i + 1}`)
    // Picks send the top half through; in the simulations, teams 1-7 and 9 always advance.
    const picked = { 'stage-1': { status: 'complete', ranking: teams, seeds: teams } } as unknown as Record<string, ComputedStage>
    const actual = { 'stage-1': { status: 'in-progress' } } as unknown as Record<string, ComputedStage>
    const ranking = [...teams.slice(0, 7), 'team-9', 'team-8', ...teams.slice(9)]
    const samples: OutcomeSamples = Array.from({ length: 4 }, () => ({ 'stage-1': { ranking, winners: {} } }))
    const [row] = pickedSetOdds(cs2Major, picked, actual, samples)
    expect(row).toMatchObject({ stageId: 'stage-1', kind: 'advance', chance: 0, favouritesChance: 1 })
    expect(row.picked).toHaveLength(8)
    expect(row.favourites).toContain('team-9')
    expect(row.favourites).not.toContain('team-8')
  })
})
