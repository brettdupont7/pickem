import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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

/** Half the gap between rounds (see .bracket__columns), so lines turn midway between columns. */
const TURN_BEFORE = 20

interface Line {
  d: string
  /** The winner has moved along this line. */
  decided: boolean
}

/**
 * Draws a line from each match to the match its winner plays next, centre
 * to centre, so two feeders fork symmetrically into the match between
 * them. Matches are found by `data-match`. Losers dropping to the lower
 * bracket get no line; the ↓ marks show those.
 */
function Connectors({ matches, children }: { matches: Match[]; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [size, setSize] = useState({ width: 0, height: 0 })

  // Redraw when teams or results change, since rows can change height.
  const layoutKey = matches.map((m) => `${m.id}:${m.slots.map((s) => s.teamId).join(',')}:${m.result?.winnerId ?? ''}`).join('|')
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const draw = () => {
      const find = (id: string) => {
        const card = el.querySelector<HTMLElement>(`[data-match="${CSS.escape(id)}"] .match`)
        return card && !card.classList.contains('match--empty') ? card : null
      }
      const middle = (card: HTMLElement) => {
        const r = card.getBoundingClientRect()
        return r.top + r.height / 2
      }

      // The grand final has its own column, so centre it between the two
      // finals that feed it. Transforms don't affect layout, so this can't
      // loop through the resize observer.
      const finals = el.querySelector<HTMLElement>('.bracket__finals')
      const grandFinal = matches.find((m) => m.side === 'grand-final')
      if (finals && grandFinal) {
        const feeders = matches.filter((m) => m.winnerTo?.matchId === grandFinal.id).map((m) => find(m.id))
        const target = find(grandFinal.id)
        if (target && feeders.length === 2 && feeders.every(Boolean)) {
          const current = Number(finals.dataset.shift ?? 0)
          const shift = current + (middle(feeders[0]!) + middle(feeders[1]!)) / 2 - middle(target)
          finals.dataset.shift = String(shift)
          finals.style.transform = `translateY(${shift}px)`
        }
      }

      const origin = el.getBoundingClientRect()
      const next: Line[] = []
      for (const m of matches) {
        if (!m.winnerTo) continue
        const from = find(m.id)
        const to = find(m.winnerTo.matchId)
        if (!from || !to) continue
        const x1 = from.getBoundingClientRect().right - origin.left
        const x2 = to.getBoundingClientRect().left - origin.left
        const y1 = middle(from) - origin.top
        const y2 = middle(to) - origin.top
        if (x2 <= x1) continue
        // Turn just before the target, so every line into a match shares the
        // same vertical even when one feeder is further away (the grand final).
        const turn = x2 - Math.min(TURN_BEFORE, (x2 - x1) / 2)
        // Straight across when the two line up (within a pixel of rounding).
        const d = Math.abs(y2 - y1) < 1 ? `M${x1},${y1} H${x2}` : `M${x1},${y1} H${turn} V${y2} H${x2}`
        next.push({ d, decided: !!m.result })
      }
      setLines(next)
      setSize({ width: el.scrollWidth, height: el.scrollHeight })
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(el)
    return () => observer.disconnect()
    // layoutKey covers everything in matches that affects the drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey])

  return (
    <div className="bracket__connected" ref={root}>
      <svg className="bracket__lines" width={size.width} height={size.height} aria-hidden>
        {/* Undecided lines first, so decided ones draw on top where they share a segment. */}
        {[...lines]
          .sort((a, b) => Number(a.decided) - Number(b.decided))
          .map((line, i) => (
            <path key={i} d={line.d} className={`connector${line.decided ? ' connector--decided' : ''}`} />
          ))}
      </svg>
      {children}
    </div>
  )
}

function Column({ stageId, title, matches, advance }: { stageId: string; title?: string; matches: Match[]; advance: AdvanceOf }) {
  return (
    <div className="bracket__column">
      <h3 className="column-title">{title ?? matches[0]?.label}</h3>
      <div className="bracket__matches">
        {matches.map((m) => (
          <div key={m.id} data-match={m.id}>
            <MatchCard stageId={stageId} match={m} advance={(slot) => advance(m, slot)} />
          </div>
        ))}
      </div>
    </div>
  )
}

function Columns({ stageId, columns, advance }: { stageId: string; columns: Match[][]; advance: AdvanceOf }) {
  return (
    <div className="bracket__columns">
      {columns.map((matches, i) => (
        <Column key={i} stageId={stageId} matches={matches} advance={advance} />
      ))}
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
    const thirdPlace = matches.filter((m) => m.side === 'third-place')
    return (
      <div className="bracket">
        <Connectors matches={matches}>
          <div className="bracket__columns">
            {columnsOf(matches, 'main').map((round, i) => (
              <Column key={i} stageId={stage.id} matches={round} advance={advance} />
            ))}
            {thirdPlace.length > 0 && <Column stageId={stage.id} matches={thirdPlace} advance={advance} />}
          </div>
        </Connectors>
        <Placings stage={stage} computed={computed} />
      </div>
    )
  }
  // The grand final (and any reset) sits to the right of both brackets, so
  // both finals can draw a line into it.
  const finals = matches.filter((m) => m.side === 'grand-final')
  return (
    <div className="bracket">
      <Connectors matches={matches}>
        <div className="bracket__double">
          <div className="bracket__sides">
            <h2 className="bracket__section">Upper bracket</h2>
            <Columns stageId={stage.id} columns={columnsOf(matches, 'upper')} advance={advance} />
            <h2 className="bracket__section">Lower bracket</h2>
            <Columns stageId={stage.id} columns={columnsOf(matches, 'lower')} advance={advance} />
          </div>
          {finals.length > 0 && (
            <div className="bracket__finals">
              {finals.map((m) => (
                <Column key={m.id} stageId={stage.id} matches={[m]} advance={advance} />
              ))}
            </div>
          )}
        </div>
      </Connectors>
      <Placings stage={stage} computed={computed} />
    </div>
  )
}
