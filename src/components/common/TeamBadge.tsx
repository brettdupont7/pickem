import type { Team } from '../../types'

/** Up to three characters: the short name, or initials (numbers kept whole), e.g. "Team 12" -> "T12". */
export function initials(team: Team) {
  if (team.shortName) return team.shortName.slice(0, 4)
  const words = team.name.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words
    .map((w) => (/^\d+$/.test(w) ? w : w[0].toUpperCase()))
    .join('')
    .slice(0, 4)
}

/** A team's logo, or its initials in a circle; "?" when the team isn't known yet. */
export function TeamBadge({ team }: { team?: Team }) {
  if (team?.logoUrl) return <img className="team-badge" src={team.logoUrl} alt="" />
  return (
    <span className={`team-badge${team ? '' : ' team-badge--unknown'}`} aria-hidden>
      {team ? initials(team) : '?'}
    </span>
  )
}
