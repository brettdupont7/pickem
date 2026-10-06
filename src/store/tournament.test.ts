import { describe, expect, it } from 'vitest'
import { migrateStore } from './tournament'

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

  it('leaves current state alone', () => {
    const v3 = { tournament: {}, actual: {}, picks: {}, library: {} }
    expect(migrateStore(v3, 3)).toEqual(v3)
  })
})
