import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { cs2Major } from '../data/presets/cs2-major'
import {
  blankTournament,
  clearSimulated,
  computeTournament,
  pickWinner,
  removeGame,
  setGame,
  setSeriesScore,
  simulate,
  uniqueName,
  type GameInput,
  type SimulationOptions,
  type SimulationScope,
  type TournamentState,
} from '../engine'
import type { Match, MatchId, MatchReport, ResultSource, StageId, TeamId, Tournament, TournamentResults } from '../types'

/** A tournament in the library that isn't open. */
export interface LibraryEntry {
  tournament: Tournament
  results: TournamentResults
  /** When it was last open, in ms since the epoch. */
  updatedAt: number
}

interface TournamentStore {
  /** The open tournament. */
  tournament: Tournament
  results: TournamentResults
  /** Every other saved tournament, keyed by ID. */
  library: Record<string, LibraryEntry>
  /** Source recorded for edits: 'pick' for predictions, 'actual' for real results. */
  editSource: ResultSource
  simulation: SimulationOptions

  /** Saves the open tournament to the library and opens another. */
  openTournament: (id: string) => void
  /** Adds a tournament to the library (renamed if the name is taken) and opens it. */
  createTournament: (tournament: Tournament, results?: TournamentResults) => void
  duplicateTournament: (id: string) => void
  /** Deletes a tournament. Deleting the open one opens the most recent other, or a blank one. */
  deleteTournament: (id: string) => void
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

      /** The open tournament moved into the library. */
      const stashed = (): Record<string, LibraryEntry> => {
        const { tournament, results, library } = get()
        return { ...library, [tournament.id]: { tournament, results, updatedAt: Date.now() } }
      }
      const takenNames = () => [get().tournament, ...Object.values(get().library).map((e) => e.tournament)].map((t) => t.name)

      const open = (id: string, library: Record<string, LibraryEntry>) => {
        const entry = library[id]
        if (!entry) return
        const rest = { ...library }
        delete rest[id]
        set({ tournament: entry.tournament, results: entry.results, library: rest })
      }

      const createTournament = (tournament: Tournament, results: TournamentResults = {}) => {
        const library = stashed()
        const id = library[tournament.id] ? `${tournament.id}-${Date.now().toString(36)}` : tournament.id
        const name = uniqueName(tournament.name, takenNames())
        set({ tournament: { ...tournament, id, name }, results, library })
      }

      return {
        tournament: cs2Major,
        results: {},
        library: {},
        editSource: 'pick',
        simulation: { chaos: 0, detail: 'games' },

        openTournament: (id) => {
          if (id !== get().tournament.id) open(id, stashed())
        },
        createTournament,
        duplicateTournament: (id) => {
          const source = id === get().tournament.id ? get() : get().library[id]
          if (!source) return
          createTournament({ ...structuredClone(source.tournament), id: `${id}-copy` }, structuredClone(source.results))
        },
        deleteTournament: (id) => {
          const { tournament, library } = get()
          if (id !== tournament.id) {
            const rest = { ...library }
            delete rest[id]
            set({ library: rest })
            return
          }
          const next = Object.values(library).sort((a, b) => b.updatedAt - a.updatedAt)[0]
          if (next) open(next.tournament.id, library)
          else set({ tournament: blankTournament(), results: {} })
        },
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
      version: 2,
      // v2 added the library.
      migrate: (state, version) => (version < 2 ? { ...(state as object), library: {} } : state) as TournamentStore,
      partialize: ({ tournament, results, library, editSource, simulation }) => ({ tournament, results, library, editSource, simulation }),
    },
  ),
)

/** The computed tournament, recomputed only when the design or results change. */
export function useTournamentState(): TournamentState {
  const tournament = useTournamentStore((s) => s.tournament)
  const results = useTournamentStore((s) => s.results)
  return useMemo(() => computeTournament(tournament, results), [tournament, results])
}
