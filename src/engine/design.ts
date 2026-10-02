import type {
  BestOf,
  EntrantSource,
  Match,
  Stage,
  StageConfig,
  StageFormat,
  StageId,
  Team,
  TeamId,
  Tournament,
} from '../types'
import { buildDoubleElim } from './double-elim'
import { bracketSize } from './elimination/bracket'
import { buildSingleElim } from './single-elim'
import { computeStageIn, playOrder, type ComputedStage } from './tournament'

/** Helpers for editing a tournament's design. All return new objects. */

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item'

/** `base`, or `base-2`, `base-3`, ... whichever isn't taken. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** `name`, or `name (2)`, `name (3)`, ... whichever isn't taken. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(name)) return name
  let n = 2
  while (used.has(`${name} (${n})`)) n++
  return `${name} (${n})`
}

export const ordinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

export const FORMAT_LABEL: Record<StageFormat, string> = {
  swiss: 'Swiss',
  'single-elim': 'Single elimination',
  'double-elim': 'Double elimination',
}

/**
 * A fresh config for `format`. When switching from another format, the
 * settings both share (best-of, seeding) carry over.
 */
export function defaultConfig(format: StageFormat, from?: StageConfig): StageConfig {
  const bestOf = from?.bestOf ?? 1
  const seeding = from && from.format !== 'swiss' ? from.seeding : 'standard'
  switch (format) {
    case 'swiss':
      return {
        format,
        winsToAdvance: 3,
        lossesToEliminate: 3,
        bestOf,
        firstRoundPairing: 'high-low',
        pairing: 'buchholz',
        avoidRematches: true,
        tiebreakers: ['buchholz', 'seed'],
      }
    case 'single-elim':
      return { format, bestOf, seeding, thirdPlaceMatch: false }
    case 'double-elim':
      return { format, bestOf, seeding, grandFinalReset: false }
  }
}

/** Sets one per-round override, counted back from the final, trimming trailing blanks. */
export function setFromFinal<T>(values: T[] | undefined, index: number, value: T | undefined): T[] | undefined {
  const next: (T | undefined)[] = [...(values ?? [])]
  while (next.length <= index) next.push(undefined)
  next[index] = value
  while (next.length > 0 && (next.at(-1) === undefined || next.at(-1) === null || next.at(-1) === '')) next.pop()
  return next.length > 0 ? (next as T[]) : undefined
}

/** Renumbers phases 0, 1, 2, ... keeping their order. */
export function normalizePhases(stages: Stage[]): Stage[] {
  const phases = [...new Set(stages.map((s) => s.phase))].sort((a, b) => a - b)
  return stages.map((s) => ({ ...s, phase: phases.indexOf(s.phase) }))
}

export const phasesOf = (stages: Stage[]) => [...new Set(stages.map((s) => s.phase))].sort((a, b) => a - b)

const placements = (stageId: StageId, from: number, to: number): EntrantSource[] =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => ({ kind: 'placement', stageId, place: from + i }))

/**
 * Adds a single-elimination stage in a new last phase. It takes the top
 * half (at least 2) of the previous last stage's places, so it's usable
 * straight away.
 */
export function addStage(tournament: Tournament): { tournament: Tournament; stageId: StageId } {
  const id = uniqueId(`stage-${tournament.stages.length + 1}`, tournament.stages.map((s) => s.id))
  const last = playOrder(tournament.stages).at(-1)
  const take = last ? Math.max(2, Math.floor(last.entrants.length / 2)) : 0
  const stage: Stage = {
    id,
    name: `Stage ${tournament.stages.length + 1}`,
    phase: last ? last.phase + 1 : 0,
    config: defaultConfig('single-elim'),
    entrants: last ? placements(last.id, 1, Math.min(take, last.entrants.length)) : [],
  }
  return { tournament: { ...tournament, stages: [...tournament.stages, stage] }, stageId: id }
}

/** Removes a stage, and every entrant that drew from it. */
export function removeStage(tournament: Tournament, stageId: StageId): Tournament {
  const stages = tournament.stages
    .filter((s) => s.id !== stageId)
    .map((s) => ({ ...s, entrants: s.entrants.filter((e) => !(e.kind === 'placement' && e.stageId === stageId)) }))
  return { ...tournament, stages: normalizePhases(stages) }
}

export function updateStage(tournament: Tournament, stageId: StageId, update: (stage: Stage) => Stage): Tournament {
  return { ...tournament, stages: tournament.stages.map((s) => (s.id === stageId ? update(s) : s)) }
}

/** Moves a stage to `phase` (pass one past the last phase for a new phase), then renumbers. */
export function moveStageToPhase(tournament: Tournament, stageId: StageId, phase: number): Tournament {
  return { ...tournament, stages: normalizePhases(updateStage(tournament, stageId, (s) => ({ ...s, phase })).stages) }
}

/** Swaps a stage with its neighbour, keeping phases. Changes display order only. */
export function moveStage(tournament: Tournament, stageId: StageId, by: -1 | 1): Tournament {
  const stages = [...tournament.stages]
  const i = stages.findIndex((s) => s.id === stageId)
  const j = i + by
  if (i < 0 || j < 0 || j >= stages.length) return tournament
  ;[stages[i], stages[j]] = [stages[j], stages[i]]
  return { ...tournament, stages }
}

/**
 * Adds teams by name, reusing any existing team with the same name
 * (ignoring case). Returns the IDs in the order given.
 */
export function addTeams(tournament: Tournament, names: string[]): { tournament: Tournament; ids: TeamId[] } {
  const teams = { ...tournament.teams }
  const byName = new Map(Object.values(teams).map((t) => [t.name.trim().toLowerCase(), t.id]))
  const ids: TeamId[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    let id = byName.get(name.toLowerCase())
    if (!id) {
      id = uniqueId(`team-${slugify(name)}`, Object.keys(teams))
      teams[id] = { id, name }
      byName.set(name.toLowerCase(), id)
    }
    ids.push(id)
  }
  return { tournament: { ...tournament, teams }, ids }
}

/** A new team named "Team N" with the first free N. */
export function addBlankTeam(tournament: Tournament): { tournament: Tournament; id: TeamId } {
  const names = new Set(Object.values(tournament.teams).map((t) => t.name))
  let n = Object.keys(tournament.teams).length + 1
  while (names.has(`Team ${n}`)) n++
  const { tournament: next, ids } = addTeams(tournament, [`Team ${n}`])
  return { tournament: next, id: ids[0] }
}

/** Renames teams in list order; extra names are ignored. */
export function renameTeams(tournament: Tournament, names: string[]): Tournament {
  const cleaned = names.map((n) => n.trim()).filter(Boolean)
  const teams = { ...tournament.teams }
  Object.keys(teams).forEach((id, i) => {
    if (cleaned[i]) teams[id] = { ...teams[id], name: cleaned[i] }
  })
  return { ...tournament, teams }
}

/** Removes a team and every entrant slot that named it. */
export function removeTeam(tournament: Tournament, teamId: TeamId): Tournament {
  const teams = { ...tournament.teams }
  delete teams[teamId]
  const stages = tournament.stages.map((s) => ({
    ...s,
    entrants: s.entrants.filter((e) => !(e.kind === 'team' && e.teamId === teamId)),
  }))
  return { ...tournament, teams, stages }
}

/** Stage each team is entered in directly. */
export function teamEntries(tournament: Tournament): Map<TeamId, StageId> {
  const entries = new Map<TeamId, StageId>()
  for (const stage of tournament.stages) {
    for (const e of stage.entrants) if (e.kind === 'team' && !entries.has(e.teamId)) entries.set(e.teamId, stage.id)
  }
  return entries
}

/** Which stage takes each place of `stageId` (1-based places). */
export function placementUses(tournament: Tournament, stageId: StageId): Map<number, StageId> {
  const uses = new Map<number, StageId>()
  for (const stage of tournament.stages) {
    for (const e of stage.entrants) if (e.kind === 'placement' && e.stageId === stageId) uses.set(e.place, stage.id)
  }
  return uses
}

/** Groups consecutive numbers into ranges, e.g. [1, 2, 3, 5] -> "1–3, 5". */
export function formatRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`)
    i = j
  }
  return parts.join(', ')
}

/** "8 teams, 8 from Stage 1 (1–8)": where a stage's entrants come from. */
export function describeEntrants(tournament: Tournament, stage: Stage): string {
  const invites = stage.entrants.filter((e) => e.kind === 'team').length
  const parts: string[] = []
  if (invites) parts.push(`${invites} invited`)
  const byStage = new Map<StageId, number[]>()
  for (const e of stage.entrants) if (e.kind === 'placement') byStage.set(e.stageId, [...(byStage.get(e.stageId) ?? []), e.place])
  for (const [id, places] of byStage) {
    const name = tournament.stages.find((s) => s.id === id)?.name ?? id
    parts.push(`${places.length} from ${name} (${formatRanges(places)})`)
  }
  return parts.join(', ') || 'No entrants'
}

/** One round of an elimination stage, with the engine's default name and best-of. */
export interface RoundInfo {
  side: 'main' | 'upper' | 'lower'
  /** 0 = the final of this side. */
  fromFinal: number
  defaultName: string
  defaultBestOf: BestOf
}

/**
 * The rounds an elimination stage will have with its current entrant
 * count, ordered from the first round to the final. Empty when the stage
 * has too few entrants.
 */
export function eliminationRounds(stage: Stage): RoundInfo[] {
  const { config } = stage
  const count = stage.entrants.length
  if (config.format === 'swiss') return []
  const toRounds = (nodes: Pick<Match, 'side' | 'round' | 'label' | 'bestOf'>[], side: RoundInfo['side']) => {
    const rounds = new Map<number, RoundInfo>()
    const sideNodes = nodes.filter((n) => n.side === side)
    const last = Math.max(...sideNodes.map((n) => n.round))
    for (const n of sideNodes) {
      if (!rounds.has(n.round))
        rounds.set(n.round, { side, fromFinal: last - n.round, defaultName: n.label ?? '', defaultBestOf: n.bestOf })
    }
    return [...rounds.values()].sort((a, b) => b.fromFinal - a.fromFinal)
  }
  if (config.format === 'single-elim') {
    if (count < 2) return []
    const plain = { ...config, roundNamesFromFinal: undefined, bestOfFromFinal: undefined }
    return toRounds(buildSingleElim(count, plain), 'main')
  }
  if (count < 3) return []
  const plain = {
    ...config,
    upperRoundNamesFromFinal: undefined,
    lowerRoundNamesFromFinal: undefined,
    upperBestOfFromFinal: undefined,
    lowerBestOfFromFinal: undefined,
  }
  const nodes = buildDoubleElim(count, plain)
  return [...toRounds(nodes, 'upper'), ...toRounds(nodes, 'lower')]
}

/** "Bracket of 8" or "Bracket of 16 (3 byes)" for elimination stages. */
export function bracketSummary(teamCount: number): string {
  if (teamCount < 2) return ''
  const size = bracketSize(teamCount)
  const byes = size - teamCount
  return byes ? `Bracket of ${size} (${byes} ${byes === 1 ? 'bye' : 'byes'})` : `Bracket of ${size}`
}

/** "3W / 3L · Bo1 (Bo3 to advance/eliminate)" style one-liner for a stage card. */
export function describeConfig(config: StageConfig): string {
  switch (config.format) {
    case 'swiss': {
      const extras: string[] = []
      if (config.advancementBestOf && config.advancementBestOf === config.eliminationBestOf)
        extras.push(`Bo${config.advancementBestOf} to advance/eliminate`)
      else {
        if (config.advancementBestOf) extras.push(`Bo${config.advancementBestOf} to advance`)
        if (config.eliminationBestOf) extras.push(`Bo${config.eliminationBestOf} to eliminate`)
      }
      return `${config.winsToAdvance}W / ${config.lossesToEliminate}L · Bo${config.bestOf}${extras.length ? ` (${extras.join(', ')})` : ''}`
    }
    case 'single-elim': {
      const parts = [`Bo${config.bestOf}`]
      if (config.reseed) parts.push('reseeded')
      if (config.thirdPlaceMatch) parts.push('3rd place match')
      return parts.join(' · ')
    }
    case 'double-elim': {
      const parts = [`Bo${config.bestOf}`]
      if (config.finals === 'upper-final-decides') parts.push('upper final decides 1st/2nd')
      else if (config.finals === 'no-grand-final') parts.push('no grand final')
      else {
        if (config.grandFinalBestOf) parts.push(`Bo${config.grandFinalBestOf} grand final`)
        if (config.grandFinalReset) parts.push('grand final reset')
      }
      return parts.join(' · ')
    }
  }
}

/** Short label for a placeholder team, e.g. "S1·3" for 3rd in Stage 1. */
function placeholderShortName(stageName: string, place: number) {
  const words = stageName.trim().split(/\s+/)
  const prefix = words.map((w) => (/^\d+$/.test(w) ? w : w[0]?.toUpperCase() ?? '')).join('').slice(0, 2)
  return `${prefix}·${place}`.slice(0, 4)
}

/**
 * Computes a stage as it would start, without results, with placements
 * from earlier stages standing in as placeholder teams ("3rd in Stage 1").
 */
export function previewStage(tournament: Tournament, stageId: StageId): { computed: ComputedStage; teams: Record<TeamId, Team>; stage: Stage } | null {
  const stage = tournament.stages.find((s) => s.id === stageId)
  if (!stage) return null
  const teams: Record<TeamId, Team> = { ...tournament.teams }
  const entrants: EntrantSource[] = stage.entrants.map((e, i) => {
    if (e.kind === 'team') return e
    const from = tournament.stages.find((s) => s.id === e.stageId)?.name ?? e.stageId
    const id = `preview:${i}`
    teams[id] = { id, name: `${ordinal(e.place)} in ${from}`, shortName: placeholderShortName(from, e.place) }
    return { kind: 'team', teamId: id }
  })
  const previewStage: Stage = { ...stage, phase: 0, entrants }
  const preview: Tournament = { ...tournament, teams, stages: [previewStage] }
  return { computed: computeStageIn(preview, previewStage, {}, {}), teams, stage: previewStage }
}

const randomSuffix = () => Math.random().toString(36).slice(2, 8)

/** A deep copy of `template` with a fresh ID, ready to be edited as a new tournament. */
export function instantiate(template: Tournament, name = template.name): Tournament {
  const copy = structuredClone(template)
  return { ...copy, id: `${slugify(name)}-${randomSuffix()}`, name }
}

/** 8 placeholder teams in one single-elimination stage. */
export function blankTournament(): Tournament {
  const teams: Record<TeamId, Team> = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`team-${i + 1}`, { id: `team-${i + 1}`, name: `Team ${i + 1}` }]),
  )
  return {
    id: `tournament-${randomSuffix()}`,
    name: 'New tournament',
    teams,
    rules: { scoring: { kind: 'free' } },
    stages: [
      {
        id: 'stage-1',
        name: 'Playoffs',
        phase: 0,
        config: defaultConfig('single-elim'),
        entrants: Object.keys(teams).map((teamId) => ({ kind: 'team', teamId })),
      },
    ],
  }
}
