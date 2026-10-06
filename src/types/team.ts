export type TeamId = string

export interface Team {
  id: TeamId
  name: string
  shortName?: string
  logoUrl?: string
  /** Strength used by the simulator (e.g. an Elo-style rating). */
  rating?: number
  /** The ranking entry `rating` was taken from, if any. */
  ratingSource?: RatingSource
}

/** Links a team to an entry in a ranking catalog. */
export interface RatingSource {
  /** The catalog's `source`, e.g. 'vrs'. */
  catalog: string
  /** The entry's `key`. */
  key: string
  /** Rank in the snapshot the rating came from. */
  rank: number
  /** Date of that snapshot, YYYY-MM-DD. */
  asOf: string
}
