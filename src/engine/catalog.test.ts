import { describe, expect, it } from 'vitest'
import type { Tournament } from '../types'
import { addFromCatalog, linkTeam, matchTeams, normalizeTeamName, parseVrsStandings, seedByRank, updateRatings } from './catalog'

// Same layout as Valve's standings files, with made-up teams.
const standings = (date: string, rows: [number, number, string, string][]) =>
  [
    `### Standings as of ${date}<br />`,
    '<br />',
    '',
    '| Standing | Points | Team Name            | Roster                                                |                                                                                                      |',
    '| :- | -: | :- | :- | :- |',
    ...rows.map(([rank, points, name, roster]) => `| ${rank} | ${points} | ${name} | ${roster} | [details](details/x.md) |`),
    '',
  ].join('\n')

const october = parseVrsStandings(
  standings('2026_10_05', [
    [1, 2046, 'Team Alpha', 'a1, a2, a3, a4, a5'],
    [2, 1931, 'Natus Vincere', 'n1, n2, n3, n4, n5'],
    [3, 1911, 'BRAVO', 'b1, b2, b3, b4, b5'],
    [4, 1500, 'Alpha Academy', 'x1, x2, x3, x4, x5'],
    [5, 1200, 'BRAVO', 'c1, c2, c3, c4, c5'],
  ]),
)

const tournament = (teams: Record<string, Partial<Tournament['teams'][string]>>): Tournament => ({
  id: 't',
  name: 'T',
  stages: [],
  teams: Object.fromEntries(Object.entries(teams).map(([id, t]) => [id, { id, name: id, ...t }])),
})

describe('parseVrsStandings', () => {
  it('reads rank, points, name, roster and date', () => {
    expect(october).toMatchObject({ source: 'vrs', label: 'VRS (global)', asOf: '2026-10-05' })
    expect(october.entries[0]).toEqual({ key: 'alpha', rank: 1, name: 'Team Alpha', points: 2046, roster: ['a1', 'a2', 'a3', 'a4', 'a5'] })
    expect(october.entries).toHaveLength(5)
  })

  it('keeps keys unique when a name repeats', () => {
    expect(october.entries.map((e) => e.key)).toEqual(['alpha', 'natusvincere', 'bravo', 'alphaacademy', 'bravo#5'])
  })

  it('rejects other files', () => {
    expect(() => parseVrsStandings('# Hello\nNothing here')).toThrow("doesn't look like a VRS standings file")
  })
})

describe('matching teams', () => {
  it('ignores case, punctuation, filler words and common short names', () => {
    expect(normalizeTeamName('Team Spirit')).toBe(normalizeTeamName('SPIRIT'))
    expect(normalizeTeamName('FURIA Esports')).toBe('furia')
    expect(normalizeTeamName('NAVI')).toBe(normalizeTeamName('Natus Vincere'))
    expect(normalizeTeamName('Shinden')).toBe(normalizeTeamName('ShindeN'))
  })

  it('matches by name, never to a different team with a similar name', () => {
    const t = tournament({ alpha: { name: 'alpha' }, navi: { name: 'NAVI' }, bravo: { name: 'Bravo' }, other: { name: 'Alpha Junior' } })
    const matched = matchTeams(Object.values(t.teams), october)
    expect(matched.get('alpha')?.rank).toBe(1)
    expect(matched.get('navi')?.rank).toBe(2)
    expect(matched.get('bravo')?.rank).toBe(3) // the higher-ranked of the two
    expect(matched.get('other')).toBeNull()
  })

  it('keeps an existing link', () => {
    const t = linkTeam(tournament({ b: { name: 'Bravo' } }), 'b', october.entries[4], october)
    expect(matchTeams(Object.values(t.teams), october).get('b')?.rank).toBe(5)
  })
})

describe('ratings from a catalog', () => {
  it('adds teams with their points and links them, reusing teams with the same name', () => {
    const start = tournament({ existing: { name: 'Natus Vincere', rating: 1600 } })
    const { tournament: t, ids } = addFromCatalog(start, october.entries.slice(0, 2), october)
    expect(ids[1]).toBe('existing')
    expect(t.teams.existing).toMatchObject({ rating: 1931, ratingSource: { catalog: 'vrs', key: 'natusvincere', rank: 2, asOf: '2026-10-05' } })
    expect(t.teams[ids[0]]).toMatchObject({ name: 'Team Alpha', rating: 2046 })
  })

  it('updates linked teams to a newer snapshot and reports teams that dropped out', () => {
    const november = parseVrsStandings(standings('2026_11_02', [[1, 1990, 'Natus Vincere', 'n1, n2, n3, n4, n5']]))
    const linked = addFromCatalog(tournament({ manual: { rating: 1400 } }), october.entries.slice(0, 2), october)
    const { tournament: t, updated, missing } = updateRatings(linked.tournament, november)
    const [alpha, navi] = linked.ids
    expect(updated).toEqual([navi])
    expect(missing).toEqual([alpha])
    expect(t.teams[navi]).toMatchObject({ rating: 1990, ratingSource: { rank: 1, asOf: '2026-11-02' } })
    expect(t.teams[alpha]).toMatchObject({ rating: 2046, ratingSource: { asOf: '2026-10-05' } })
    expect(t.teams.manual).toEqual({ id: 'manual', name: 'manual', rating: 1400 })
  })
})

describe('seedByRank', () => {
  it('orders invited teams by rank, leaving places and unranked teams after', () => {
    const { tournament: t, ids } = addFromCatalog(tournament({ unranked: {} }), october.entries.slice(0, 3), october)
    const [alpha, navi, bravo] = ids
    const placement = { kind: 'placement' as const, stageId: 'earlier', place: 1 }
    const entrants = [{ kind: 'team' as const, teamId: 'unranked' }, { kind: 'team' as const, teamId: bravo }, placement, { kind: 'team' as const, teamId: alpha }, { kind: 'team' as const, teamId: navi }]
    const seeded = seedByRank({ ...t, stages: [{ id: 's', name: 'S', phase: 1, config: { format: 'single-elim', bestOf: 1, seeding: 'standard', thirdPlaceMatch: false }, entrants }] }, 's')
    expect(seeded.stages[0].entrants).toEqual([
      { kind: 'team', teamId: alpha },
      { kind: 'team', teamId: navi },
      placement,
      { kind: 'team', teamId: bravo },
      { kind: 'team', teamId: 'unranked' },
    ])
  })
})
