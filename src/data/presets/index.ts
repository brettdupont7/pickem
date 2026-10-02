import type { Tournament } from '../../types'
import { cs2Major } from './cs2-major'
import { nflPlayoffs } from './nfl-playoffs'

export interface TournamentPreset {
  id: string
  name: string
  description: string
  tournament: Tournament
}

/** Starting points for the designer. Everything in them can be edited. */
export const presets: TournamentPreset[] = [
  {
    id: 'cs2-major',
    name: 'CS2 Major',
    description: 'Three 16-team Swiss stages (3 wins / 3 losses) into an 8-team single-elimination playoff.',
    tournament: cs2Major,
  },
  {
    id: 'nfl-playoffs',
    name: 'NFL Playoffs',
    description: 'Two 7-team conferences with a bye for the 1 seed and reseeding, then the Super Bowl.',
    tournament: nflPlayoffs,
  },
]

export { cs2Major, nflPlayoffs }
export * from './rules'
