import type { MatchId, MatchReport } from './match'
import type { GameRules } from './rules'
import type { Stage, StageId } from './stage'
import type { Team, TeamId } from './team'

/**
 * Stages are linked through their `entrants`: a stage pulls teams in by
 * placement from earlier stages, so any graph of stages can be built
 * (Swiss into Swiss into playoffs, parallel groups merging, etc.).
 */
export interface Tournament {
  id: string
  name: string
  teams: Record<TeamId, Team>
  stages: Stage[]
  /** How games are scored and named. Defaults to free scoring. */
  rules?: GameRules
  /** Seed for random pairings, seeding and tiebreakers. */
  randomSeed?: number
}

/** Reports per stage, keyed by the engine's match IDs. */
export type TournamentResults = Record<StageId, Record<MatchId, MatchReport>>
