import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { cs2Major } from '../data/presets/cs2-major'
import {
  clearSimulated,
  computeTournament,
  pickWinner,
  removeGame,
  setGame,
  setSeriesScore,
  simulate,
  type GameInput,
  type SimulationOptions,
  type SimulationScope,
  type TournamentState,
} from '../engine'
import type { Match, MatchId, MatchReport, ResultSource, StageId, TeamId, Tournament, TournamentResults } from '../types'

interface TournamentStore {
  tournament: Tournament
  results: TournamentResults
  /** Source recorded for edits: 'pick' for predictions, 'actual' for real results. */
  editSource: ResultSource
  simulation: SimulationOptions

  /** Replaces the tournament and clears all results. */
  loadTournament: (tournament: Tournament) => void
  /** Edits the tournament's design, keeping results (ones that no longer fit are ignored). */
  updateTournament: (update: (tournament: Tournament) => Tournament) => void
  setEditSource: (source: ResultSource) => void
  setSimulationOptions: (options: Partial<SimulationOptions>) => void

  /** Stores a report directly; undefined clears the match. */
  setReport: (stageId: StageId, matchId: MatchId, report: MatchReport | undefined) => void
  /** Click a team to pick it; click the winner again to clear. */
  pickWinner: (stageId: StageId, match: Match, teamId: TeamId) => void
  /** Series score in slot order. Throws if impossible for the best-of; see `seriesScoreError`. */
  setSeriesScore: (stageId: StageId, match: Match, score: [number, number]) => void
  setGame: (stageId: StageId, match: Match, index: number, game: GameInput) => void
  removeGame: (stageId: StageId, match: Match, index: number) => void
  clearMatch: (stageId: StageId, matchId: MatchId) => void

  simulate: (scope: SimulationScope) => void
  clearSimulated: () => void
  clearResults: () => void
}

export const useTournamentStore = create<TournamentStore>()(
  persist(
    (set, get) => {
      const stored = (stageId: StageId, matchId: MatchId) => get().results[stageId]?.[matchId]
      const editOptions = () => ({ source: get().editSource, scoring: get().tournament.rules?.scoring })

      const setReport = (stageId: StageId, matchId: MatchId, report: MatchReport | undefined) =>
        set(({ results }) => {
          const reports = { ...results[stageId] }
          if (report) reports[matchId] = report
          else delete reports[matchId]
          return { results: { ...results, [stageId]: reports } }
        })

      return {
        tournament: cs2Major,
        results: {},
        editSource: 'pick',
        simulation: { chaos: 0, detail: 'games' },

        loadTournament: (tournament) => set({ tournament, results: {} }),
        updateTournament: (update) => set(({ tournament }) => ({ tournament: update(tournament) })),
        setEditSource: (editSource) => set({ editSource }),
        setSimulationOptions: (options) => set(({ simulation }) => ({ simulation: { ...simulation, ...options } })),

        setReport,
        pickWinner: (stageId, match, teamId) =>
          setReport(stageId, match.id, pickWinner(match, stored(stageId, match.id), teamId, editOptions())),
        setSeriesScore: (stageId, match, score) =>
          setReport(stageId, match.id, setSeriesScore(match, score, editOptions())),
        setGame: (stageId, match, index, game) =>
          setReport(stageId, match.id, setGame(match, stored(stageId, match.id), index, game, editOptions())),
        removeGame: (stageId, match, index) =>
          setReport(stageId, match.id, removeGame(match, stored(stageId, match.id), index, editOptions())),
        clearMatch: (stageId, matchId) => setReport(stageId, matchId, undefined),

        simulate: (scope) =>
          set(({ tournament, results, simulation }) => ({
            // A fresh seed each time so repeated clicks give different outcomes.
            results: simulate(tournament, results, scope, { ...simulation, seed: Date.now() }),
          })),
        clearSimulated: () => set(({ results }) => ({ results: clearSimulated(results) })),
        clearResults: () => set({ results: {} }),
      }
    },
    {
      name: 'pickem-tournament',
      version: 1,
      partialize: ({ tournament, results, editSource, simulation }) => ({ tournament, results, editSource, simulation }),
    },
  ),
)

/** The computed tournament, recomputed only when the design or results change. */
export function useTournamentState(): TournamentState {
  const tournament = useTournamentStore((s) => s.tournament)
  const results = useTournamentStore((s) => s.results)
  return useMemo(() => computeTournament(tournament, results), [tournament, results])
}
