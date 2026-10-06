import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { fetchLatestVrs } from '../data/vrs'
import type { Catalog } from '../types'

/**
 * Ranking catalogs, cached in the browser. Stored apart from tournaments so
 * refreshing rankings can never touch tournament data.
 */
interface CatalogStore {
  /** The latest VRS snapshot downloaded, if any. */
  vrs: Catalog | null
  refreshing: boolean
  error: string | null
  /** Downloads the latest snapshot. Never changes tournaments. */
  refreshVrs: () => Promise<void>
}

export const useCatalogStore = create<CatalogStore>()(
  persist(
    (set, get) => ({
      vrs: null,
      refreshing: false,
      error: null,
      refreshVrs: async () => {
        if (get().refreshing) return
        set({ refreshing: true, error: null })
        try {
          set({ vrs: await fetchLatestVrs(), refreshing: false })
        } catch (e) {
          set({ refreshing: false, error: (e as Error).message })
        }
      },
    }),
    {
      name: 'pickem-catalog',
      version: 1,
      partialize: ({ vrs }) => ({ vrs }),
    },
  ),
)
