import { describe, expect, it } from 'vitest'
import { cs2Major } from '../data/presets/cs2-major'
import type { Tournament } from '../types'
import { formRatings, simulationRatings } from './form'
import { computeTournament } from './tournament'

const rated: Tournament = {
  ...cs2Major,
  rules: { ...cs2Major.rules!, formK: 40 },
  teams: Object.fromEntries(Object.values(cs2Major.teams).map((t, i) => [t.id, { ...t, rating: 2000 - 20 * i }])),
}
const [m1, m2] = computeTournament(rated, {}).stages['stage-1'].matches
const [fav, dog] = m1.slots.map((s) => s.teamId!)

describe('formRatings', () => {
  it('moves ratings by Elo for actual results only', () => {
    const results = {
      'stage-1': {
        [m1.id]: { source: 'actual' as const, winnerId: dog },
        // A pick doesn't count.
        [m2.id]: { source: 'pick' as const, winnerId: m2.slots[1].teamId! },
      },
    }
    const ratings = formRatings(rated, results)
    const [rf, rd] = [rated.teams[fav].rating!, rated.teams[dog].rating!]
    const gain = 40 * (1 - 1 / (1 + 10 ** ((rf - rd) / 400)))
    expect(ratings[dog]).toBeCloseTo(rd + gain, 9)
    expect(ratings[fav]).toBeCloseTo(rf - gain, 9)
    for (const id of m2.slots.map((s) => s.teamId!)) expect(ratings[id]).toBe(rated.teams[id].rating)
  })

  it('applies results in order, so later matches use updated ratings', () => {
    const r1 = { 'stage-1': { [m1.id]: { source: 'actual' as const, winnerId: dog } } }
    const after1 = formRatings(rated, r1)
    // An upset is worth more than a favourite winning.
    expect(after1[dog] - rated.teams[dog].rating!).toBeGreaterThan(20)
    const fav2 = formRatings(rated, { 'stage-1': { [m1.id]: { source: 'actual' as const, winnerId: fav } } })
    expect(fav2[fav] - rated.teams[fav].rating!).toBeLessThan(20)
  })

  it('is only used by the simulator when switched on', () => {
    expect(simulationRatings({ ...rated, rules: { ...rated.rules!, formK: undefined } }, {})).toBeUndefined()
    expect(simulationRatings(rated, {})![fav]).toBe(rated.teams[fav].rating)
  })

  it('counts picks and simulated results when the rules say so', () => {
    const withPicks: Tournament = { ...rated, rules: { ...rated.rules!, formFromPicks: true } }
    const results = {
      'stage-1': {
        [m1.id]: { source: 'pick' as const, winnerId: dog },
        [m2.id]: { source: 'simulated' as const, winnerId: m2.slots[1].teamId! },
      },
    }
    const ratings = formRatings(withPicks, results)
    expect(ratings[dog]).toBeGreaterThan(rated.teams[dog].rating!)
    expect(ratings[m2.slots[1].teamId!]).toBeGreaterThan(rated.teams[m2.slots[1].teamId!].rating!)
    // Without the rule, the same picks leave ratings alone.
    expect(formRatings(rated, results)[dog]).toBe(rated.teams[dog].rating)
  })
})
