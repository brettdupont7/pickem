import { describe, expect, it } from 'vitest'
import { nflPlayoffs } from '../data/presets'
import { parseTournamentFile, serializeTournament } from './io'

describe('tournament files', () => {
  it('round-trips a tournament and its results', () => {
    const results = { afc: { 'r0-1': { source: 'pick' as const, winnerId: 'afc-2' } } }
    const parsed = parseTournamentFile(serializeTournament(nflPlayoffs, results))
    expect(parsed.tournament).toEqual(nflPlayoffs)
    expect(parsed.results).toEqual(results)
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
    expect(parsed.results).toEqual({})
  })

  it('explains what is wrong', () => {
    expect(() => parseTournamentFile('nope')).toThrow("isn't valid JSON")
    expect(() => parseTournamentFile('{"hello": 1}')).toThrow("doesn't contain a tournament")
    expect(() =>
      parseTournamentFile(JSON.stringify({ teams: {}, stages: [{ id: 's', name: 'Groups', config: { format: 'league' }, entrants: [] }] })),
    ).toThrow('Stage "Groups" needs a format')
  })
})
