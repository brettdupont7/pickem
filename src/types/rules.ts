/**
 * How a single game is scored.
 * - free: any score, higher wins (NFL, basketball). Equal scores need an
 *   explicit winner, e.g. a shootout.
 * - first-to: the first team to `target` wins (CS2: 13 rounds). With
 *   `overtime`, reaching target - 1 each starts overtime blocks: the first
 *   to `overtime.firstTo` in a block wins, and a block tied at
 *   firstTo - 1 each starts another (CS2: 4, Valorant: 2 = win by two).
 *   Without overtime, the first to `target` wins outright.
 */
export type GameScoring =
  | {
      kind: 'free'
      /** Typical points per team, used to simulate scores. */
      typical?: { mean: number; spread: number }
    }
  | { kind: 'first-to'; target: number; overtime?: { firstTo: number } }

/** Words the UI uses for this sport. */
export interface Terms {
  /** "Map" in CS2, "Game" in most sports. */
  game: string
  games: string
  /** "Round" in CS2, "Point" in most sports. */
  point: string
  points: string
}

export interface GameRules {
  scoring: GameScoring
  terms?: Partial<Terms>
  /** Names to choose from when recording a game, e.g. the CS2 map pool. */
  gamePool?: string[]
  /**
   * What a rating gap predicts. 'game' (default): the winner of one game.
   * 'series': the winner of a best-of-3, as rankings like CS2's VRS do;
   * the simulator then derives the per-game chance that gives those odds.
   */
  ratingBasis?: 'game' | 'series'
}
