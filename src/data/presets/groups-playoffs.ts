import { cs2Rules } from './rules'
import type { EntrantSource, Stage, StageId, Team, TeamId, Tournament } from '../../types'

const groupIds = (group: 'a' | 'b'): TeamId[] => Array.from({ length: 8 }, (_, i) => `${group}-${i + 1}`)

/** 16 placeholder teams, 8 per group; rename them to the real teams. */
const teams: Record<TeamId, Team> = Object.fromEntries(
  (['a', 'b'] as const).flatMap((group) =>
    groupIds(group).map((id, i) => [id, { id, name: `Group ${group.toUpperCase()} team ${i + 1}` }]),
  ),
)

/**
 * 8-team double-elimination group. The upper final decides 1st and 2nd,
 * and the lower bracket decides 3rd; there's no grand final.
 */
const group = (group: 'a' | 'b'): Stage => ({
  id: `group-${group}`,
  name: `Group ${group.toUpperCase()}`,
  phase: 0,
  config: {
    format: 'double-elim',
    bestOf: 3,
    seeding: 'standard',
    finals: 'upper-final-decides',
    grandFinalReset: false,
  },
  entrants: groupIds(group).map((teamId) => ({ kind: 'team', teamId })),
})

const place = (stageId: StageId, place: number): EntrantSource => ({ kind: 'placement', stageId, place })

/**
 * The top 3 of each group go through. Group winners get byes into the
 * semi-finals, on opposite sides; 2nd plays the other group's 3rd.
 */
export const groupsPlayoffs: Tournament = {
  id: 'groups-playoffs',
  name: 'Groups + Playoffs',
  teams,
  rules: cs2Rules,
  stages: [
    group('a'),
    group('b'),
    {
      id: 'playoffs',
      name: 'Playoffs',
      phase: 1,
      config: {
        format: 'single-elim',
        bestOf: 3,
        bestOfFromFinal: [5],
        seeding: 'standard',
        thirdPlaceMatch: false,
      },
      entrants: [
        place('group-a', 1),
        place('group-b', 1),
        place('group-a', 2),
        place('group-b', 2),
        place('group-a', 3),
        place('group-b', 3),
      ],
    },
  ],
}
