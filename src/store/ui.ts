import { create } from 'zustand'
import type { MatchId, StageId } from '../types'

export type View = 'stages' | 'odds' | 'teams' | 'design'

interface UiStore {
  view: View
  activeStageId: StageId | null
  editing: { stageId: StageId; matchId: MatchId } | null
  setView: (view: View) => void
  setActiveStage: (stageId: StageId) => void
  openEditor: (stageId: StageId, matchId: MatchId) => void
  closeEditor: () => void
}

/** View state that isn't worth persisting. */
export const useUiStore = create<UiStore>()((set) => ({
  view: 'stages',
  activeStageId: null,
  editing: null,
  setView: (view) => set({ view }),
  setActiveStage: (activeStageId) => set({ activeStageId }),
  openEditor: (stageId, matchId) => set({ editing: { stageId, matchId } }),
  closeEditor: () => set({ editing: null }),
}))
