import { describe, expect, it } from 'vitest'
import { nflPlayoffs } from '../data/presets/nfl-playoffs'
import type { MatchReport, TournamentResults } from '../types'
import { absorbPicks, picksView, splitBySource } from './layers'
import { simulate } from './simulator'
import { computeTournament } from './tournament'

const first = computeTournament(nflPlayoffs, {}).stages.afc.matches.find((m) => m.slots.every((s) => s.teamId))!
const [a, b] = first.slots.map((s) => s.teamId!)
const report = (source: MatchReport['source'], winnerId?: string, games?: MatchReport['games']): MatchReport => ({ source, winnerId, games })

describe('result layers', () => {
  it('splits mixed results by source', () => {
    const results: TournamentResults = { afc: { x: report('actual', a), y: report('pick', b), z: report('simulated', a) } }
    expect(splitBySource(results)).toEqual({
      actual: { afc: { x: results.afc.x } },
      picks: { afc: { y: results.afc.y, z: results.afc.z } },
    })
  })

  it('shows decided actual results over picks', () => {
    const view = picksView(nflPlayoffs, { actual: { afc: { [first.id]: report('actual', b) } }, picks: { afc: { [first.id]: report('pick', a) } } })
    expect(view.afc[first.id]).toEqual(report('actual', b))
  })

  it('keeps a pick when the actual match is still in progress', () => {
    const live = report('actual', undefined, [{ score: { [a]: 7, [b]: 3 }, inProgress: true }])
    const view = picksView(nflPlayoffs, { actual: { afc: { [first.id]: live } }, picks: { afc: { [first.id]: report('pick', b) } } })
    expect(view.afc[first.id]).toEqual(report('pick', b))
  })

  it('stores simulations as picks without touching actual results or hidden picks', () => {
    const layers = { actual: { afc: { [first.id]: report('actual', b) } }, picks: { afc: { [first.id]: report('pick', a) } } }
    const next = simulate(nflPlayoffs, picksView(nflPlayoffs, layers), { kind: 'tournament' }, { seed: 1 })
    const picks = absorbPicks(layers.picks, next)
    expect(picks.afc[first.id]).toEqual(report('pick', a))
    const sources = Object.values(picks).flatMap((r) => Object.values(r).map((x) => x.source))
    expect(sources).not.toContain('actual')
    expect(sources).toContain('simulated')
    expect(computeTournament(nflPlayoffs, picksView(nflPlayoffs, { ...layers, picks })).stages['super-bowl'].status).toBe('complete')
  })
})
