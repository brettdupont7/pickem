import { describe, expect, it } from 'vitest'
import { nflPlayoffs } from '../data/presets'
import { parseTournamentFile, serializeTournament } from './io'

describe('tournament files', () => {
  it('round-trips a tournament with its picks and actual results', () => {
    const layers = {
      actual: { afc: { 'r0-1': { source: 'actual' as const, winnerId: 'afc-3' } } },
      picks: { afc: { 'r0-1': { source: 'pick' as const, winnerId: 'afc-2' } } },
    }
    const parsed = parseTournamentFile(serializeTournament(nflPlayoffs, layers))
    expect(parsed.tournament).toEqual(nflPlayoffs)
    expect(parsed.layers).toEqual(layers)
  })

  it('splits version 1 files into actual results and picks', () => {
    const results = {
      afc: {
        'r0-0': { source: 'actual', winnerId: 'afc-2' },
        'r0-1': { source: 'pick', winnerId: 'afc-3' },
        'r0-2': { source: 'simulated', winnerId: 'afc-4' },
      },
    }
    const file = JSON.stringify({ format: 'pickem-tournament', version: 1, tournament: nflPlayoffs, results })
    expect(parseTournamentFile(file).layers).toEqual({
      actual: { afc: { 'r0-0': results.afc['r0-0'] } },
      picks: { afc: { 'r0-1': results.afc['r0-1'], 'r0-2': results.afc['r0-2'] } },
    })
  })

  it('accepts a bare tournament and fills in missing settings', () => {
    const parsed = parseTournamentFile(
      JSON.stringify({
        name: 'Office league',
        teams: { a: { name: 'A' }, b: { name: 'B' } },
        stages: [
          { id: 'final', name: 'Final', config: { format: 'single-elim', bestOf: 3 }, entrants: [{ kind: 'team', teamId: 'a' }, { kind: 'team', teamId: 'b' }] },
        ],
      }),
    )
    expect(parsed.tournament.teams.a).toEqual({ id: 'a', name: 'A' })
    expect(parsed.tournament.stages[0]).toMatchObject({ phase: 0, config: { bestOf: 3, seeding: 'standard', thirdPlaceMatch: false } })
    expect(parsed.layers).toEqual({ actual: {}, picks: {} })
  })

  it('explains what is wrong', () => {
    expect(() => parseTournamentFile('nope')).toThrow("isn't valid JSON")
    expect(() => parseTournamentFile('{"hello": 1}')).toThrow("doesn't contain a tournament")
    expect(() =>
      parseTournamentFile(JSON.stringify({ teams: {}, stages: [{ id: 's', name: 'Groups', config: { format: 'league' }, entrants: [] }] })),
    ).toThrow('Stage "Groups" needs a format')
  })
})
