import { ordinal, placementUses, type ComputedStage } from '../../engine'
import { useTournamentStore } from '../../store/tournament'
import type { BracketSide, Match, Stage, TeamId, Tournament } from '../../types'
import { MatchCard, type Advance } from '../common/MatchCard'
import { useTeams } from '../common/preview'
import { TeamBadge } from '../common/TeamBadge'

/** Matches of one side, grouped into rounds (columns). */
function columnsOf(matches: Match[], side: BracketSide) {
  const rounds = new Map<number, Match[]>()
  for (const m of matches.filter((m) => m.side === side)) rounds.set(m.round, [...(rounds.get(m.round) ?? []), m])
  return [...rounds.entries()].sort(([a], [b]) => a - b).map(([, ms]) => ms)
}

type AdvanceOf = (match: Match, slot: 0 | 1) => Advance | null

/**
 * → for a team that plays on (next match, or a later stage once its place
 * is certain), ↓ for one dropping to the lower bracket or 3rd place match,
 * nothing for a team that's out.
 */
function advanceFor(tournament: Tournament, stage: Stage, computed: ComputedStage): AdvanceOf {
  const uses = placementUses(tournament, stage.id)
  const byId = new Map(computed.matches.map((m) => [m.id, m]))
  const stageName = (id: string) => tournament.stages.find((s) => s.id === id)?.name ?? id

  const laterStage = (teamId: TeamId): Advance | null => {
    const range = computed.places?.[teamId]
    if (!range) return null
    const places = Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i)
    if (!places.every((p) => uses.has(p))) return null
    const names = [...new Set(places.map((p) => stageName(uses.get(p)!)))].join(' or ')
    const place = range[0] === range[1] ? `${ordinal(range[0])}` : `${ordinal(range[0])}–${ordinal(range[1])}`
    return { direction: 'on', title: `Finishes ${place}, goes to ${names}` }
  }

  return (match, slot) => {
    const teamId = match.slots[slot].teamId
    if (!teamId || !match.result || match.result.source === 'bye') return null
    const won = match.result.winnerId === teamId
    const next = won ? match.winnerTo : match.loserTo
    const target = next && byId.get(next.matchId)
    if (!target) return laterStage(teamId)
    if (!won && (target.side === 'lower' || target.side === 'third-place')) return { direction: 'down', title: `Drops to ${target.label}` }
    return { direction: 'on', title: `Plays on in ${target.label}` }
  }
}

function Columns({ stageId, columns, extra, advance }: { stageId: string; columns: Match[][]; extra?: Match[]; advance: AdvanceOf }) {
  return (
    <div className="bracket__columns">
      {columns.map((matches, i) => (
        <div key={i} className="bracket__column">
          <h3 className="column-title">{matches[0]?.label}</h3>
          <div className="bracket__matches">
            {matches.map((m) => (
              <MatchCard key={m.id} stageId={stageId} match={m} advance={(slot) => advance(m, slot)} />
            ))}
          </div>
        </div>
      ))}
      {extra && extra.length > 0 && (
        <div className="bracket__column">
          {extra.map((m) => (
            <div key={m.id} className="bracket__extra">
              <h3 className="column-title">{m.label}</h3>
              <MatchCard stageId={stageId} match={m} advance={(slot) => advance(m, slot)} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Final places once the stage is done, with where each team goes next. */
function Placings({ stage, computed }: { stage: Stage; computed: ComputedStage }) {
  const tournament = useTournamentStore((s) => s.tournament)
  const teams = useTeams()
  if (computed.status !== 'complete') return null
  const uses = placementUses(tournament, stage.id)
  const stageName = (id: string) => tournament.stages.find((s) => s.id === id)?.name ?? id
  return (
    <section className="placings">
      <h2 className="bracket__section">Final placings</h2>
      <ol className="placings__list">
        {computed.ranking.map((teamId, i) => (
          <li key={teamId} className={uses.has(i + 1) ? 'is-advancing' : ''}>
            <span className="placings__place">{ordinal(i + 1)}</span>
            <TeamBadge team={teams[teamId]} />
            <span className="placings__name">{teams[teamId]?.name ?? teamId}</span>
            {uses.has(i + 1) && <span className="placings__next">{stageName(uses.get(i + 1)!)}</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}

export function BracketView({ stage, computed }: { stage: Stage; computed: ComputedStage }) {
  const tournament = useTournamentStore((s) => s.tournament)
  const { matches } = computed
  const advance = advanceFor(tournament, stage, computed)
  if (stage.config.format === 'single-elim') {
    return (
      <div className="bracket">
        <Columns stageId={stage.id} columns={columnsOf(matches, 'main')} extra={matches.filter((m) => m.side === 'third-place')} advance={advance} />
        <Placings stage={stage} computed={computed} />
      </div>
    )
  }
  return (
    <div className="bracket">
      <h2 className="bracket__section">Upper bracket</h2>
      <Columns
        stageId={stage.id}
        columns={columnsOf(matches, 'upper')}
        extra={matches.filter((m) => m.side === 'grand-final')}
        advance={advance}
      />
      <h2 className="bracket__section">Lower bracket</h2>
      <Columns stageId={stage.id} columns={columnsOf(matches, 'lower')} advance={advance} />
      <Placings stage={stage} computed={computed} />
    </div>
  )
}
