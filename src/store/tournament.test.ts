import { describe, expect, it, vi } from 'vitest'

// The store persists to localStorage, which Node doesn't have. Hoisted so it
// exists before the store module loads.
vi.hoisted(() => {
  const items = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: (i: number) => [...items.keys()][i] ?? null,
    get length() {
      return items.size
    },
  }
})
import { migrateStore, useTournamentStore } from './tournament'

describe('migrateStore', () => {
  it('splits v2 results into actual results and picks, including the library', () => {
    const tournament = { id: 't', name: 'T', teams: {}, stages: [] }
    const v2 = {
      tournament,
      results: { s: { m1: { source: 'actual', winnerId: 'a' }, m2: { source: 'pick', winnerId: 'b' } } },
      library: { old: { tournament, results: { s: { m3: { source: 'simulated', winnerId: 'c' } } }, updatedAt: 1 } },
      editSource: 'actual',
      simulation: { chaos: 0 },
    }
    expect(migrateStore(v2, 2)).toEqual({
      tournament,
      actual: { s: { m1: v2.results.s.m1 } },
      picks: { s: { m2: v2.results.s.m2 } },
      library: { old: { tournament, actual: {}, picks: { s: { m3: v2.library.old.results.s.m3 } }, updatedAt: 1 } },
      editSource: 'actual',
      simulation: { chaos: 0 },
    })
  })

  it('keeps layers that are already there when older code saved over newer state', () => {
    const tournament = { id: 't', name: 'T', teams: {}, stages: [] }
    const pick = { source: 'pick', winnerId: 'a' }
    const actual = { source: 'actual', winnerId: 'b' }
    // What a v2 build left behind after a v3 build had run: the open
    // tournament's layers were dropped, but library entries kept theirs.
    const saved = {
      tournament,
      results: { s: { m1: actual } },
      library: { old: { tournament, actual: { s: { m2: actual } }, picks: { s: { m3: pick } }, updatedAt: 1 } },
    }
    expect(migrateStore(saved, 2)).toEqual({
      tournament,
      actual: { s: { m1: actual } },
      picks: {},
      library: { old: { tournament, actual: { s: { m2: actual } }, picks: { s: { m3: pick } }, updatedAt: 1 } },
    })
  })

  it('prefers existing layers over old results for the same match', () => {
    const saved = { results: { s: { m: { source: 'pick', winnerId: 'old' } } }, picks: { s: { m: { source: 'pick', winnerId: 'new' } } }, library: {} }
    expect((migrateStore(saved, 2) as unknown as { picks: unknown }).picks).toEqual({ s: { m: { source: 'pick', winnerId: 'new' } } })
  })

  it('leaves current state alone', () => {
    const v3 = { tournament: {}, actual: {}, picks: {}, library: {} }
    expect(migrateStore(v3, 3)).toEqual(v3)
  })
})

describe('duplicateTournament', () => {
  it('copies picks and results, or just the design', () => {
    const store = useTournamentStore.getState()
    const original = store.tournament
    useTournamentStore.setState({ actual: { s: { m: { source: 'actual', winnerId: 'a' } } }, picks: { s: { n: { source: 'pick', winnerId: 'b' } } } })

    useTournamentStore.getState().duplicateTournament(original.id)
    expect(useTournamentStore.getState().tournament.name).toBe(`${original.name} (2)`)
    expect(useTournamentStore.getState().actual).toEqual({ s: { m: { source: 'actual', winnerId: 'a' } } })

    useTournamentStore.getState().duplicateTournament(original.id, true)
    const copy = useTournamentStore.getState()
    expect(copy.tournament.name).toBe(`${original.name} (3)`)
    expect(copy.tournament.stages).toEqual(original.stages)
    expect(copy.actual).toEqual({})
    expect(copy.picks).toEqual({})
    // The original kept its results in the library.
    expect(copy.library[original.id].picks).toEqual({ s: { n: { source: 'pick', winnerId: 'b' } } })
  })
})
