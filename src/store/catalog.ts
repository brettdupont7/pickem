import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { parseHltvImport } from '../data/hltv'
import { fetchLatestVrs } from '../data/vrs'
import type { Catalog } from '../types'

/**
 * Ranking catalogs, cached in the browser. Stored apart from tournaments so
 * refreshing rankings can never touch tournament data.
 */
interface CatalogStore {
  /** The latest VRS snapshot downloaded or imported, if any. */
  vrs: Catalog | null
  refreshing: boolean
  error: string | null
  /** Set when a download didn't replace a newer snapshot. */
  notice: string | null
  /** Downloads the latest snapshot from Valve, unless the one already here is newer. Never changes tournaments. */
  refreshVrs: () => Promise<void>
  /** Imports standings copied from HLTV. Returns the snapshot, or null (with `error` set) if the text isn't standings. */
  importVrs: (text: string) => Catalog | null
}

export const useCatalogStore = create<CatalogStore>()(
  persist(
    (set, get) => ({
      vrs: null,
      refreshing: false,
      error: null,
      notice: null,
      refreshVrs: async () => {
        if (get().refreshing) return
        set({ refreshing: true, error: null, notice: null })
        try {
          const latest = await fetchLatestVrs()
          const current = get().vrs
          if (current && current.asOf > latest.asOf) {
            set({
              refreshing: false,
              notice: "Valve's latest file is older than the standings you have, so they were kept.",
            })
          } else set({ vrs: latest, refreshing: false })
        } catch (e) {
          set({ refreshing: false, error: (e as Error).message })
        }
      },
      importVrs: (text) => {
        try {
          const vrs = parseHltvImport(text)
          set({ vrs, error: null, notice: null })
          return vrs
        } catch (e) {
          set({ error: (e as Error).message })
          return null
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
