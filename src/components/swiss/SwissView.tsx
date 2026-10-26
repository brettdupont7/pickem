import { useId, useLayoutEffect, useRef, useState } from 'react'
import { recordsBefore, swapTeams, updateStage, type ComputedStage } from '../../engine'
import { useTournamentStore } from '../../store/tournament'
import { useIsPreview, useTeams } from '../common/preview'
import type { Match, Stage, SwissConfig, Team, TeamId } from '../../types'
import { MatchCard, PlaceholderRow } from '../common/MatchCard'
import { TeamBadge } from '../common/TeamBadge'

type CellKind = 'active' | 'advanced' | 'eliminated'

interface Cell {
  key: string
  wins: number
  losses: number
  kind: CellKind
  /** Teams expected to hold this record, for placeholders before it's reached. */
  expected: number
}

interface Arrow {
  d: string
  kind: 'win' | 'loss'
}

const keyOf = (wins: number, losses: number) => `${wins}-${losses}`

/** How far above/below a cell's middle its win and loss arrows leave and arrive. */
const ARROW_SPREAD = 10

/**
 * Every record a team can hold, laid out by games played: column c holds
 * records with wins + losses = c. A 3/3 stage gives 6 columns (0:0 through
 * 3:2 / 2:3).
 */
function buildColumns(teamCount: number, winsToAdvance: number, lossesToEliminate: number): Cell[][] {
  // Expected teams per record if every group split evenly.
  const expected = new Map<string, number>([[keyOf(0, 0), teamCount]])
  const columns: Cell[][] = []
  for (let c = 0; c < winsToAdvance + lossesToEliminate; c++) {
    const column: Cell[] = []
    for (let wins = Math.min(c, winsToAdvance); wins >= 0; wins--) {
      const losses = c - wins
      if (losses > lossesToEliminate || (wins === winsToAdvance && losses === lossesToEliminate)) continue
      const kind: CellKind = wins === winsToAdvance ? 'advanced' : losses === lossesToEliminate ? 'eliminated' : 'active'
      const count = expected.get(keyOf(wins, losses)) ?? 0
      column.push({ key: keyOf(wins, losses), wins, losses, kind, expected: count })
      if (kind === 'active') {
        const half = count / 2
        expected.set(keyOf(wins + 1, losses), (expected.get(keyOf(wins + 1, losses)) ?? 0) + half)
        expected.set(keyOf(wins, losses + 1), (expected.get(keyOf(wins, losses + 1)) ?? 0) + half)
      }
    }
    columns.push(column)
  }
  return columns
}

/** Matches of a round grouped by the record they were played at. */
function matchesByRecord(round: Match[] | undefined) {
  const groups = new Map<string, Match[]>()
  for (const m of round ?? []) {
    // Cross-record pairings ("2-1 v 1-2") sit with the higher record.
    const record = (m.label ?? '').split(' ')[0]
    groups.set(record, [...(groups.get(record) ?? []), m])
  }
  return groups
}

export function SwissView({ stage, computed }: { stage: Stage; computed: ComputedStage }) {
  const teams = useTeams()
  const preview = useIsPreview()
  const updateTournament = useTournamentStore((s) => s.updateTournament)
  const config = stage.config as SwissConfig
  const swiss = computed.swiss!
  const seeds = computed.seeds ?? []
  const columns = buildColumns(seeds.length, config.winsToAdvance, config.lossesToEliminate)

  // Marker IDs must be unique on the page, which can show several Swiss stages (designer previews).
  const markerId = `swiss-arrow-${useId().replace(/:/g, '')}`
  const container = useRef<HTMLDivElement>(null)
  const cellRefs = useRef(new Map<string, HTMLElement>())
  const [arrows, setArrows] = useState<Arrow[]>([])
  const [size, setSize] = useState({ width: 0, height: 0 })
  /** The round whose matchups are being rearranged, and the team picked up to swap. */
  const [editing, setEditing] = useState<number | null>(null)
  const [held, setHeld] = useState<TeamId | null>(null)
  const records = editing === null ? {} : recordsBefore(swiss.rounds, editing)

  const setDrawnRound = (round: number, pairs: [number, number][] | undefined) =>
    updateTournament((t) =>
      updateStage(t, stage.id, (s) => {
        const { drawnRounds, ...rest } = s.config as SwissConfig
        const next = { ...drawnRounds }
        if (pairs) next[round] = pairs
        else delete next[round]
        return { ...s, config: Object.keys(next).length ? { ...rest, drawnRounds: next } : rest }
      }),
    )
  // Only teams with the same record going into the round can trade places.
  const canSwap = (a: TeamId | null, b: TeamId) => a !== null && a !== b && records[a] === records[b]
  const swap = (a: TeamId, b: TeamId) => {
    setHeld(null)
    if (editing !== null && canSwap(a, b)) setDrawnRound(editing, swapTeams(swiss.rounds[editing], seeds, a, b))
  }
  const toggleEditing = (round: number) => {
    setHeld(null)
    setEditing(editing === round ? null : round)
  }

  /** Teams decided in the round being played, headed for this record (best-ranked first). */
  const upcomingAt = (wins: number, losses: number): TeamId[] =>
    computed.ranking.filter((id) => swiss.upcoming[id]?.wins === wins && swiss.upcoming[id]?.losses === losses)

  // Includes teams that just reached this record in the round being played.
  const finishedAt = (wins: number, losses: number): TeamId[] => [
    ...computed.ranking.filter((id) => {
      const s = swiss.standings[id]
      return s.wins === wins && s.losses === losses
    }),
    ...upcomingAt(wins, losses),
  ]

  // Redraw arrows whenever the layout may have moved.
  const layoutKey = swiss.rounds.map((r) => r.length).join(',') + '|' + computed.ranking.join(',') + '|' + Object.keys(swiss.upcoming).join(',')
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const draw = () => {
      const origin = root.getBoundingClientRect()
      const box = (key: string) => {
        const el = cellRefs.current.get(key)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left - origin.left, right: r.right - origin.left, top: r.top - origin.top, mid: r.top - origin.top + r.height / 2 }
      }
      const active = new Set(columns.flat().filter((c) => c.kind === 'active').map((c) => c.key))
      const next: Arrow[] = []
      for (const column of columns) {
        for (const cell of column) {
          if (cell.kind !== 'active') continue
          const from = box(cell.key)
          if (!from) continue
          // Higher records sit higher, so a win goes up and a loss goes down.
          // A cell reached both ways gets its loss arrow (from the cell above)
          // just above its middle and its win arrow just below, so they never
          // cross or land on each other.
          for (const [kind, wins, losses, out] of [
            ['win', cell.wins + 1, cell.losses, -ARROW_SPREAD],
            ['loss', cell.wins, cell.losses + 1, ARROW_SPREAD],
          ] as const) {
            const to = box(keyOf(wins, losses))
            if (!to) continue
            const reachedBoth = active.has(keyOf(wins - 1, losses)) && active.has(keyOf(wins, losses - 1))
            const x1 = from.right + 4
            const y1 = from.mid + out
            const x2 = to.left - 8
            const y2 = to.mid + (reachedBoth ? -out : 0)
            const dx = (x2 - x1) / 2
            next.push({ kind, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` })
          }
        }
      }
      setArrows(next)
      setSize({ width: root.scrollWidth, height: root.scrollHeight })
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(root)
    return () => observer.disconnect()
    // columns is derived from the stage config, which layoutKey doesn't cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, stage.config, seeds.length])

  const ref = (key: string) => (el: HTMLElement | null) => {
    if (el) cellRefs.current.set(key, el)
    else cellRefs.current.delete(key)
  }

  const renderActive = (cell: Cell) => {
    const round = swiss.rounds[cell.wins + cell.losses]
    const matches = matchesByRecord(round).get(cell.key) ?? []
    // Once a round is paired, a record with no matches doesn't occur.
    if (round && matches.length === 0) return null
    // Teams already headed here; their opponents are paired once the round before finishes.
    const arriving = round ? [] : upcomingAt(cell.wins, cell.losses)
    const rows = round ? 0 : Math.max(1, Math.round(cell.expected / 2), Math.ceil(arriving.length / 2))
    return (
      <div key={cell.key} ref={ref(cell.key)} className="web-cell">
        <div className="web-cell__title">
          {cell.wins}:{cell.losses}
          {arriving.length > 0 && (
            <span className="badge badge--tbd" title="These teams are headed here; who plays whom is decided once the current round finishes.">
              TBD
            </span>
          )}
        </div>
        {matches.map((m) =>
          editing === cell.wins + cell.losses ? (
            <EditRow key={m.id} match={m} teams={teams} held={held} canSwap={canSwap} onHold={setHeld} onSwap={swap} />
          ) : m.slots[1].isBye ? (
            <div key={m.id} className="match match--row match--bye">
              <span className="match__team" title={teams[m.slots[0].teamId!]?.name}>
                <TeamBadge team={teams[m.slots[0].teamId!]} />
              </span>
              <div className="match__center">
                <span className="match__vs">bye</span>
              </div>
              <span />
            </div>
          ) : (
            <MatchCard key={m.id} stageId={stage.id} match={m} variant="row" />
          ),
        )}
        {arriving.length > 0
          ? Array.from({ length: rows }, (_, i) => (
              <ArrivingRow key={i} teams={[arriving[2 * i], arriving[2 * i + 1]].map((id) => (id ? teams[id] : undefined))} />
            ))
          : Array.from({ length: rows }, (_, i) => <PlaceholderRow key={i} />)}
      </div>
    )
  }

  const renderFinished = (cell: Cell) => {
    const ids = finishedAt(cell.wins, cell.losses)
    const pending = computed.status === 'complete' ? 0 : Math.max(0, Math.round(cell.expected) - ids.length)
    if (ids.length === 0 && pending === 0) return null
    return (
      <div key={cell.key} ref={ref(cell.key)} className={`web-cell web-cell--${cell.kind}`}>
        <div className="web-cell__title">
          {cell.wins}:{cell.losses}
        </div>
        <div className="web-cell__teams">
          {ids.map((id) => (
            <span key={id} className="web-cell__team" title={teams[id]?.name ?? id}>
              <TeamBadge team={teams[id]} />
              <span className="web-cell__name">{teams[id]?.name ?? id}</span>
            </span>
          ))}
          {Array.from({ length: pending }, (_, i) => (
            <span key={`p${i}`} className="web-cell__team">
              <TeamBadge />
            </span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="swiss-web" ref={container}>
      <svg className="swiss-web__arrows" width={size.width} height={size.height} aria-hidden>
        <defs>
          {(['win', 'loss'] as const).map((kind) => (
            <marker key={kind} id={`${markerId}-${kind}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" className={`arrowhead arrowhead--${kind}`} />
            </marker>
          ))}
        </defs>
        {arrows.map((a, i) => (
          <path key={i} d={a.d} className={`arrow arrow--${a.kind}`} markerEnd={`url(#${markerId}-${a.kind})`} />
        ))}
      </svg>
      {columns.map((column, c) => (
        <div key={c} className="swiss-web__column">
          {!preview && (
            <RoundHeader
              round={c}
              paired={!!swiss.rounds[c]}
              drawn={!!config.drawnRounds?.[c]}
              unfit={swiss.unfitDraws.includes(c)}
              editing={editing === c}
              onToggle={() => toggleEditing(c)}
              onReset={() => setDrawnRound(c, undefined)}
            />
          )}
          <div className="swiss-web__top">{column.filter((x) => x.kind === 'advanced').map(renderFinished)}</div>
          <div className="swiss-web__middle">{column.filter((x) => x.kind === 'active').map(renderActive)}</div>
          <div className="swiss-web__bottom">{column.filter((x) => x.kind === 'eliminated').map(renderFinished)}</div>
        </div>
      ))}
    </div>
  )
}

/** Two slots of a record whose pairings aren't made yet, holding teams already headed there. */
function ArrivingRow({ teams }: { teams: (Team | undefined)[] }) {
  return (
    <div className="match match--row match--arriving" aria-label="Not paired yet">
      <span className="match__team" title={teams[0]?.name ?? 'To be decided'}>
        <TeamBadge team={teams[0]} />
      </span>
      <div className="match__center">
        <span className="match__vs">TBD</span>
      </div>
      <span className="match__team" title={teams[1]?.name ?? 'To be decided'}>
        <TeamBadge team={teams[1]} />
      </span>
    </div>
  )
}

interface RoundHeaderProps {
  round: number
  /** Whether the round's matches exist yet; they're paired once the round before finishes. */
  paired: boolean
  drawn: boolean
  unfit: boolean
  editing: boolean
  onToggle: () => void
  onReset: () => void
}

/** Above a round's column: whether its matchups were set by hand, and the button to rearrange them. */
function RoundHeader({ round, paired, drawn, unfit, editing, onToggle, onReset }: RoundHeaderProps) {
  return (
    <div className="swiss-web__header">
      {paired && (
        <>
          <button
            className={`button button--small${editing ? ' is-active' : ''}`}
            aria-pressed={editing}
            onClick={onToggle}
            title={editing ? 'Stop rearranging' : 'Rearrange matchups: drag a team onto another with the same record, or click one then the other'}
          >
            {editing ? 'Done' : `Edit round ${round + 1}`}
          </button>
          {editing && drawn && (
            <button className="button button--small button--ghost" onClick={onReset} title="Pair this round by the stage's pairing rules again">
              Reset
            </button>
          )}
          {drawn && (
            <span
              className="badge badge--stale"
              title={
                unfit
                  ? "These matchups set by hand aren't the teams playing this round with the current results, so the pairing rules set it."
                  : 'Matchups set by hand'
              }
            >
              {unfit ? 'Not used' : 'By hand'}
            </span>
          )}
        </>
      )}
    </div>
  )
}

interface EditRowProps {
  match: Match
  teams: Record<TeamId, Team>
  held: TeamId | null
  canSwap: (a: TeamId | null, b: TeamId) => boolean
  onHold: (id: TeamId | null) => void
  onSwap: (a: TeamId, b: TeamId) => void
}

/** A match while its round is being rearranged: teams can be swapped, not picked. */
function EditRow({ match, teams, held, canSwap, onHold, onSwap }: EditRowProps) {
  const slot = (id: TeamId | null) => {
    if (!id) return <span />
    const target = canSwap(held, id)
    const name = teams[id]?.name ?? id
    return (
      <button
        className={`match__team${held === id ? ' is-held' : ''}${target ? ' is-target' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', id)
          e.dataTransfer.effectAllowed = 'move'
          onHold(id)
        }}
        onDragEnd={() => onHold(null)}
        onDragOver={(e) => target && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (held) onSwap(held, id)
        }}
        onClick={() => (target ? onSwap(held!, id) : onHold(held === id ? null : id))}
        title={target ? `Swap with ${name}` : held === id ? `${name} — click another team with the same record to swap` : name}
      >
        <span className="match__badge">
          <TeamBadge team={teams[id]} />
        </span>
      </button>
    )
  }
  return (
    <div className="match match--row match--editing">
      {slot(match.slots[0].teamId)}
      <div className="match__center">
        <span className="match__vs">{match.slots[1].teamId ? 'vs' : 'bye'}</span>
      </div>
      {slot(match.slots[1].teamId)}
    </div>
  )
}
