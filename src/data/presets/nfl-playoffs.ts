import type { Stage, Team, TeamId, Tournament } from '../../types'
import { footballRules } from './rules'

const conferenceIds = (conference: 'afc' | 'nfc'): TeamId[] =>
  Array.from({ length: 7 }, (_, i) => `${conference}-${i + 1}`)

/** Placeholder teams named by seed; rename them to the real teams. */
const teams: Record<TeamId, Team> = Object.fromEntries(
  (['afc', 'nfc'] as const).flatMap((conference) =>
    conferenceIds(conference).map((id, i) => [id, { id, name: `${conference.toUpperCase()} ${i + 1} seed` }]),
  ),
)

/**
 * 7 teams, single elimination. The 1 seed has a bye, and every round
 * reseeds so the best remaining seed hosts the worst.
 */
const conference = (conference: 'afc' | 'nfc'): Stage => ({
  id: conference,
  name: conference.toUpperCase(),
  phase: 0,
  config: {
    format: 'single-elim',
    bestOf: 1,
    roundNamesFromFinal: [`${conference.toUpperCase()} Championship`, 'Divisional Round', 'Wild Card Round'],
    seeding: 'standard',
    reseed: true,
    thirdPlaceMatch: false,
  },
  entrants: conferenceIds(conference).map((teamId) => ({ kind: 'team', teamId })),
})

export const nflPlayoffs: Tournament = {
  id: 'nfl-playoffs',
  name: 'NFL Playoffs',
  teams,
  rules: footballRules,
  stages: [
    conference('afc'),
    conference('nfc'),
    {
      id: 'super-bowl',
      name: 'Super Bowl',
      phase: 1,
      config: {
        format: 'single-elim',
        bestOf: 1,
        roundNamesFromFinal: ['Super Bowl'],
        seeding: 'as-listed',
        thirdPlaceMatch: false,
      },
      entrants: [
        { kind: 'placement', stageId: 'afc', place: 1 },
        { kind: 'placement', stageId: 'nfc', place: 1 },
      ],
    },
  ],
}
