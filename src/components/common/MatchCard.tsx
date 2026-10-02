import { describeMatch } from '../../engine'
import { useTournamentStore } from '../../store/tournament'
import { useUiStore } from '../../store/ui'
import type { Match, StageId } from '../../types'
import { useIsPreview, useTeams } from './preview'
import { TeamBadge } from './TeamBadge'

/** Where a team goes after a decided match: on (→) or down to the lower bracket (↓). */
export interface Advance {
  direction: 'on' | 'down'
  title: string
}

interface Props {
  stageId: StageId
  match: Match
  /** Brackets only: where each team goes next. Nothing is shown for teams that are out. */
  advance?: (slot: 0 | 1) => Advance | null
  /**
   * stacked: one team per line (brackets).
   * row: "A vs B" on one line with team badges (Swiss grid).
   */
  variant?: 'stacked' | 'row'
}

export function MatchCard({ stageId, match, variant = 'stacked', advance }: Props) {
  const teams = useTeams()
  const preview = useIsPreview()
  const scoring = useTournamentStore((s) => s.tournament.rules?.scoring)
  const pickWinner = useTournamentStore((s) => s.pickWinner)
  const openEditor = useUiStore((s) => s.openEditor)

  // A match between two byes never happens. Keep a full-size invisible card
  // so every match in a round is the same height and the bracket lines up.
  if (match.slots.every((s) => s.isBye))
    return (
      <div className="match match--empty" aria-hidden>
        <div className="match__header">&nbsp;</div>
        <span className="match__team">&nbsp;</span>
        <span className="match__team">&nbsp;</span>
      </div>
    )

  const view = describeMatch(match, scoring)
  const editable = !preview && (view.status === 'ready' || view.status === 'live' || view.status === 'decided')
  const singleGameScore = match.bestOf === 1 ? view.games[0]?.score : undefined

  const scoreFor = (slot: 0 | 1) => {
    if (match.bestOf > 1 && view.seriesScore) return view.seriesScore[slot]
    return singleGameScore?.[slot] ?? null
  }

  const teamButton = (slot: 0 | 1) => {
    const { teamId, isBye } = match.slots[slot]
    const team = teamId ? teams[teamId] : undefined
    const won = view.status !== 'bye' && view.winnerSlot === slot
    const lost = view.status !== 'bye' && view.winnerSlot !== null && !won
    const score = scoreFor(slot)
    const name = team?.name ?? teamId ?? (isBye ? 'Bye' : 'TBD')
    return (
      <button
        key={slot}
        className={`match__team${won ? ' is-winner' : ''}${lost ? ' is-loser' : ''}`}
        disabled={!editable}
        onClick={() => teamId && pickWinner(stageId, match, teamId)}
        title={editable ? (won ? `${name} — click to clear` : `Pick ${name}`) : name}
      >
        {variant === 'row' ? (
          <TeamBadge team={team} />
        ) : (
          <>
            <span className="match__name">{name}</span>
            {score !== null && <span className="match__score">{score}</span>}
            {advance && <AdvanceMark advance={advance(slot)} />}
          </>
        )}
      </button>
    )
  }

  const meta = (
    <>
      {view.status === 'live' && <span className="badge badge--live">Live</span>}
      {view.source && view.source !== 'bye' && (
        <span className={`source source--${view.source}`} title={`Result: ${view.source}`} />
      )}
      {editable && (
        <button className="match__edit" onClick={() => openEditor(stageId, match.id)} title="Enter scores" aria-label="Enter scores">
          ✎
        </button>
      )}
    </>
  )

  if (variant === 'row') {
    // Logos (or initials) only, as on HLTV; names are in the tooltips.
    const scores = [scoreFor(0), scoreFor(1)]
    return (
      <div className={`match match--row match--${view.status}`}>
        {view.source && view.source !== 'bye' && (
          <span className={`source source--${view.source}`} title={`Result: ${view.source}`} />
        )}
        {teamButton(0)}
        <div className="match__center">
          <span className="match__vs">{scores[0] !== null && scores[1] !== null ? `${scores[0]}:${scores[1]}` : 'vs'}</span>
          {view.status === 'live' ? (
            <span className="badge badge--live">Live</span>
          ) : (
            <span className="match__bo">Bo{match.bestOf}</span>
          )}
          {editable && (
            <button className="match__edit" onClick={() => openEditor(stageId, match.id)} title="Enter scores" aria-label="Enter scores">
              ✎
            </button>
          )}
        </div>
        {teamButton(1)}
      </div>
    )
  }

  return (
    <div className={`match match--${view.status}`}>
      <div className="match__header">
        <span>Bo{match.bestOf}</span>
        {meta}
      </div>
      {teamButton(0)}
      {teamButton(1)}
    </div>
  )
}

function AdvanceMark({ advance }: { advance: Advance | null }) {
  if (!advance) return <span className="match__advance" aria-hidden />
  return (
    <span className={`match__advance match__advance--${advance.direction}`} title={advance.title} role="img" aria-label={advance.title}>
      {advance.direction === 'on' ? '→' : '↓'}
    </span>
  )
}

/** A Swiss match that hasn't been paired yet. */
export function PlaceholderRow() {
  return (
    <div className="match match--row match--placeholder" aria-label="Not paired yet">
      <span className="match__team">
        <TeamBadge />
      </span>
      <div className="match__center">
        <span className="match__vs">vs</span>
      </div>
      <span className="match__team">
        <TeamBadge />
      </span>
    </div>
  )
}
