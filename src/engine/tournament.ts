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
import { computeSwiss, DEFAULT_RATING, type SwissState } from './swiss'

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
  /** Elimination stages only: places each team that's done can still finish in (1-based, inclusive). */
  places?: Record<TeamId, [number, number]>
  /**
   * Waiting stages only: teams already certain to enter through places in
   * earlier stages, before those stages finish. Their seeds aren't known yet.
   */
  qualified?: { teamId: TeamId; stageId: StageId }[]
  error?: string
}

/** Places each finished team in a stage can still end up in, for any format. */
export const placesOf = (computed: ComputedStage | undefined): Record<TeamId, [number, number]> =>
  computed?.places ?? computed?.swiss?.places ?? {}

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
  ratings: Record<TeamId, number | undefined>,
): Pick<ComputedStage, 'matches' | 'ranking' | 'swiss' | 'places'> & { complete: boolean } {
  switch (config.format) {
    case 'swiss': {
      const swiss = computeSwiss({ seeds, config, results, randomSeed, scoring, ratings })
      return { matches: swiss.rounds.flat(), ranking: swiss.ranking, complete: swiss.complete, swiss }
    }
    case 'single-elim':
      return computeSingleElim({ seeds, config, results, randomSeed, scoring })
    case 'double-elim':
      return computeDoubleElim({ seeds, config, results, randomSeed, scoring })
  }
}

/** Every best-of a stage config can use. */
function bestOfsIn(config: StageConfig): (BestOf | null | undefined)[] {
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
  const stageById = (id: StageId) => tournament.stages.find((s) => s.id === id)
  const unordered = stage.entrants.find((e) => e.kind === 'placement' && !((stageById(e.stageId)?.phase ?? Infinity) < stage.phase))
  if (unordered?.kind === 'placement') {
    const name = stageById(unordered.stageId)?.name ?? unordered.stageId
    return { ...base, status: 'invalid', seeds: null, error: `Draws from ${name}, which doesn't come before it` }
  }

  const resolveEntrant = (source: EntrantSource): TeamId | null => {
    if (source.kind === 'team') return source.teamId
    const from = earlier[source.stageId]
    if (from?.status !== 'complete') return null
    return from.ranking[source.place - 1] ?? null
  }
  const resolved = stage.entrants.map(resolveEntrant)
  if (resolved.some((id) => id === null)) {
    // Worked out on first read only: the simulator passes through waiting stages thousands of times.
    let qualified: ComputedStage['qualified']
    return Object.defineProperty({ ...base, status: 'waiting', seeds: null } as ComputedStage, 'qualified', {
      enumerable: true,
      get: () => (qualified ??= clinched(stage, earlier)),
    })
  }

  const seeds = stage.config.format !== 'swiss' && stage.config.seedOrder === 'live-rating'
    ? byLiveRating(tournament, stage.entrants, resolved as TeamId[], earlier)
    : (resolved as TeamId[])
  try {
    const randomSeed = stageRandomSeed(tournament.randomSeed ?? 0, stage.id)
    const fromSeeds = stage.config.format === 'swiss' && stage.config.ratingStart === 'seed'
    const ratings = fromSeeds ? {} : Object.fromEntries(seeds.map((id) => [id, tournament.teams[id]?.rating]))
    const scoring = tournament.rules?.scoring ?? FREE_SCORING
    const { complete, ...out } = computeStage(stage.config, seeds, results, randomSeed, scoring, ratings)
    return { stageId: stage.id, status: complete ? 'complete' : 'in-progress', seeds, ...out }
  } catch (e) {
    return { ...base, status: 'invalid', seeds, error: (e as Error).message }
  }
}

/**
 * Reorders `seeds` by live rating, highest first. A team that qualified from
 * a Swiss stage uses the rating it finished that stage with; any other team
 * uses its team rating. Ties keep entrant order.
 */
function byLiveRating(
  tournament: Tournament,
  entrants: EntrantSource[],
  seeds: TeamId[],
  earlier: Record<StageId, ComputedStage>,
): TeamId[] {
  const ratingOf = (id: TeamId, i: number) => {
    const source = entrants[i]
    const swiss = source.kind === 'placement' ? earlier[source.stageId]?.swiss : undefined
    return swiss?.standings[id]?.rating ?? tournament.teams[id]?.rating ?? DEFAULT_RATING
  }
  return seeds
    .map((id, i) => ({ id, i, rating: ratingOf(id, i) }))
    .sort((a, b) => b.rating - a.rating || a.i - b.i)
    .map((s) => s.id)
}

/**
 * Teams certain to enter `stage` from earlier stages that haven't finished:
 * every place they can still end up in is one this stage takes.
 */
function clinched(stage: Stage, earlier: Record<StageId, ComputedStage>): ComputedStage['qualified'] {
  const taken = new Map<StageId, Set<number>>()
  for (const e of stage.entrants) if (e.kind === 'placement') taken.set(e.stageId, (taken.get(e.stageId) ?? new Set()).add(e.place))
  const qualified: NonNullable<ComputedStage['qualified']> = []
  for (const [stageId, places] of taken) {
    const from = earlier[stageId]
    if (from?.status !== 'in-progress') continue
    const ranges = placesOf(from)
    const sure = Object.entries(ranges).filter(([, [lo, hi]]) => {
      for (let p = lo; p <= hi; p++) if (!places.has(p)) return false
      return true
    })
    // Best possible place first, then the stage's current ranking.
    const rank = new Map(from.ranking.map((id, i) => [id, i]))
    sure.sort(([a, [la]], [b, [lb]]) => la - lb || rank.get(a)! - rank.get(b)!)
    qualified.push(...sure.map(([teamId]) => ({ teamId, stageId })))
  }
  return qualified
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
  // Messages use names, since that's what the user sees.
  const stageName = (id: StageId) => byId.get(id)?.name ?? id
  const teamName = (id: TeamId) => tournament.teams[id]?.name ?? id

  for (const stage of tournament.stages) {
    const issue = (message: string) => issues.push({ stageId: stage.id, message })
    const min = MIN_TEAMS[stage.config.format]
    if (stage.entrants.length < min) issue(`Needs at least ${min} teams, has ${stage.entrants.length}`)

    for (const entrant of stage.entrants) {
      if (entrant.kind === 'team') {
        if (!tournament.teams[entrant.teamId]) issue(`Unknown team "${entrant.teamId}"`)
        const other = invitedTo.get(entrant.teamId)
        if (other) issue(`${teamName(entrant.teamId)} is also entered in ${stageName(other)}`)
        invitedTo.set(entrant.teamId, stage.id)
        continue
      }

      const from = byId.get(entrant.stageId)
      if (!from) {
        issue(`Draws from unknown stage "${entrant.stageId}"`)
        continue
      }
      if (from.phase >= stage.phase) issue(`Draws from ${from.name}, which must be in an earlier phase`)
      if (!Number.isInteger(entrant.place) || entrant.place < 1 || entrant.place > from.entrants.length)
        issue(`Place ${entrant.place} doesn't exist in ${from.name} (${from.entrants.length} teams)`)

      const key = `${from.id}#${entrant.place}`
      const other = placementUsedBy.get(key)
      if (other) issue(`Place ${entrant.place} of ${from.name} is also used by ${stageName(other)}`)
      placementUsedBy.set(key, stage.id)
    }

    const config = stage.config
    if (config.format === 'swiss' && (config.winsToAdvance < 1 || config.lossesToEliminate < 1))
      issue('Wins to advance and losses to eliminate must be at least 1')
    for (const bestOf of bestOfsIn(config)) {
      if (bestOf != null && bestOfError(bestOf)) issue(`Best-of ${bestOf} must be an odd number`)
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
