import type { Match, MatchId, MatchResult, TeamId, Tournament, TournamentResults } from '../types'
import { createRng } from './random'
import { isPlayable } from './simulator'
import { computeTournament, type TournamentState } from './tournament'

/** Test helpers for driving engines to completion. */

export const teams = (n: number): TeamId[] => Array.from({ length: n }, (_, i) => `t${i + 1}`)

export type Decide = (match: Match) => TeamId

/** The team listed first in `order` wins; with `teams()` that's the higher seed. */
export const favouriteWins =
  (order: TeamId[]): Decide =>
  (m) => {
    const [a, b] = m.slots.map((s) => s.teamId!)
    return order.indexOf(a) < order.indexOf(b) ? a : b
  }

export const randomWinner = (seed: number): Decide => {
  const rng = createRng(seed)
  return (m) => m.slots[rng() < 0.5 ? 0 : 1].teamId!
}


/** Recomputes and fills in every playable match until nothing changes. */
export function playUntilDone<S extends { complete: boolean }>(
  compute: (results: Record<MatchId, MatchResult>) => S,
  matchesOf: (state: S) => Match[],
  decide: Decide,
  results: Record<MatchId, MatchResult> = {},
): S {
  for (let guard = 0; guard < 200; guard++) {
    const state = compute(results)
    const playable = matchesOf(state).filter(isPlayable)
    if (playable.length === 0) return state
    for (const m of playable) results[m.id] = { winnerId: decide(m), source: 'pick' }
  }
  throw new Error('Did not finish')
}

export function playTournament(tournament: Tournament, decide: Decide, results: TournamentResults = {}): TournamentState {
  for (let guard = 0; guard < 500; guard++) {
    const state = computeTournament(tournament, results)
    let changed = false
    for (const stage of Object.values(state.stages)) {
      for (const m of stage.matches.filter(isPlayable)) {
        ;(results[stage.stageId] ??= {})[m.id] = { winnerId: decide(m), source: 'pick' }
        changed = true
      }
    }
    if (!changed) return state
  }
  throw new Error('Tournament did not finish')
}
