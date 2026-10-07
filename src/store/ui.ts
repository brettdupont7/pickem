import { create } from 'zustand'
import type { MatchId, StageId } from '../types'

export type View = 'stages' | 'odds' | 'teams' | 'design'

/** Whether match cards show each team's chance to win; a per-browser preference, so storage may be unavailable. */
const MATCH_ODDS_KEY = 'pickem-match-odds'
const readMatchOdds = () => {
  try {
    return localStorage.getItem(MATCH_ODDS_KEY) !== '0'
  } catch {
    return true
  }
}

interface UiStore {
  view: View
  showMatchOdds: boolean
  activeStageId: StageId | null
  editing: { stageId: StageId; matchId: MatchId } | null
  setView: (view: View) => void
  setActiveStage: (stageId: StageId) => void
  openEditor: (stageId: StageId, matchId: MatchId) => void
  closeEditor: () => void
  setShowMatchOdds: (show: boolean) => void
}

/** View state that isn't worth persisting. */
export const useUiStore = create<UiStore>()((set) => ({
  view: 'stages',
  activeStageId: null,
  editing: null,
  showMatchOdds: readMatchOdds(),
  setView: (view) => set({ view }),
  setActiveStage: (activeStageId) => set({ activeStageId }),
  openEditor: (stageId, matchId) => set({ editing: { stageId, matchId } }),
  closeEditor: () => set({ editing: null }),
  setShowMatchOdds: (showMatchOdds) => {
    try {
      localStorage.setItem(MATCH_ODDS_KEY, showMatchOdds ? '1' : '0')
    } catch {
      // Not remembered; the setting still applies for this visit.
    }
    set({ showMatchOdds })
  },
}))
