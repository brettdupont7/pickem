import type { EntrantSource, Stage, StageConfig, Team, Tournament, TournamentResults } from '../types'
import { defaultConfig } from './design'
import { emptyLayers, hasResults, splitBySource, type ResultLayers } from './layers'

/**
 * Tournament files: a tournament, optionally with its results.
 * Version 1 kept picks and actual results together in `results`; since
 * version 2, `results` holds actual results and `picks` holds predictions.
 */

export const FILE_FORMAT = 'pickem-tournament'
export const FILE_VERSION = 2

export interface TournamentFile {
  format: typeof FILE_FORMAT
  version: number
  tournament: Tournament
  /** Actual results. */
  results?: TournamentResults
  /** Picks and simulated results. */
  picks?: TournamentResults
}

export function serializeTournament(tournament: Tournament, layers?: ResultLayers): string {
  const file: TournamentFile = { format: FILE_FORMAT, version: FILE_VERSION, tournament }
  if (layers && hasResults(layers.actual)) file.results = layers.actual
  if (layers && hasResults(layers.picks)) file.picks = layers.picks
  return JSON.stringify(file, null, 2)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const FORMATS = ['swiss', 'single-elim', 'double-elim'] as const

function parseTeams(value: unknown): Record<string, Team> {
  if (!isObject(value)) throw new Error('"teams" must be an object of teams keyed by ID')
  const teams: Record<string, Team> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!isObject(raw) || typeof raw.name !== 'string') throw new Error(`Team "${id}" needs a name`)
    teams[id] = { ...(raw as unknown as Team), id }
  }
  return teams
}

function parseEntrant(value: unknown, stageName: string): EntrantSource {
  if (isObject(value) && value.kind === 'team' && typeof value.teamId === 'string') return { kind: 'team', teamId: value.teamId }
  if (isObject(value) && value.kind === 'placement' && typeof value.stageId === 'string' && typeof value.place === 'number')
    return { kind: 'placement', stageId: value.stageId, place: value.place }
  throw new Error(`Stage "${stageName}" has an entrant that isn't a team or a placement`)
}

function parseStage(value: unknown, index: number): Stage {
  if (!isObject(value)) throw new Error(`Stage ${index + 1} isn't an object`)
  const name = typeof value.name === 'string' ? value.name : `Stage ${index + 1}`
  if (typeof value.id !== 'string') throw new Error(`Stage "${name}" needs an ID`)
  const config = value.config
  if (!isObject(config) || !FORMATS.includes(config.format as (typeof FORMATS)[number]))
    throw new Error(`Stage "${name}" needs a format: ${FORMATS.join(', ')}`)
  if (!Array.isArray(value.entrants)) throw new Error(`Stage "${name}" needs a list of entrants`)
  return {
    id: value.id,
    name,
    phase: typeof value.phase === 'number' ? value.phase : index,
    // Missing settings fall back to the defaults for the format.
    config: { ...defaultConfig(config.format as StageConfig['format']), ...config } as StageConfig,
    entrants: value.entrants.map((e) => parseEntrant(e, name)),
  }
}

/**
 * Reads a tournament file, or a bare tournament object. Checks the shape
 * enough for the app to load it; use `validateTournament` for mistakes in
 * the design itself. Throws an Error with a readable message.
 */
export function parseTournamentFile(text: string): { tournament: Tournament; layers: ResultLayers } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("This file isn't valid JSON")
  }
  if (!isObject(data)) throw new Error("This file doesn't contain a tournament")
  const raw = data.format === FILE_FORMAT ? data.tournament : data
  if (!isObject(raw) || !Array.isArray(raw.stages)) throw new Error("This file doesn't contain a tournament")

  const tournament: Tournament = {
    ...(raw as unknown as Tournament),
    id: typeof raw.id === 'string' ? raw.id : 'imported',
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Imported tournament',
    teams: parseTeams(raw.teams),
    stages: raw.stages.map(parseStage),
  }
  if (data.format !== FILE_FORMAT) return { tournament, layers: emptyLayers() }
  const results = isObject(data.results) ? (data.results as TournamentResults) : {}
  const picks = isObject(data.picks) ? (data.picks as TournamentResults) : {}
  const layers = typeof data.version === 'number' && data.version >= 2 ? { actual: results, picks } : splitBySource(results)
  return { tournament, layers }
}
