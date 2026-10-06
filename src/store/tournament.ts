import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { cs2Major } from '../data/presets/cs2-major'
import {
  absorbPicks,
  blankTournament,
  clearSimulated,
  computeTournament,
  emptyLayers,
  layerOf,
  pickWinner,
  removeGame,
  setGame,
  setSeriesScore,
  simulate,
  splitBySource,
  uniqueName,
  viewResults,
  withReport,
  type GameInput,
  type ResultLayers,
  type ResultView,
  type SimulationOptions,
  type SimulationScope,
  type TournamentState,
} from '../engine'
import type { Match, MatchId, MatchReport, StageId, TeamId, Tournament, TournamentResults } from '../types'

/** A tournament in the library that isn't open. */
export interface LibraryEntry extends ResultLayers {
  tournament: Tournament
  /** When it was last open, in ms since the epoch. */
  updatedAt: number
}

interface TournamentStore extends ResultLayers {
  /** The open tournament. */
  tournament: Tournament
  /** Every other saved tournament, keyed by ID. */
  library: Record<string, LibraryEntry>
  /**
   * The layer being viewed and edited: 'pick' shows picks with decided
   * actual results on top; 'actual' shows only actual results.
   */
  editSource: ResultView
  simulation: SimulationOptions

  /** Saves the open tournament to the library and opens another. */
  openTournament: (id: string) => void
  /** Adds a tournament to the library (renamed if the name is taken) and opens it. */
  createTournament: (tournament: Tournament, layers?: ResultLayers) => void
  /** Copies a tournament and opens the copy; with `designOnly`, without picks or results. */
  duplicateTournament: (id: string, designOnly?: boolean) => void
  /** Deletes a tournament. Deleting the open one opens the most recent other, or a blank one. */
  deleteTournament: (id: string) => void
  /** Edits the tournament's design, keeping results (ones that no longer fit are ignored). */
  updateTournament: (update: (tournament: Tournament) => Tournament) => void
  setEditSource: (view: ResultView) => void
  setSimulationOptions: (options: Partial<SimulationOptions>) => void

  /** Stores a report in the viewed layer; undefined clears the match. */
  setReport: (stageId: StageId, matchId: MatchId, report: MatchReport | undefined) => void
  /** Click a team to pick it; click the winner again to clear. */
  pickWinner: (stageId: StageId, match: Match, teamId: TeamId) => void
  /** Series score in slot order. Throws if impossible for the best-of; see `seriesScoreError`. */
  setSeriesScore: (stageId: StageId, match: Match, score: [number, number]) => void
  setGame: (stageId: StageId, match: Match, index: number, game: GameInput) => void
  removeGame: (stageId: StageId, match: Match, index: number) => void
  clearMatch: (stageId: StageId, matchId: MatchId) => void

  /** Fills in the picks view with simulated results, stored as picks. */
  simulate: (scope: SimulationScope) => void
  clearSimulated: () => void
  /** Clears the viewed layer: every pick and simulation, or every actual result. */
  clearResults: () => void
}

export const useTournamentStore = create<TournamentStore>()(
  persist(
    (set, get) => {
      const layer = () => layerOf(get().editSource)
      const stored = (stageId: StageId, matchId: MatchId) => get()[layer()][stageId]?.[matchId]
      const editOptions = () => ({ source: get().editSource, scoring: get().tournament.rules?.scoring })

      const setReport = (stageId: StageId, matchId: MatchId, report: MatchReport | undefined) => {
        const key = layer()
        set((state) => ({ [key]: withReport(state[key], stageId, matchId, report) }))
      }

      /** The open tournament moved into the library. */
      const stashed = (): Record<string, LibraryEntry> => {
        const { tournament, actual, picks, library } = get()
        return { ...library, [tournament.id]: { tournament, actual, picks, updatedAt: Date.now() } }
      }
      const takenNames = () => [get().tournament, ...Object.values(get().library).map((e) => e.tournament)].map((t) => t.name)

      const open = (id: string, library: Record<string, LibraryEntry>) => {
        const entry = library[id]
        if (!entry) return
        const rest = { ...library }
        delete rest[id]
        set({ tournament: entry.tournament, actual: entry.actual, picks: entry.picks, library: rest })
      }

      const createTournament = (tournament: Tournament, layers: ResultLayers = emptyLayers()) => {
        const library = stashed()
        const id = library[tournament.id] ? `${tournament.id}-${Date.now().toString(36)}` : tournament.id
        const name = uniqueName(tournament.name, takenNames())
        set({ tournament: { ...tournament, id, name }, actual: layers.actual, picks: layers.picks, library })
      }

      return {
        tournament: cs2Major,
        actual: {},
        picks: {},
        library: {},
        editSource: 'pick',
        simulation: { chaos: 0, detail: 'games' },

        openTournament: (id) => {
          if (id !== get().tournament.id) open(id, stashed())
        },
        createTournament,
        duplicateTournament: (id, designOnly = false) => {
          const source = id === get().tournament.id ? get() : get().library[id]
          if (!source) return
          const layers = designOnly ? emptyLayers() : structuredClone({ actual: source.actual, picks: source.picks })
          createTournament({ ...structuredClone(source.tournament), id: `${id}-copy` }, layers)
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
          else set({ tournament: blankTournament(), ...emptyLayers() })
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
          set(({ tournament, actual, picks, simulation, editSource }) => {
            // Simulations are predictions, so they only belong in the picks view.
            if (editSource !== 'pick') return {}
            const viewed = viewResults(tournament, { actual, picks }, 'pick')
            // A fresh seed each time so repeated clicks give different outcomes.
            const next = simulate(tournament, viewed, scope, { ...simulation, seed: Date.now() })
            return { picks: absorbPicks(picks, next) }
          }),
        clearSimulated: () => set(({ picks }) => ({ picks: clearSimulated(picks) })),
        clearResults: () => set({ [layer()]: {} }),
      }
    },
    {
      name: 'pickem-tournament',
      version: 3,
      migrate: migrateStore,
      partialize: ({ tournament, actual, picks, library, editSource, simulation }) => ({
        tournament,
        actual,
        picks,
        library,
        editSource,
        simulation,
      }),
    },
  ),
)

/**
 * Upgrades saved state from an older version. v2 added the library; v3
 * split each tournament's `results` into actual results and picks.
 */
export function migrateStore(persisted: unknown, version: number): TournamentStore {
  let state = { ...(persisted as Record<string, unknown>) }
  if (version < 2) state = { ...state, library: {} }
  if (version < 3) {
    const library = Object.fromEntries(
      Object.entries((state.library ?? {}) as Record<string, Record<string, unknown>>).map(([id, entry]) => [id, toLayers(entry)]),
    )
    state = { ...toLayers(state), library }
  }
  return state as unknown as TournamentStore
}

/**
 * Moves an old `results` map into layers. Layers already there are kept,
 * winning over old results for the same match: state saved by older code
 * after a newer version ran (e.g. switching branches) can have both, and
 * dropping the layers would lose picks and results.
 */
function toLayers<T extends Record<string, unknown>>(holder: T): Omit<T, 'results'> & ResultLayers {
  const { results, ...rest } = holder
  const split = splitBySource((results ?? {}) as TournamentResults)
  const kept = rest as Partial<ResultLayers>
  return { ...rest, actual: mergeLayer(split.actual, kept.actual), picks: mergeLayer(split.picks, kept.picks) }
}

/** Both layers' reports, with `over`'s winning for the same match. */
function mergeLayer(under: TournamentResults, over: TournamentResults | undefined): TournamentResults {
  const merged: TournamentResults = Object.fromEntries(Object.entries(under).map(([id, reports]) => [id, { ...reports }]))
  for (const [stageId, reports] of Object.entries(over ?? {})) merged[stageId] = { ...merged[stageId], ...reports }
  return merged
}

/** The results the current view is computed from. */
export function useViewResults(): TournamentResults {
  const tournament = useTournamentStore((s) => s.tournament)
  const actual = useTournamentStore((s) => s.actual)
  const picks = useTournamentStore((s) => s.picks)
  const view = useTournamentStore((s) => s.editSource)
  return useMemo(() => viewResults(tournament, { actual, picks }, view), [tournament, actual, picks, view])
}

/** The computed tournament for the current view, recomputed only when the design or results change. */
export function useTournamentState(): TournamentState {
  const tournament = useTournamentStore((s) => s.tournament)
  const results = useViewResults()
  return useMemo(() => computeTournament(tournament, results), [tournament, results])
}
