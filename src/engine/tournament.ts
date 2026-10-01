import type {
  BestOf,
  EntrantSource,
  GameScoring,
  Match,
  MatchId,
  MatchReport,
  Stage,
  StageConfig,
  StageId,
  TeamId,
  Tournament,
  TournamentResults,
} from '../types'
import { computeDoubleElim } from './double-elim'
import { bestOfError } from './results'
import { FREE_SCORING } from './rules'
import { computeSingleElim } from './single-elim'
import { computeSwiss, type SwissState } from './swiss'

export type StageStatus = 'waiting' | 'in-progress' | 'complete' | 'invalid'

export interface ComputedStage {
  stageId: StageId
  status: StageStatus
  /** Resolved teams in seed order; null while waiting on an earlier stage. */
  seeds: TeamId[] | null
  matches: Match[]
  /** Teams ranked best to worst (index 0 = place 1). Final once complete. */
  ranking: TeamId[]
  /** Swiss stages only: rounds, standings and team status. */
  swiss?: SwissState
  error?: string
}

export interface TournamentState {
  stages: Record<StageId, ComputedStage>
}

export interface TournamentIssue {
  stageId?: StageId
  message: string
}

const MIN_TEAMS: Record<StageConfig['format'], number> = {
  swiss: 2,
  'single-elim': 2,
  'double-elim': 3,
}

/** Stable per-stage seed, so each stage's random choices are independent. */
function stageRandomSeed(tournamentSeed: number, stageId: StageId) {
  let hash = tournamentSeed >>> 0
  for (const ch of stageId) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0
  return hash
}

function computeStage(
  config: StageConfig,
  seeds: TeamId[],
  results: Record<MatchId, MatchReport>,
  randomSeed: number,
  scoring: GameScoring,
): Pick<ComputedStage, 'matches' | 'ranking' | 'swiss'> & { complete: boolean } {
  switch (config.format) {
    case 'swiss': {
      const swiss = computeSwiss({ seeds, config, results, randomSeed, scoring })
      return { matches: swiss.rounds.flat(), ranking: swiss.ranking, complete: swiss.complete, swiss }
    }
    case 'single-elim':
      return computeSingleElim({ seeds, config, results, randomSeed, scoring })
    case 'double-elim':
      return computeDoubleElim({ seeds, config, results, randomSeed, scoring })
  }
}

/** Every best-of a stage config can use. */
function bestOfsIn(config: StageConfig): (BestOf | undefined)[] {
  switch (config.format) {
    case 'swiss':
      return [config.bestOf, config.advancementBestOf, config.eliminationBestOf]
    case 'single-elim':
      return [config.bestOf, ...(config.bestOfFromFinal ?? [])]
    case 'double-elim':
      return [
        config.bestOf,
        config.grandFinalBestOf,
        ...(config.upperBestOfFromFinal ?? []),
        ...(config.lowerBestOfFromFinal ?? []),
      ]
  }
}

/** Stages in play order: by phase, keeping list order within a phase. */
export const playOrder = (stages: Stage[]) => [...stages].sort((a, b) => a.phase - b.phase)

/**
 * Computes one stage, given the already-computed stages it may draw from.
 * Seeded once every stage it draws placements from is complete.
 */
export function computeStageIn(
  tournament: Tournament,
  stage: Stage,
  earlier: Record<StageId, ComputedStage>,
  results: Record<MatchId, MatchReport>,
): ComputedStage {
  const base = { stageId: stage.id, matches: [], ranking: [] }
  const phaseOf = (id: StageId) => tournament.stages.find((s) => s.id === id)?.phase ?? Infinity
  const unordered = stage.entrants.find((e) => e.kind === 'placement' && !(phaseOf(e.stageId) < stage.phase))
  if (unordered?.kind === 'placement') {
    return { ...base, status: 'invalid', seeds: null, error: `Draws from "${unordered.stageId}", which doesn't come before it` }
  }

  const resolveEntrant = (source: EntrantSource): TeamId | null => {
    if (source.kind === 'team') return source.teamId
    const from = earlier[source.stageId]
    if (from?.status !== 'complete') return null
    return from.ranking[source.place - 1] ?? null
  }
  const resolved = stage.entrants.map(resolveEntrant)
  if (resolved.some((id) => id === null)) return { ...base, status: 'waiting', seeds: null }

  const seeds = resolved as TeamId[]
  try {
    const randomSeed = stageRandomSeed(tournament.randomSeed ?? 0, stage.id)
    const { complete, ...out } = computeStage(stage.config, seeds, results, randomSeed, tournament.rules?.scoring ?? FREE_SCORING)
    return { stageId: stage.id, status: complete ? 'complete' : 'in-progress', seeds, ...out }
  } catch (e) {
    return { ...base, status: 'invalid', seeds, error: (e as Error).message }
  }
}

/** Computes every stage from the tournament definition and results. */
export function computeTournament(tournament: Tournament, results: TournamentResults): TournamentState {
  const stages: Record<StageId, ComputedStage> = {}
  for (const stage of playOrder(tournament.stages)) {
    stages[stage.id] = computeStageIn(tournament, stage, stages, results[stage.id] ?? {})
  }
  return { stages }
}

/** Checks a tournament definition for mistakes a user could make in the designer. */
export function validateTournament(tournament: Tournament): TournamentIssue[] {
  const issues: TournamentIssue[] = []
  const byId = new Map<StageId, Stage>()
  for (const stage of tournament.stages) {
    if (byId.has(stage.id)) issues.push({ stageId: stage.id, message: `Duplicate stage ID "${stage.id}"` })
    byId.set(stage.id, stage)
  }

  const invitedTo = new Map<TeamId, StageId>()
  const placementUsedBy = new Map<string, StageId>()

  for (const stage of tournament.stages) {
    const issue = (message: string) => issues.push({ stageId: stage.id, message })
    const min = MIN_TEAMS[stage.config.format]
    if (stage.entrants.length < min) issue(`Needs at least ${min} teams, has ${stage.entrants.length}`)

    for (const entrant of stage.entrants) {
      if (entrant.kind === 'team') {
        if (!tournament.teams[entrant.teamId]) issue(`Unknown team "${entrant.teamId}"`)
        const other = invitedTo.get(entrant.teamId)
        if (other) issue(`Team "${entrant.teamId}" is also entered in "${other}"`)
        invitedTo.set(entrant.teamId, stage.id)
        continue
      }

      const from = byId.get(entrant.stageId)
      if (!from) {
        issue(`Draws from unknown stage "${entrant.stageId}"`)
        continue
      }
      if (from.phase >= stage.phase) issue(`Draws from "${from.id}", which must be in an earlier phase`)
      if (!Number.isInteger(entrant.place) || entrant.place < 1 || entrant.place > from.entrants.length)
        issue(`Place ${entrant.place} doesn't exist in "${from.id}" (${from.entrants.length} teams)`)

      const key = `${from.id}#${entrant.place}`
      const other = placementUsedBy.get(key)
      if (other) issue(`Place ${entrant.place} of "${from.id}" is also used by "${other}"`)
      placementUsedBy.set(key, stage.id)
    }

    const config = stage.config
    if (config.format === 'swiss' && (config.winsToAdvance < 1 || config.lossesToEliminate < 1))
      issue('Wins to advance and losses to eliminate must be at least 1')
    for (const bestOf of bestOfsIn(config)) {
      if (bestOf !== undefined && bestOfError(bestOf)) issue(`Best-of ${bestOf} must be an odd number`)
    }
  }

  const scoring = tournament.rules?.scoring
  if (scoring?.kind === 'first-to') {
    if (!Number.isInteger(scoring.target) || scoring.target < 1) issues.push({ message: 'Points to win a game must be at least 1' })
    if (scoring.overtime && (!Number.isInteger(scoring.overtime.firstTo) || scoring.overtime.firstTo < 2))
      issues.push({ message: 'Overtime must be first to at least 2' })
  }
  return issues
}
