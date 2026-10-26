import { describe, expect, it } from 'vitest'
import { computeTournament, instantiate, parseVrsStandings, validateTournament } from '../engine'
import type { EntrantSource, Tournament } from '../types'
import { buildFromHltvEvent, isHltvEvent, parseHltvEvent, updateTeamsFromHltv, type HltvBracket, type HltvEvent, type HltvPage, type HltvSlot } from './hltvEvent'
import { cs2Major, groupsPlayoffs } from './presets'

// Shaped like what the bookmarklet copies from HLTV, with made-up teams.
const SWISS_TITLES = ['0:0', '1:0', '0:1', '2:0', '1:1', '0:2', '3:0', '3:0', '2:1', '1:2', '0:3', '3:1', '3:2', '2:2', '1:3', '2:3']
const swiss = (teams = 16) => ({ titles: SWISS_TITLES, firstRound: Array.from({ length: teams / 2 }, () => [null, null]) })
const team = (name: string, rank: number, from = 'VRS (Europe)', predicted: string | null = null): HltvSlot => ({ name, rank, from, predicted })
const tbd = (from: string): HltvSlot => ({ name: null, rank: null, from, predicted: null })
const match = (team1: string | null = null, team2: string | null = null, bo: number | null = null, hidden = false) => ({ team1, team2, bo, hidden })
const single = (name: string, ...rounds: [string, number][]): HltvBracket => ({
  name,
  type: 'SingleElimination',
  rounds: rounds.map(([roundName, n], i) => ({ key: `round${i + 1}`, name: roundName, matches: Array.from({ length: n }, () => match()) })),
})
const gsl = (name: string, teams: (string | null)[] = [null, null, null, null]): HltvBracket => ({
  name,
  type: 'DoubleElimination4',
  rounds: [
    { key: 'upperRound1', name: 'Opening round', matches: [match(teams[0], teams[1], 3), match(teams[2], teams[3], 3)] },
    { key: 'upperFinal', name: "Winners' match", matches: [match(null, null, 3)] },
    { key: 'lowerRound1', name: 'Elimination match', matches: [match(null, null, 3)] },
    { key: 'consolidationFinal', name: 'Decider match', matches: [match(null, null, 3)] },
    { key: 'grandFinal', name: 'Grand final', matches: [match(null, null, null, true)] },
  ],
})
const page = (p: Partial<HltvPage>): HltvPage => ({ id: '1', url: 'https://www.hltv.org/events/1/x', name: '', label: null, start: null, formats: [], swiss: [], brackets: [], slots: [], ...p })
const event = (...pages: HltvPage[]): HltvEvent => ({ format: 'pickem-hltv-event', version: 1, url: pages[0].url, copiedAt: '2026-10-16T12:00:00Z', ranking: null, pages })

const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)
const STAGE_1_SWISS: [string, string] = ['Group stage', 'Swiss Bo1\n- Progression matches Bo3\n- Elimination matches Bo3']

/** An upcoming Major: 16 + 8 + 8 predicted invites; Stage 2 and 3 also take 8 teams from the stage before. */
const major = event(
  page({
    name: 'Test Major 2026 Stage 1',
    label: 'Stage 1',
    start: 1,
    formats: [STAGE_1_SWISS],
    swiss: [swiss()],
    // Listed by region, not rank: the import seeds by rank.
    slots: [...names('S1-', 16).map((n, i) => team(n, 40 - i, 'VRS (Europe)', '60%')), ...Array.from({ length: 16 }, () => tbd('VRS (Europe)'))],
  }),
  page({
    name: 'Test Major 2026 Stage 2',
    label: 'Stage 2',
    start: 2,
    formats: [STAGE_1_SWISS],
    swiss: [swiss()],
    slots: [...names('S2-', 8).map((n, i) => team(n, 10 + i, 'VRS (Europe)', '80%')), ...Array.from({ length: 8 }, () => tbd('VRS (Europe)')), ...Array.from({ length: 8 }, () => tbd('Stage 1'))],
  }),
  page({
    name: 'Test Major 2026',
    label: 'Stage 3 & Playoffs',
    start: 3,
    formats: [
      ['Group stage', 'Swiss Bo3'],
      ['Playoffs', 'Single elimination Bo3\n- Grand final Bo5'],
      ['3rd place decider match', 'Bo3'],
    ],
    swiss: [swiss()],
    brackets: [single('Playoffs', ['Quarter-finals', 4], ['Semi-finals', 2], ['Grand final', 1]), single('3rd Place Decider Match', ['Tiebreaker', 1])],
    slots: [
      ...names('S3-', 8).map((n, i) => team(n, i + 1, 'VRS (Europe)', i === 7 ? '46%' : '>99%')),
      ...Array.from({ length: 8 }, () => tbd('VRS (Europe)')),
      ...Array.from({ length: 8 }, () => tbd('Stage 2')),
    ],
  }),
)

const vrs = parseVrsStandings(
  ['### Standings as of 2026_10_16', '', '| Standing | Points | Team Name | Roster | |', '| - | - | - | - | - |']
    .concat([...names('S3-', 8), ...names('S2-', 8), ...names('S1-', 15)].map((n, i) => `| ${i + 1} | ${2000 - i * 10} | ${n} | a, b | |`))
    .join('\n'),
)

const teamNames = (t: Tournament, entrants: EntrantSource[]) =>
  entrants.map((e) => (e.kind === 'team' ? t.teams[e.teamId].name : `${e.stageId}#${e.place}`))

describe('parseHltvEvent', () => {
  it('recognises and reads a copied event', () => {
    const text = JSON.stringify(major)
    expect(isHltvEvent(text)).toBe(true)
    expect(isHltvEvent("# Pick'em VRS import")).toBe(false)
    expect(parseHltvEvent(text).pages).toHaveLength(3)
  })

  it('explains a broken or foreign paste', () => {
    expect(() => parseHltvEvent('{"format":"pickem-hltv-event"')).toThrow('incomplete')
    expect(() => parseHltvEvent('{"format":"other"}')).toThrow("doesn't look like an event")
  })
})

describe('buildFromHltvEvent: a Major', () => {
  const { tournament, notes } = buildFromHltvEvent(major, vrs)

  it('builds three Swiss stages into playoffs, each drawing on the one before', () => {
    expect(tournament.name).toBe('Test Major 2026')
    expect(tournament.stages.map((s) => [s.id, s.name, s.phase, s.config.format])).toEqual([
      ['stage-1', 'Stage 1', 0, 'swiss'],
      ['stage-2', 'Stage 2', 1, 'swiss'],
      ['stage-3', 'Stage 3', 2, 'swiss'],
      ['playoffs', 'Playoffs', 3, 'single-elim'],
    ])
    expect(validateTournament(tournament)).toEqual([])
    expect(teamNames(tournament, tournament.stages[1].entrants)).toEqual([
      ...names('S2-', 8),
      ...Array.from({ length: 8 }, (_, i) => `stage-1#${i + 1}`),
    ])
    expect(teamNames(tournament, tournament.stages[3].entrants)).toEqual(Array.from({ length: 8 }, (_, i) => `stage-3#${i + 1}`))
    expect(Object.keys(computeTournament(tournament, {}).stages)).toHaveLength(4)
  })

  it('seeds invited teams by VRS rank', () => {
    expect(teamNames(tournament, tournament.stages[0].entrants)).toEqual(names('S1-', 16).reverse())
  })

  it('takes best-ofs, record limits and the 3rd-place match from HLTV', () => {
    const [stage1, , stage3, playoffs] = tournament.stages.map((s) => s.config)
    expect(stage1).toMatchObject({ winsToAdvance: 3, lossesToEliminate: 3, bestOf: 1, advancementBestOf: 3, eliminationBestOf: 3, majorPriorityTable: true })
    expect(stage3).toMatchObject({ bestOf: 3 })
    expect(stage3).not.toHaveProperty('advancementBestOf')
    expect(playoffs).toEqual({
      format: 'single-elim',
      bestOf: 3,
      bestOfFromFinal: [5],
      roundNamesFromFinal: ['Grand final', 'Semi-finals', 'Quarter-finals'],
      seeding: 'standard',
      thirdPlaceMatch: true,
    })
  })

  it("reads bracket types in either case (HLTV now writes 'singleElimination')", () => {
    const lower = structuredClone(major)
    for (const p of lower.pages) for (const b of p.brackets) b.type = b.type[0].toLowerCase() + b.type.slice(1)
    expect(buildFromHltvEvent(lower, vrs).tournament).toEqual(tournament)
  })

  it('rates teams from current VRS and notes predictions and teams without a rating', () => {
    const s3 = Object.values(tournament.teams).find((t) => t.name === 'S3-1')!
    expect(s3).toMatchObject({ rating: 2000, ratingSource: { catalog: 'vrs', rank: 1, asOf: '2026-10-16' } })
    expect(notes[0]).toMatch(/^32 invited teams are HLTV's prediction.*least likely: S3-8 46%/)
    expect(notes).toContain('Not in the VRS ranking, so no rating: S1-16.')
    expect(notes.join(' ')).not.toMatch(/Valve's Major rules/)
  })

  it('treats teams listed as coming from an earlier stage as its places, once the event is played', () => {
    const played = structuredClone(major)
    played.pages[1].slots = [...names('S2-', 8).map((n, i) => team(n, 10 + i)), ...names('S1-', 8).map((n, i) => team(n, 30 + i, 'Stage 1'))]
    const built = buildFromHltvEvent(played, null)
    expect(teamNames(built.tournament, built.tournament.stages[1].entrants)).toEqual([
      ...names('S2-', 8),
      ...Array.from({ length: 8 }, (_, i) => `stage-1#${i + 1}`),
    ])
    expect(validateTournament(built.tournament)).toEqual([])
  })

  it('makes placeholders for invites HLTV has no team for', () => {
    const partial = structuredClone(major)
    partial.pages[2].slots = partial.pages[2].slots.filter((_, i) => i !== 0)
    const built = buildFromHltvEvent(partial, null)
    expect(teamNames(built.tournament, built.tournament.stages[2].entrants).slice(0, 8)).toEqual([...names('S3-', 8).slice(1), 'TBD · VRS Europe'])
    expect(built.notes).toContain("1 slot has no team yet, so it's a placeholder named TBD.")
    expect(built.notes).toContain('No VRS ranking was copied, so teams have no ratings. Import VRS, then use Link teams to VRS.')
  })
})

describe('buildFromHltvEvent: a Swiss stage with a published draw', () => {
  // Like PGL Masters Bucharest 2026: the draw doesn't follow seed order.
  const slots = names('T', 6).map((n, i) => team(n, i + 1))
  const drawn = (firstRound: (string | null)[][]) =>
    event(page({ name: 'Test Masters', formats: [['Group stage', 'Swiss Bo3']], swiss: [{ titles: SWISS_TITLES, firstRound }], slots }))
  const opening = (t: Tournament) => computeTournament(t, {}).stages[t.stages[0].id].matches.filter((m) => m.round === 0).map((m) => m.slots.map((s) => t.teams[s.teamId!].name))

  it('plays HLTV\'s opening matches and keeps teams seeded by VRS rank', () => {
    const { tournament, notes } = buildFromHltvEvent(drawn([['T3', 'T5'], ['T1', 'T6'], ['T2', 'T4']]), null)
    const stage = tournament.stages[0]
    expect(stage.config).toMatchObject({ firstRoundPairing: 'high-low', drawnRounds: { 0: [[3, 5], [1, 6], [2, 4]] } })
    expect(stage.entrants.map((e) => e.kind === 'team' && tournament.teams[e.teamId].name)).toEqual(names('T', 6))
    expect(opening(tournament)).toEqual([['T3', 'T5'], ['T1', 'T6'], ['T2', 'T4']])
    expect(notes).toContain("Group stage: the first round uses HLTV's draw.")
  })

  it('pairs by seed while the draw has a team still to be decided', () => {
    const { tournament } = buildFromHltvEvent(drawn([['T3', 'T5'], ['T1', null], ['T2', 'T4']]), null)
    expect(tournament.stages[0].config).not.toHaveProperty('drawnRounds')
  })

  it('brings the draw into an existing tournament when updating its teams', () => {
    const before = buildFromHltvEvent(drawn([['T1', 'T4'], ['T2', 'T5'], ['T3', 'T6']].map(() => [null, null])), null).tournament
    const { tournament, notes } = updateTeamsFromHltv(before, drawn([['T3', 'T5'], ['T1', 'T6'], ['T2', 'T4']]), null)
    expect(opening(tournament)).toEqual([['T3', 'T5'], ['T1', 'T6'], ['T2', 'T4']])
    expect(notes).toContain("Group stage: the first round now uses HLTV's draw.")
  })
})

describe('buildFromHltvEvent: GSL groups into playoffs', () => {
  const groups = (a: (string | null)[], b: (string | null)[]) =>
    event(
      page({
        name: 'Test Championship 2026',
        formats: [
          ['Group stage', 'GSL Bo3'],
          ['Playoffs', 'Single elimination Bo3\n- Grand final Bo5'],
        ],
        brackets: [single('Single Elimination Bracket', ['Semi-finals', 2], ['Grand final', 1]), gsl('Group A', a), gsl('Group B', b)],
        slots: names('G', 8).map((n, i) => team(n, i + 1, 'VRS (Global)')),
      }),
    )

  it('enters drawn groups as HLTV paired them, and takes the top 2 of each into the playoffs', () => {
    const { tournament, notes } = buildFromHltvEvent(groups(['G1', 'G8', 'G4', 'G5'], ['G2', 'G7', 'G3', 'G6']), null)
    expect(validateTournament(tournament)).toEqual([])
    const [a, b, playoffs] = tournament.stages
    expect([a.name, a.phase, b.name, b.phase, playoffs.name, playoffs.phase]).toEqual(['Group A', 0, 'Group B', 0, 'Playoffs', 1])
    expect(teamNames(tournament, a.entrants)).toEqual(['G1', 'G8', 'G4', 'G5'])
    expect(a.config).toEqual({
      format: 'double-elim',
      bestOf: 3,
      upperRoundNamesFromFinal: ["Winners' match", 'Opening round'],
      lowerRoundNamesFromFinal: ['Decider match', 'Elimination match'],
      seeding: 'as-listed',
      finals: 'no-grand-final',
      grandFinalReset: false,
    })
    // 1st of A plays 2nd of B, 1st of B plays 2nd of A.
    expect(teamNames(tournament, playoffs.entrants)).toEqual(['group-a#1', 'group-b#1', 'group-a#2', 'group-b#2'])
    expect(playoffs.config).toMatchObject({ bestOf: 3, bestOfFromFinal: [5], thirdPlaceMatch: false })
    expect(notes.join(' ')).not.toMatch(/drawn/)
  })

  it('splits undrawn groups by rank, snaking', () => {
    const { tournament, notes } = buildFromHltvEvent(groups([null, null, null, null], [null, null, null, null]), null)
    expect(teamNames(tournament, tournament.stages[0].entrants)).toEqual(['G1', 'G4', 'G5', 'G8'])
    expect(teamNames(tournament, tournament.stages[1].entrants)).toEqual(['G2', 'G3', 'G6', 'G7'])
    expect(tournament.stages[0].config).toMatchObject({ seeding: 'standard' })
    expect(notes).toContain("Test Championship 2026: the groups aren't drawn yet, so teams are split by VRS rank, snaking between groups.")
  })

  it("notes that a non-Major Swiss follows Valve's Major rules", () => {
    const e = event(page({ name: 'Test Cup', formats: [['Group stage', 'Swiss Bo3']], swiss: [swiss()], slots: names('T', 16).map((n, i) => team(n, i + 1)) }))
    expect(buildFromHltvEvent(e, null).notes.join(' ')).toMatch(/Valve's Major rules/)
  })
})

describe('buildFromHltvEvent: unsupported formats', () => {
  it('says what it cannot build', () => {
    const e = event(page({ name: 'Test Cup', brackets: [{ name: 'Group A', type: 'DoubleElimination8', rounds: [] }] }))
    expect(() => buildFromHltvEvent(e, null)).toThrow(`Can't build this event yet. Test Cup: HLTV's "Group A" bracket (DoubleElimination8) isn't supported yet.`)
    const none = event(page({ name: 'Test Cup', formats: [['Group stage', 'Round robin Bo1']] }))
    expect(() => buildFromHltvEvent(none, null)).toThrow('HLTV lists the format as "Group stage: Round robin Bo1"')
  })
})

describe('updateTeamsFromHltv', () => {
  it("puts the event's teams into a tournament's invited slots, keeping its design and team IDs", () => {
    const mine = instantiate(cs2Major)
    mine.teams['team-17'] = { ...mine.teams['team-17'], name: 'S2-1', shortName: 'S21', rating: 1 }
    const { tournament, notes } = updateTeamsFromHltv(mine, major, vrs)
    expect(tournament.stages).toBe(mine.stages)
    expect(Object.keys(tournament.teams)).toEqual(Object.keys(mine.teams))
    expect(tournament.teams['team-1'].name).toBe('S1-16')
    expect(tournament.teams['team-17']).toMatchObject({ name: 'S2-1', shortName: 'S21', rating: 1920 })
    expect(tournament.teams['team-25']).toMatchObject({ name: 'S3-1', rating: 2000 })
    expect(notes[0]).toBe('Updated 32 invited teams (31 changed).')
  })

  it("refuses a tournament whose stages don't match", () => {
    expect(() => updateTeamsFromHltv(instantiate(groupsPlayoffs), major, vrs)).toThrow(
      "The teams don't line up: this tournament invites Group A 8, Group B 8, but the event invites Stage 1 16, Stage 2 8, Stage 3 8.",
    )
  })
})
