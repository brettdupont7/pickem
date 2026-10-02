import { describe, expect, it } from 'vitest'
import { cs2Major } from '../../data/presets/cs2-major'
import type { BestOf, Match, Tournament } from '../../types'
import { createRng } from '../random'
import { resolveReport, setGame } from '../results'
import { computeTournament } from '../tournament'
import { clearSimulated, createSimulator, runMonteCarlo, simulate } from './simulator'

const duel = (ratings: [number, number]): Tournament => ({
  ...cs2Major,
  teams: { a: { id: 'a', name: 'A', rating: ratings[0] }, b: { id: 'b', name: 'B', rating: ratings[1] } },
})

const match = (bestOf: BestOf): Match => ({ id: 'm', side: 'main', round: 0, bestOf, slots: [{ teamId: 'a' }, { teamId: 'b' }] })

/** Lower team number = higher rating. */
const rated: Tournament = {
  ...cs2Major,
  teams: Object.fromEntries(
    Object.values(cs2Major.teams).map((t) => [t.id, { ...t, rating: 2000 - 10 * Number(t.id.split('-')[1]) }]),
  ),
}

describe('simulateMatch', () => {
  it.each([1, 3, 5] as const)('produces a decided, valid Bo%i', (bestOf) => {
    const { simulateMatch } = createSimulator(duel([1500, 1500]))
    const rng = createRng(7)
    for (let i = 0; i < 200; i++) {
      const report = simulateMatch(match(bestOf), undefined, rng)
      const { result } = resolveReport(report, 'a', 'b', bestOf)
      expect(result?.winnerId).toBe(report.winnerId)
      expect(report.source).toBe('simulated')
      expect(report.score![report.winnerId!]).toBe(Math.ceil(bestOf / 2))
      expect(report.games!.length).toBe(report.score!.a + report.score!.b)
    }
  })

  it('continues a series from the games already played', () => {
    const { simulateMatch } = createSimulator(duel([1500, 1500]))
    const current = setGame(match(3), undefined, 0, { name: 'Mirage', score: [13, 2] })
    const report = simulateMatch(match(3), current, createRng(3))
    expect(report.games![0]).toEqual({ name: 'Mirage', score: { a: 13, b: 2 } })
    expect(report.score!.a).toBeGreaterThanOrEqual(1)
  })

  it('continues from a series score without inventing earlier games', () => {
    const { simulateMatch } = createSimulator(duel([1500, 1500]))
    const report = simulateMatch(match(5), { source: 'actual', score: { a: 2, b: 0 } }, createRng(3))
    expect(report.games).toBeUndefined()
    expect(report.score!.a).toBeGreaterThanOrEqual(2)
  })

  it('respects detail', () => {
    const t = duel([1500, 1500])
    const rng = createRng(1)
    expect(createSimulator(t, { detail: 'winner' }).simulateMatch(match(3), undefined, rng)).toEqual({
      source: 'simulated',
      winnerId: expect.any(String),
    })
    const series = createSimulator(t, { detail: 'series' }).simulateMatch(match(3), undefined, rng)
    expect(series.games).toBeUndefined()
    expect(series.score).toBeDefined()
    const noScores = createSimulator(t, { gameScore: null }).simulateMatch(match(3), undefined, rng)
    expect(noScores.games!.every((g) => g.score === undefined && g.winnerId)).toBe(true)
  })

  it('favours the stronger team, and chaos evens it out', () => {
    const winRate = (chaos: number) => {
      const { simulateMatch } = createSimulator(duel([1800, 1500]), { chaos, detail: 'winner' })
      const rng = createRng(11)
      let wins = 0
      for (let i = 0; i < 2000; i++) if (simulateMatch(match(3), undefined, rng).winnerId === 'a') wins++
      return wins / 2000
    }
    expect(winRate(0)).toBeGreaterThan(0.9)
    expect(winRate(1)).toBeGreaterThan(0.45)
    expect(winRate(1)).toBeLessThan(0.55)
  })
})

describe('simulate', () => {
  const statusOf = (results: ReturnType<typeof simulate>) =>
    Object.fromEntries(Object.entries(computeTournament(cs2Major, results).stages).map(([id, s]) => [id, s.status]))

  it('simulates one round', () => {
    const results = simulate(cs2Major, {}, { kind: 'round' })
    expect(Object.keys(results['stage-1'])).toHaveLength(8)
    expect(computeTournament(cs2Major, results).stages['stage-1'].matches).toHaveLength(16)
  })

  it('simulates one stage', () => {
    const results = simulate(cs2Major, {}, { kind: 'stage', stageId: 'stage-1' })
    expect(statusOf(results)).toEqual({
      'stage-1': 'complete',
      'stage-2': 'in-progress',
      'stage-3': 'waiting',
      playoffs: 'waiting',
    })
  })

  it('simulates the whole tournament without touching picks or the input', () => {
    const first = computeTournament(cs2Major, {}).stages['stage-1'].matches[0]
    const underdog = first.slots[1].teamId!
    const input = { 'stage-1': { [first.id]: { source: 'pick' as const, winnerId: underdog } } }
    const results = simulate(cs2Major, input, { kind: 'tournament' })
    expect(Object.values(statusOf(results)).every((s) => s === 'complete')).toBe(true)
    expect(results['stage-1'][first.id]).toEqual({ source: 'pick', winnerId: underdog })
    expect(Object.keys(input['stage-1'])).toHaveLength(1)
  })

  it('is reproducible for a seed', () => {
    expect(simulate(cs2Major, {}, { kind: 'tournament' }, { seed: 5 })).toEqual(
      simulate(cs2Major, {}, { kind: 'tournament' }, { seed: 5 }),
    )
  })

  it('clears only simulated results', () => {
    const first = computeTournament(cs2Major, {}).stages['stage-1'].matches[0]
    const input = { 'stage-1': { [first.id]: { source: 'actual' as const, winnerId: first.slots[0].teamId! } } }
    const cleared = clearSimulated(simulate(cs2Major, input, { kind: 'tournament' }))
    expect(cleared['stage-1']).toEqual(input['stage-1'])
    expect(cleared.playoffs).toEqual({})
  })
})

describe('runMonteCarlo', () => {
  it('produces consistent probabilities', () => {
    const { iterations, teams } = runMonteCarlo(rated, {}, 200, { seed: 1 })
    expect(iterations).toBe(200)
    const all = Object.values(teams)
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

    expect(sum(all.map((t) => t.champion))).toBeCloseTo(1)
    for (const t of all) {
      for (const stage of Object.values(t.stages)) {
        expect(sum(stage.places)).toBeCloseTo(stage.entered)
        if (stage.records) expect(sum(Object.values(stage.records))).toBeCloseTo(stage.entered)
      }
    }
    // Stage 1 teams always play it; invites never do.
    expect(teams['team-1'].stages['stage-1'].entered).toBe(1)
    expect(teams['team-17'].stages['stage-1']).toBeUndefined()
    expect(teams['team-17'].stages['stage-2'].entered).toBe(1)
    // Each playoff place is filled exactly once per run.
    for (let place = 0; place < 8; place++) {
      expect(sum(all.map((t) => t.stages.playoffs?.places[place] ?? 0))).toBeCloseTo(1)
    }
  })

  it('favours highly rated teams', () => {
    const { teams } = runMonteCarlo(rated, {}, 300, { seed: 2 })
    const advance = (id: string) => teams[id].stages['stage-1'].places.slice(0, 8).reduce((a, b) => a + b, 0)
    // team-1 and team-16 are the best- and worst-rated Stage 1 teams.
    expect(advance('team-1')).toBeGreaterThan(advance('team-16'))
    expect(teams['team-1'].champion).toBeGreaterThan(teams['team-16'].champion)
  })

  it('is certain once every result is in', () => {
    const results = simulate(rated, {}, { kind: 'tournament' }, { seed: 9 })
    const champion = computeTournament(rated, results).stages.playoffs.ranking[0]
    expect(runMonteCarlo(rated, results, 20).teams[champion].champion).toBe(1)
  })
})
