import { describeMatch, resolveForMatch } from '../../engine'
import { useMatchOdds, useTournamentStore } from '../../store/tournament'
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
  const resultView = useTournamentStore((s) => s.editSource)
  const storedPick = useTournamentStore((s) => s.picks[stageId]?.[match.id])
  const openEditor = useUiStore((s) => s.openEditor)
  const showOdds = useUiStore((s) => s.showMatchOdds)
  const matchOdds = useMatchOdds()

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
  // In the picks view, actual results are shown on top of picks and can only be changed in the actual view.
  const locked = !preview && resultView === 'pick' && view.source === 'actual'
  const editable = !preview && !locked && (view.status === 'ready' || view.status === 'live' || view.status === 'decided')
  // The pick an actual result is hiding, marked right or wrong.
  const pickedId = locked && storedPick ? resolveForMatch(storedPick, match, scoring).result?.winnerId : undefined
  const pickRight = pickedId !== undefined && pickedId === match.result?.winnerId
  // Each team's chance to win, for matches still to be decided.
  const firstWins = showOdds && !preview && (view.status === 'ready' || view.status === 'live') ? matchOdds(match) : null
  const chanceFor = (slot: 0 | 1) => (firstWins === null ? null : slot === 0 ? firstWins : 1 - firstWins)
  const singleGameScore = match.bestOf === 1 ? view.games[0]?.score : undefined

  const scoreFor = (slot: 0 | 1) => {
    if (match.bestOf > 1 && view.seriesScore) return view.seriesScore[slot]
    return singleGameScore?.[slot] ?? null
  }

  const teamButton = (slot: 0 | 1) => {
    const { teamId, isBye, expected } = match.slots[slot]
    // A team already through whose exact slot waits on the rest of the round.
    const team = teamId ? teams[teamId] : expected ? teams[expected] : undefined
    const won = view.status !== 'bye' && view.winnerSlot === slot
    const lost = view.status !== 'bye' && view.winnerSlot !== null && !won
    const score = scoreFor(slot)
    const name = team?.name ?? teamId ?? expected ?? (isBye ? 'Bye' : 'TBD')
    const chance = chanceFor(slot)
    const odds = chance !== null && (
      <span className="match__odds" title={`${name}: ${formatChance(chance)} to win, from team ratings`}>
        {formatChance(chance)}
      </span>
    )
    return (
      <button
        key={slot}
        className={`match__team${won ? ' is-winner' : ''}${lost ? ' is-loser' : ''}${!teamId && expected ? ' is-expected' : ''}`}
        disabled={!editable}
        onClick={() => teamId && pickWinner(stageId, match, teamId)}
        title={
          !teamId && expected
            ? `${name} is through; the matchup is set once the round before finishes`
            : editable
            ? won
              ? `${name} — click to clear`
              : resultView === 'actual'
                ? `${name} won`
                : `Pick ${name}`
            : locked
              ? `${name} — actual result (change it in Actual results)`
              : name
        }
      >
        {variant === 'row' ? (
          // The mark sits on the badge's corner, so it stays inside the card on either side.
          <>
            {slot === 1 && odds}
            <span className="match__badge">
              <TeamBadge team={team} />
              {pickedId === teamId && <PickMark right={pickRight} name={name} />}
            </span>
            {slot === 0 && odds}
          </>
        ) : (
          <>
            <span className="match__name">{name}</span>
            {pickedId === teamId && <PickMark right={pickRight} name={name} />}
            {odds}
            {score !== null && <span className="match__score">{score}</span>}
            {advance && <AdvanceMark advance={advance(slot)} />}
          </>
        )}
      </button>
    )
  }

  const meta = (
    <>
      {match.slots.some((s) => !s.teamId && s.expected) && (
        <span className="badge badge--tbd" title="Matchup set once the round before finishes">
          TBD
        </span>
      )}
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
      <div className={`match match--row match--${view.status}${locked ? ' match--locked' : ''}`}>
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
    <div className={`match match--${view.status}${locked ? ' match--locked' : ''}`}>
      <div className="match__header">
        <span>Bo{match.bestOf}</span>
        {meta}
      </div>
      {teamButton(0)}
      {teamButton(1)}
    </div>
  )
}

/** A win chance, never shown as a certainty while the match is open. */
const formatChance = (p: number) => `${Math.min(99, Math.max(1, Math.round(p * 100)))}%`

/** Marks the team the user picked, once the actual result is in. */
function PickMark({ right, name }: { right: boolean; name: string }) {
  const label = `Your pick: ${name} (${right ? 'right' : 'wrong'})`
  return (
    <span className={`pick-mark pick-mark--${right ? 'right' : 'wrong'}`} title={label} role="img" aria-label={label}>
      {right ? '✓' : '✗'}
    </span>
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
