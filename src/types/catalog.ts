/** A team in an external ranking, such as Valve's Regional Standings for CS2. */
export interface CatalogEntry {
  /** Stable across snapshots: the normalized name (plus the rank for a repeated name). */
  key: string
  rank: number
  name: string
  /** Rating points, on the same scale as a team's `rating`. */
  points: number
  roster?: string[]
}

/** One snapshot of a ranking. */
export interface Catalog {
  /** Which ranking this is, e.g. 'vrs'. */
  source: string
  /** Shown in the UI, e.g. "VRS (global)". */
  label: string
  /** Snapshot date, YYYY-MM-DD. */
  asOf: string
  /** Where the snapshot came from. */
  url?: string
  /** Best first. */
  entries: CatalogEntry[]
}
