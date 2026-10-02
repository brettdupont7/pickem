import { createContext, useContext } from 'react'
import { useTournamentStore } from '../../store/tournament'
import type { Team, TeamId } from '../../types'

/**
 * Set while rendering a stage preview in the designer: the placeholder
 * teams to show, and a signal that matches can't be edited.
 */
export const PreviewContext = createContext<Record<TeamId, Team> | null>(null)

export const useIsPreview = () => useContext(PreviewContext) !== null

/** The teams to show: the preview's placeholders, or the tournament's teams. */
export function useTeams(): Record<TeamId, Team> {
  const preview = useContext(PreviewContext)
  const teams = useTournamentStore((s) => s.tournament.teams)
  return preview ?? teams
}
