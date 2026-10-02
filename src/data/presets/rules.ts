import type { GameRules } from '../../types'

/** CS2: first to 13 rounds (MR12), MR3 overtime (first to 4 per 6-round block). */
export const cs2Rules: GameRules = {
  scoring: { kind: 'first-to', target: 13, overtime: { firstTo: 4 } },
  terms: { game: 'Map', games: 'Maps', point: 'Round', points: 'Rounds' },
  // Active Duty pool at the time of writing; edit as the pool rotates.
  gamePool: ['Ancient', 'Anubis', 'Dust2', 'Inferno', 'Mirage', 'Nuke', 'Train'],
}

/** Valorant: first to 13 rounds, overtime won by two clear rounds. */
export const valorantRules: GameRules = {
  scoring: { kind: 'first-to', target: 13, overtime: { firstTo: 2 } },
  terms: { game: 'Map', games: 'Maps', point: 'Round', points: 'Rounds' },
}

/** American football: free scoring, around 23 points per team. */
export const footballRules: GameRules = {
  scoring: { kind: 'free', typical: { mean: 23, spread: 9 } },
}

/** Any sport where the higher score wins and scores aren't simulated. */
export const genericRules: GameRules = {
  scoring: { kind: 'free' },
}
