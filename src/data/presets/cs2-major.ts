import { cs2Rules } from './rules'
import type { EntrantSource, Stage, StageId, SwissConfig, Team, TeamId, Tournament } from '../../types'

/** CS2 Major Swiss: 3 wins advance, 3 losses eliminate, Bo3 when advancement or elimination is on the line. */
const majorSwiss: SwissConfig = {
  format: 'swiss',
  winsToAdvance: 3,
  lossesToEliminate: 3,
  bestOf: 1,
  advancementBestOf: 3,
  eliminationBestOf: 3,
  firstRoundPairing: 'high-low',
  pairing: 'buchholz',
  avoidRematches: true,
  majorPriorityTable: true,
  tiebreakers: ['buchholz', 'seed'],
}

const teamIds = (from: number, to: number): TeamId[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `team-${from + i}`)

const invites = (ids: TeamId[]): EntrantSource[] =>
  ids.map((teamId) => ({ kind: 'team', teamId }))

const qualifiers = (stageId: StageId, count: number): EntrantSource[] =>
  Array.from({ length: count }, (_, i) => ({ kind: 'placement', stageId, place: i + 1 }))

const swissStage = (id: StageId, name: string, phase: number, entrants: EntrantSource[]): Stage => ({
  id,
  name,
  phase,
  config: majorSwiss,
  entrants,
})

/** 32 placeholder teams: 16 start in Stage 1, 8 are invited to Stage 2, 8 to Stage 3. */
const teams: Record<TeamId, Team> = Object.fromEntries(
  teamIds(1, 32).map((id, i) => [id, { id, name: `Team ${i + 1}` }]),
)

export const cs2Major: Tournament = {
  id: 'cs2-major',
  name: 'CS2 Major',
  teams,
  rules: cs2Rules,
  stages: [
    swissStage('stage-1', 'Stage 1', 0, invites(teamIds(1, 16))),
    swissStage('stage-2', 'Stage 2', 1, [...invites(teamIds(17, 24)), ...qualifiers('stage-1', 8)]),
    swissStage('stage-3', 'Stage 3', 2, [...invites(teamIds(25, 32)), ...qualifiers('stage-2', 8)]),
    {
      id: 'playoffs',
      name: 'Playoffs',
      phase: 3,
      config: {
        format: 'single-elim',
        bestOf: 3,
        bestOfFromFinal: [5],
        seeding: 'standard',
        thirdPlaceMatch: false,
      },
      entrants: qualifiers('stage-3', 8),
    },
  ],
}
