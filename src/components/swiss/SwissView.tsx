import { useLayoutEffect, useRef, useState } from 'react'
import type { ComputedStage } from '../../engine'
import { useTournamentStore } from '../../store/tournament'
import type { Match, Stage, SwissConfig, TeamId } from '../../types'
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
  const teams = useTournamentStore((s) => s.tournament.teams)
  const config = stage.config as SwissConfig
  const swiss = computed.swiss!
  const seeds = computed.seeds ?? []
  const columns = buildColumns(seeds.length, config.winsToAdvance, config.lossesToEliminate)

  const container = useRef<HTMLDivElement>(null)
  const cellRefs = useRef(new Map<string, HTMLElement>())
  const [arrows, setArrows] = useState<Arrow[]>([])
  const [size, setSize] = useState({ width: 0, height: 0 })

  const finishedAt = (wins: number, losses: number): TeamId[] =>
    computed.ranking.filter((id) => {
      const s = swiss.standings[id]
      return s.wins === wins && s.losses === losses
    })

  // Redraw arrows whenever the layout may have moved.
  const layoutKey = swiss.rounds.map((r) => r.length).join(',') + '|' + computed.ranking.join(',')
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
      const next: Arrow[] = []
      for (const column of columns) {
        for (const cell of column) {
          if (cell.kind !== 'active') continue
          const from = box(cell.key)
          if (!from) continue
          for (const [kind, target, offset] of [
            ['win', keyOf(cell.wins + 1, cell.losses), -10],
            ['loss', keyOf(cell.wins, cell.losses + 1), 10],
          ] as const) {
            const to = box(target)
            if (!to) continue
            const x1 = from.right + 4
            const y1 = from.mid + offset
            const x2 = to.left - 8
            // Aim at the target's title so arrows land on the record label.
            const y2 = Math.min(to.mid, to.top + 14)
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
    const placeholders = round ? 0 : Math.max(1, Math.round(cell.expected / 2))
    return (
      <div key={cell.key} ref={ref(cell.key)} className="web-cell">
        <div className="web-cell__title">
          {cell.wins}:{cell.losses}
        </div>
        {matches.map((m) =>
          m.slots[1].isBye ? (
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
        {Array.from({ length: placeholders }, (_, i) => (
          <PlaceholderRow key={i} />
        ))}
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
            <marker key={kind} id={`arrow-${kind}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" className={`arrowhead arrowhead--${kind}`} />
            </marker>
          ))}
        </defs>
        {arrows.map((a, i) => (
          <path key={i} d={a.d} className={`arrow arrow--${a.kind}`} markerEnd={`url(#arrow-${a.kind})`} />
        ))}
      </svg>
      {columns.map((column, c) => (
        <div key={c} className="swiss-web__column">
          <div className="swiss-web__top">{column.filter((x) => x.kind === 'advanced').map(renderFinished)}</div>
          <div className="swiss-web__middle">{column.filter((x) => x.kind === 'active').map(renderActive)}</div>
          <div className="swiss-web__bottom">{column.filter((x) => x.kind === 'eliminated').map(renderFinished)}</div>
        </div>
      ))}
    </div>
  )
}
