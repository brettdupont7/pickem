import type { BestOf } from './match'
import type { TeamId } from './team'

export type StageId = string

/**
 * How entrants are paired in an elimination bracket's first round.
 * - standard: 1v8, 4v5, 2v7, 3v6 (top seeds meet as late as possible)
 * - as-listed: entrants[0] v entrants[1], entrants[2] v entrants[3], ...
 * - random: shuffled, then paired as-listed
 * When the entrant count isn't a power of two, the top seeds get byes.
 */
export type EliminationSeeding = 'standard' | 'as-listed' | 'random'

/**
 * Which order entrants are seeded in, before `seeding` places them.
 * - entrants: as listed (e.g. by placement in an earlier stage)
 * - live-rating: highest live Elo rating first. Teams from a Swiss stage use
 *   the rating they finished it with; others use their team rating.
 */
export type SeedOrder = 'entrants' | 'live-rating'

export interface SingleElimConfig {
  format: 'single-elim'
  bestOf: BestOf
  /** Overrides counted back from the final: [final, semis, quarters, ...]. */
  bestOfFromFinal?: BestOf[]
  /** Round names counted back from the final, e.g. ['Super Bowl', 'Conference Championship']. */
  roundNamesFromFinal?: string[]
  seeding: EliminationSeeding
  /** Default 'entrants'. */
  seedOrder?: SeedOrder
  /**
   * Re-pair survivors after every round, best remaining seed v worst
   * (as in the NFL). Later rounds stay TBD until the round before finishes.
   */
  reseed?: boolean
  thirdPlaceMatch: boolean
}

/**
 * How a double-elimination bracket ends.
 * - grand-final: the upper final's loser drops to the lower final, and the
 *   upper and lower winners meet in a grand final.
 * - no-grand-final: as above, but there's no grand final: the upper
 *   winner places 1st and the lower winner 2nd.
 * - upper-final-decides: the upper final decides 1st and 2nd (its loser
 *   doesn't drop), and the lower bracket, one round shorter, decides 3rd.
 */
export type DoubleElimFinals = 'grand-final' | 'no-grand-final' | 'upper-final-decides'

export interface DoubleElimConfig {
  format: 'double-elim'
  bestOf: BestOf
  /** Overrides counted back from the upper final: [upper final, upper semis, ...]. */
  upperBestOfFromFinal?: BestOf[]
  /** Overrides counted back from the lower final: [lower final, lower semis, ...]. */
  lowerBestOfFromFinal?: BestOf[]
  grandFinalBestOf?: BestOf
  /** Round names counted back from the upper final. */
  upperRoundNamesFromFinal?: string[]
  /** Round names counted back from the lower final. */
  lowerRoundNamesFromFinal?: string[]
  seeding: EliminationSeeding
  /** Default 'entrants'. */
  seedOrder?: SeedOrder
  /** Default 'grand-final'. */
  finals?: DoubleElimFinals
  /** If the lower-bracket team wins the grand final, play a second series. Only with a grand final. */
  grandFinalReset: boolean
}

/**
 * First-round Swiss pairing, shown for 16 teams:
 * - high-low: 1v9, 2v10, ...
 * - fold: 1v16, 2v15, ...
 * - adjacent: 1v2, 3v4, ...
 * - random: shuffled, then adjacent
 */
export type SwissFirstRoundPairing = 'high-low' | 'fold' | 'adjacent' | 'random'

/**
 * Later Swiss rounds pair teams within the same W-L record.
 * - rating: by live Elo rating, updated after every match (as in ESL Pro League)
 */
export type SwissPairing = 'buchholz' | 'rating' | 'seed' | 'random'

/** Ranks teams with the same final record, in priority order. */
export type SwissTiebreaker = 'buchholz' | 'rating' | 'seed' | 'head-to-head' | 'random'

/**
 * A team advances on `winsToAdvance` wins and is eliminated on
 * `lossesToEliminate` losses, so the stage lasts at most
 * winsToAdvance + lossesToEliminate - 1 rounds (3/3 gives 5 rounds).
 */
export interface SwissConfig {
  format: 'swiss'
  winsToAdvance: number
  lossesToEliminate: number
  bestOf: BestOf
  /** Used when a win would advance the team (e.g. 2-0, 2-1, 2-2 in a 3/3 Swiss). */
  advancementBestOf?: BestOf
  /** Used when a loss would eliminate the team (e.g. 0-2, 1-2, 2-2 in a 3/3 Swiss). */
  eliminationBestOf?: BestOf
  firstRoundPairing: SwissFirstRoundPairing
  pairing: SwissPairing
  avoidRematches: boolean
  tiebreakers: SwissTiebreaker[]
  /** Elo K-factor for live ratings: the most a rating can move in one match. Default 32. */
  ratingK?: number
  /**
   * Where live ratings start. 'ratings' (default): team ratings, or seed
   * order if no team has one. 'seed': always seed order, as ESL Pro League
   * does, so team ratings (e.g. from VRS) only drive the simulator.
   */
  ratingStart?: 'ratings' | 'seed'
}

export type StageConfig = SingleElimConfig | DoubleElimConfig | SwissConfig
export type StageFormat = StageConfig['format']

/**
 * One entry slot of a stage. Either a team placed directly into the stage
 * (an invite) or whoever finishes at a given place in an earlier stage.
 */
export type EntrantSource =
  | { kind: 'team'; teamId: TeamId }
  /** 1-based final placement in `stageId`, e.g. place 1 = best record / winner. */
  | { kind: 'placement'; stageId: StageId; place: number }

export interface SwissStanding {
  teamId: TeamId
  wins: number
  losses: number
  /** Opponents faced so far, used to avoid rematches and compute Buchholz. */
  opponents: TeamId[]
  buchholz: number
  /** Live Elo rating: the starting rating updated by every match result so far. */
  rating: number
}

/**
 * A stage as designed by the user. Seeds, matches and standings are derived
 * by the engine from this plus the stage's results.
 */
export interface Stage {
  id: StageId
  name: string
  /**
   * Stages with the same phase run side by side (e.g. parallel groups).
   * Phases play in ascending order.
   */
  phase: number
  config: StageConfig
  /** Entry slots in seed order (index 0 = top seed). */
  entrants: EntrantSource[]
}
