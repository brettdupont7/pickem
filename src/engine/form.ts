import type { ResultSource, TeamId, Tournament, TournamentResults } from '../types'
import { computeTournament, playOrder } from './tournament'

/** A team's rating, updated by the tournament's results so far. */

const DEFAULT_RATING = 1500
export const DEFAULT_FORM_K = 40

/**
 * Each team's rating after an Elo update for every actual result in the
 * tournament, stage by stage in play order and round by round. Picks and
 * simulated results count too when the rules set `formFromPicks`; byes never
 * move ratings. The expected score is plain Elo on the rating gap, i.e.
 * whatever ratings predict (see `GameRules.ratingBasis`).
 *
 * Pass the results of the view being shown: in the actual results view
 * those are actual results only, so picks never count there.
 */
export function formRatings(tournament: Tournament, results: TournamentResults, k = tournament.rules?.formK ?? DEFAULT_FORM_K): Record<TeamId, number> {
  const counts = (source: ResultSource) =>
    source === 'actual' || (!!tournament.rules?.formFromPicks && (source === 'pick' || source === 'simulated'))
  const ratings: Record<TeamId, number> = Object.fromEntries(
    Object.values(tournament.teams).map((t) => [t.id, t.rating ?? DEFAULT_RATING]),
  )
  const state = computeTournament(tournament, results)
  for (const stage of playOrder(tournament.stages)) {
    const matches = [...(state.stages[stage.id]?.matches ?? [])].sort((a, b) => a.round - b.round)
    for (const m of matches) {
      if (!m.result || !counts(m.result.source)) continue
      const [a, b] = m.slots.map((s) => s.teamId)
      if (!a || !b) continue
      const winner = m.result.winnerId
      const loser = winner === a ? b : a
      const expected = 1 / (1 + 10 ** ((ratings[loser] - ratings[winner]) / 400))
      const gain = k * (1 - expected)
      ratings[winner] += gain
      ratings[loser] -= gain
    }
  }
  return ratings
}

/** Ratings the simulator should use: form ratings when the tournament has them switched on. */
export const simulationRatings = (tournament: Tournament, results: TournamentResults): Record<TeamId, number> | undefined =>
  tournament.rules?.formK ? formRatings(tournament, results) : undefined
