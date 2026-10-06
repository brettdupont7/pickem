import type { MatchReport, ResultSource, StageId, Tournament, TournamentResults } from '../types'
import { computeTournament } from './tournament'

/**
 * Results kept in two layers, so predictions never overwrite reality:
 * - actual: what really happened
 * - picks: predictions, both the user's picks and simulated results
 */
export interface ResultLayers {
  actual: TournamentResults
  picks: TournamentResults
}

/** Which layer is being viewed and edited. */
export type ResultView = 'pick' | 'actual'

export const emptyLayers = (): ResultLayers => ({ actual: {}, picks: {} })

/** The layer a report of this source is stored in. */
export const layerOf = (source: ResultSource): keyof ResultLayers => (source === 'actual' ? 'actual' : 'picks')

/** Splits results that mix sources (the format before layers) into layers. Byes are generated, so they're dropped. */
export function splitBySource(results: TournamentResults): ResultLayers {
  const layers = emptyLayers()
  for (const [stageId, reports] of Object.entries(results)) {
    for (const [matchId, report] of Object.entries(reports)) {
      if (report.source === 'bye') continue
      ;(layers[layerOf(report.source)][stageId] ??= {})[matchId] = report
    }
  }
  return layers
}

/**
 * The results the picks view is computed from: picks, overridden by every
 * actual result that decides its match. Actual matches still in progress
 * are left out, so they don't hide a pick.
 */
export function picksView(tournament: Tournament, { actual, picks }: ResultLayers): TournamentResults {
  const merged: TournamentResults = Object.fromEntries(Object.entries(picks).map(([id, reports]) => [id, { ...reports }]))
  const real = computeTournament(tournament, actual)
  for (const [stageId, stage] of Object.entries(real.stages)) {
    for (const match of stage.matches) {
      const report = actual[stageId]?.[match.id]
      if (report && match.result?.source === 'actual') (merged[stageId] ??= {})[match.id] = report
    }
  }
  return merged
}

/** The results a view is computed from. */
export const viewResults = (tournament: Tournament, layers: ResultLayers, view: ResultView): TournamentResults =>
  view === 'actual' ? layers.actual : picksView(tournament, layers)

/**
 * Folds results computed from the picks view (e.g. after simulating) back
 * into the picks layer. Actual results in it came from the actual layer,
 * so they're skipped; picks hidden by an actual result are kept.
 */
export function absorbPicks(picks: TournamentResults, viewed: TournamentResults): TournamentResults {
  const next: TournamentResults = Object.fromEntries(Object.entries(picks).map(([id, reports]) => [id, { ...reports }]))
  for (const [stageId, reports] of Object.entries(viewed)) {
    for (const [matchId, report] of Object.entries(reports)) {
      if (report.source !== 'actual') (next[stageId] ??= {})[matchId] = report
    }
  }
  return next
}

/** Stores a report in one stage of a layer; undefined clears the match. */
export function withReport(
  layer: TournamentResults,
  stageId: StageId,
  matchId: string,
  report: MatchReport | undefined,
): TournamentResults {
  const reports = { ...layer[stageId] }
  if (report) reports[matchId] = report
  else delete reports[matchId]
  return { ...layer, [stageId]: reports }
}

export const hasResults = (layer: TournamentResults) => Object.values(layer).some((r) => Object.keys(r).length > 0)
