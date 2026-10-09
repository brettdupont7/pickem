import type { MatchId } from './match'
import type { StageId } from './stage'
import type { TeamId } from './team'

/**
 * A Swiss stage's Pick'em card, as in Valve's Major Pick'em: teams to go
 * undefeated (e.g. 3-0), to advance with at least one loss (3-1 or 3-2),
 * and to go winless (0-3). A pick only counts for that exact outcome.
 */
export interface SwissPickemCard {
  kind: 'swiss'
  undefeated: TeamId[]
  advance: TeamId[]
  winless: TeamId[]
  /** Set to edit a card after its stage has started. */
  unlocked?: boolean
}

/** An elimination stage's Pick'em card: the winner of each match, later rounds following earlier picks. */
export interface BracketPickemCard {
  kind: 'bracket'
  winners: Record<MatchId, TeamId>
  unlocked?: boolean
}

export type PickemCard = SwissPickemCard | BracketPickemCard

/** A tournament's Pick'em cards by stage, kept apart from picks and results. */
export type TournamentPickem = Record<StageId, PickemCard>
