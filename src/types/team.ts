export type TeamId = string

export interface Team {
  id: TeamId
  name: string
  shortName?: string
  logoUrl?: string
  /** Strength used by the simulator (e.g. an Elo-style rating). */
  rating?: number
}
