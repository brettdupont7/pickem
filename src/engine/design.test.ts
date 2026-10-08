import { describe, expect, it } from 'vitest'
import { cs2Major, nflPlayoffs } from '../data/presets'
import { groupsPlayoffs } from '../data/presets/groups-playoffs'
import type { Stage } from '../types'
import {
  addStage,
  addTeams,
  blankTournament,
  defaultConfig,
  describeEntrants,
  duplicatePhase,
  duplicateStage,
  eliminationRounds,
  formatRanges,
  instantiate,
  moveStageToPhase,
  normalizePhases,
  previewStage,
  removeStage,
  removeTeam,
  removeTeams,
  renameTeams,
  setFromFinal,
  uniqueId,
  uniqueName,
} from './design'
import { validateTournament } from './tournament'

describe('names and IDs', () => {
  it('finds a free ID or name', () => {
    expect(uniqueId('stage-1', [])).toBe('stage-1')
    expect(uniqueId('stage-1', ['stage-1', 'stage-1-2'])).toBe('stage-1-3')
    expect(uniqueName('CS2 Major', ['CS2 Major'])).toBe('CS2 Major (2)')
  })

  it('formats ranges', () => {
    expect(formatRanges([5, 1, 2, 3, 8, 9])).toBe('1–3, 5, 8–9')
  })
})

describe('defaultConfig', () => {
  it('keeps best-of and seeding when switching format', () => {
    const from = { ...defaultConfig('single-elim'), bestOf: 3, seeding: 'as-listed' as const }
    expect(defaultConfig('double-elim', from)).toMatchObject({ format: 'double-elim', bestOf: 3, seeding: 'as-listed' })
    expect(defaultConfig('swiss', from)).toMatchObject({ format: 'swiss', bestOf: 3 })
  })
})

describe('setFromFinal', () => {
  it('fills gaps and trims trailing blanks', () => {
    expect(setFromFinal<number>(undefined, 2, 5)).toEqual([undefined, undefined, 5])
    expect(setFromFinal([5, 3], 1, undefined)).toEqual([5])
    expect(setFromFinal(['Final'], 0, '')).toBeUndefined()
  })
})

describe('stages', () => {
  it('adds a stage that takes the top half of the last stage', () => {
    const { tournament, stageId } = addStage(nflPlayoffs)
    const stage = tournament.stages.find((s) => s.id === stageId)!
    expect(stage.phase).toBe(2)
    expect(stage.entrants).toEqual([
      { kind: 'placement', stageId: 'super-bowl', place: 1 },
      { kind: 'placement', stageId: 'super-bowl', place: 2 },
    ])
    expect(validateTournament(tournament)).toEqual([])
  })

  it('removes a stage and the entrants that drew from it', () => {
    const t = removeStage(cs2Major, 'stage-2')
    expect(t.stages.map((s) => [s.id, s.phase])).toEqual([
      ['stage-1', 0],
      ['stage-3', 1],
      ['playoffs', 2],
    ])
    expect(t.stages.find((s) => s.id === 'stage-3')!.entrants).toHaveLength(8)
  })

  it('renumbers phases after a move', () => {
    const t = moveStageToPhase(nflPlayoffs, 'nfc', 2)
    expect(t.stages.map((s) => [s.id, s.phase])).toEqual([
      ['afc', 0],
      ['nfc', 2],
      ['super-bowl', 1],
    ])
    const stages = [{ phase: 4 }, { phase: 1 }, { phase: 4 }] as Stage[]
    expect(normalizePhases(stages).map((s) => s.phase)).toEqual([1, 0, 1])
  })

  it('describes where entrants come from', () => {
    expect(describeEntrants(cs2Major, cs2Major.stages[1])).toBe('8 invited, 8 from Stage 1 (1–8)')
  })
})

describe('teams', () => {
  it('adds teams, reusing existing names', () => {
    const { tournament, ids } = addTeams(blankTournament(), ['team 1', ' Vitality ', '', 'Vitality'])
    expect(ids).toEqual(['team-1', 'team-vitality', 'team-vitality'])
    expect(Object.keys(tournament.teams)).toHaveLength(9)
  })

  it('renames in order and removes from entrants', () => {
    const renamed = renameTeams(blankTournament(), ['A', 'B'])
    expect(Object.values(renamed.teams).map((t) => t.name).slice(0, 3)).toEqual(['A', 'B', 'Team 3'])
    const removed = removeTeam(renamed, 'team-1')
    expect(removed.teams['team-1']).toBeUndefined()
    expect(removed.stages[0].entrants).toHaveLength(7)
  })

  it('removes several teams at once', () => {
    const removed = removeTeams(blankTournament(), ['team-1', 'team-3', 'team-missing'])
    expect(Object.keys(removed.teams)).not.toContain('team-1')
    expect(Object.keys(removed.teams)).not.toContain('team-3')
    expect(Object.keys(removed.teams)).toHaveLength(6)
    expect(removed.stages[0].entrants).toHaveLength(6)
  })
})

describe('eliminationRounds', () => {
  it('lists single-elimination rounds with default names', () => {
    const rounds = eliminationRounds(cs2Major.stages[3])
    expect(rounds.map((r) => [r.defaultName, r.defaultBestOf])).toEqual([
      ['Quarter-finals', 3],
      ['Semi-finals', 3],
      ['Final', 3],
    ])
  })

  it('lists upper and lower rounds for double elimination', () => {
    const stage: Stage = { ...blankTournament().stages[0], config: defaultConfig('double-elim') }
    const rounds = eliminationRounds(stage)
    expect(rounds.filter((r) => r.side === 'upper')).toHaveLength(3)
    expect(rounds.filter((r) => r.side === 'lower')).toHaveLength(4)
  })
})

describe('previewStage', () => {
  it('fills placements with placeholder teams', () => {
    const preview = previewStage(cs2Major, 'playoffs')!
    expect(preview.computed.status).toBe('in-progress')
    expect(preview.computed.matches[0].slots.map((s) => preview.teams[s.teamId!].name)).toEqual([
      '1st in Stage 3',
      '8th in Stage 3',
    ])
  })
})

describe('instantiate', () => {
  it('deep-copies with a fresh ID', () => {
    const copy = instantiate(cs2Major)
    expect(copy.id).not.toBe(cs2Major.id)
    copy.stages[0].name = 'Changed'
    expect(cs2Major.stages[0].name).toBe('Stage 1')
  })

  it('makes a valid blank tournament', () => {
    expect(validateTournament(blankTournament())).toEqual([])
  })
})

describe('duplicating stages', () => {
  const stage = (t: { stages: Stage[] }, id: string) => t.stages.find((s) => s.id === id)!

  it('copies a stage into the same phase, taking the next free places', () => {
    const { tournament, stageId } = duplicateStage(cs2Major, 'playoffs')
    const copy = stage(tournament, stageId)
    const original = stage(cs2Major, 'playoffs')
    expect(copy).toMatchObject({ id: 'playoffs-2', name: `${original.name} (2)`, phase: original.phase, config: original.config })
    expect(copy.entrants.map((e) => (e.kind === 'placement' ? `${e.stageId}#${e.place}` : e.kind))).toEqual(
      Array.from({ length: 8 }, (_, i) => `stage-3#${9 + i}`),
    )
    // Shown right after the original.
    expect(tournament.stages.map((s) => s.id).indexOf(stageId)).toBe(tournament.stages.map((s) => s.id).indexOf('playoffs') + 1)
    expect(validateTournament(tournament)).toEqual([])
  })

  it('gives invited teams and used-up places new placeholder teams', () => {
    const teamsBefore = Object.keys(cs2Major.teams).length
    const once = duplicateStage(cs2Major, 'stage-1')
    const copy = stage(once.tournament, once.stageId)
    expect(copy.entrants.every((e) => e.kind === 'team' && !(e.teamId in cs2Major.teams))).toBe(true)
    expect(Object.keys(once.tournament.teams)).toHaveLength(teamsBefore + copy.entrants.length)
    expect(validateTournament(once.tournament)).toEqual([])

    // Stage 3 has 16 places: two copies of the 8-team playoffs use them up.
    const twice = duplicateStage(duplicateStage(cs2Major, 'playoffs').tournament, 'playoffs')
    const third = stage(twice.tournament, twice.stageId)
    expect(third.entrants.every((e) => e.kind === 'team')).toBe(true)
    expect(validateTournament(twice.tournament)).toEqual([])
  })

  it('copies a phase into a new phase after it, moving later phases back', () => {
    const { tournament, stageIds } = duplicatePhase(groupsPlayoffs, 0)
    const groups = groupsPlayoffs.stages.filter((s) => s.phase === 0)
    expect(stageIds).toHaveLength(groups.length)
    for (const id of stageIds) expect(stage(tournament, id).phase).toBe(1)
    expect(stage(tournament, 'playoffs').phase).toBe(2)
    expect(validateTournament(tournament)).toEqual([])
    // Picks and results are separate from the design, and the original is untouched.
    expect(groupsPlayoffs.stages.every((s) => !stageIds.includes(s.id))).toBe(true)
  })
})
