import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createMonteCarlo, playOrder, simulationRatings, type MatchOdds, type MonteCarloResult } from '../../engine'
import { useTournamentStore, useViewResults } from '../../store/tournament'
import type { StageId, Tournament } from '../../types'

const TOTAL = 2000
const CHUNK = 100

/** Sort column for team names; any other column is a stage ID. */
const TEAM = '\u0000team'

const percent = (p: number) => (p === 0 ? '—' : p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`)

/** Places of each stage that feed a later stage: those count as advancing. */
function advancingPlaces(tournament: Tournament): Map<StageId, Set<number>> {
  const places = new Map<StageId, Set<number>>()
  for (const stage of tournament.stages) {
    for (const e of stage.entrants) {
      if (e.kind !== 'placement') continue
      places.set(e.stageId, (places.get(e.stageId) ?? new Set()).add(e.place))
    }
  }
  return places
}

export function OddsPanel() {
  const tournament = useTournamentStore((s) => s.tournament)
  const results = useViewResults()
  const view = useTournamentStore((s) => s.editSource)
  const simulation = useTournamentStore((s) => s.simulation)
  const [odds, setOdds] = useState<MonteCarloResult | null>(null)
  const [running, setRunning] = useState(false)
  const [stale, setStale] = useState(false)
  /** null: by chance of winning the event, then name. */
  const [sort, setSort] = useState<{ column: string; desc: boolean } | null>(null)
  const cancel = useRef<() => void>()

  useEffect(() => {
    if (odds) setStale(true)
    // Only when the inputs change, not when new odds arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament, results, simulation.chaos])

  // Odds from the other view don't apply to this one.
  useEffect(() => {
    cancel.current?.()
    setRunning(false)
    setOdds(null)
    setStale(false)
  }, [view])

  useEffect(() => () => cancel.current?.(), [])

  const run = () => {
    cancel.current?.()
    const mc = createMonteCarlo(tournament, results, { ...simulation, ratings: simulationRatings(tournament, results), seed: Date.now() })
    let stopped = false
    cancel.current = () => (stopped = true)
    setRunning(true)
    setStale(false)
    const step = () => {
      if (stopped) return
      mc.run(CHUNK)
      const result = mc.result()
      setOdds(result)
      if (result.iterations < TOTAL) setTimeout(step, 0)
      else setRunning(false)
    }
    step()
  }

  const stages = playOrder(tournament.stages)
  const advancing = useMemo(() => advancingPlaces(tournament), [tournament])

  /** Chance of advancing from a stage (or winning it, for the last) from the chance of each place. */
  const advanceChance = (stageId: StageId, placeOdds: number[]) => {
    const places = advancing.get(stageId)
    if (!places) return placeOdds[0] ?? 0
    return [...places].reduce((sum, place) => sum + (placeOdds[place - 1] ?? 0), 0)
  }

  const stageChance = (teamId: string, stageId: StageId) => {
    const stageOdds = odds?.teams[teamId]?.stages[stageId]
    return stageOdds ? advanceChance(stageId, stageOdds.places) : 0
  }

  const name = (id: string) => tournament.teams[id].name
  const chanceOrNone = (id: string, stageId: StageId) => ((odds?.teams[id]?.stages[stageId]?.entered ?? 0) > 0 ? stageChance(id, stageId) : -1)
  const byDefault = (a: string, b: string) => (odds!.teams[b]?.champion ?? 0) - (odds!.teams[a]?.champion ?? 0) || name(a).localeCompare(name(b))
  const rows = odds
    ? Object.keys(tournament.teams).sort((a, b) => {
        if (!sort) return byDefault(a, b)
        if (sort.column === TEAM) return sort.desc ? name(b).localeCompare(name(a)) : name(a).localeCompare(name(b))
        const [ca, cb] = [chanceOrNone(a, sort.column), chanceOrNone(b, sort.column)]
        // Teams that can't reach the stage stay at the bottom either way.
        if ((ca < 0) !== (cb < 0)) return ca < 0 ? 1 : -1
        return (sort.desc ? cb - ca : ca - cb) || byDefault(a, b)
      })
    : []

  const sortBy = (column: string) => {
    // Chances start highest first and names A-Z; a third click goes back to the default order.
    const firstDesc = column !== TEAM
    setSort(sort?.column !== column ? { column, desc: firstDesc } : sort.desc === firstDesc ? { column, desc: !firstDesc } : null)
  }

  const header = (column: string, label: React.ReactNode) => (
    <th aria-sort={sort?.column === column ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button className="sort-button" onClick={() => sortBy(column)} title="Sort by this column">
        {label}
        <span className="sort-button__arrow">{sort?.column === column ? (sort.desc ? '▼' : '▲') : ''}</span>
      </button>
    </th>
  )

  return (
    <div className="odds">
      <div className="toolbar">
        <button className="button" onClick={run} disabled={running}>
          {running ? `Simulating… ${odds?.iterations ?? 0}/${TOTAL}` : `Run ${TOTAL.toLocaleString()} simulations`}
        </button>
        <span className="hint">
          {view === 'actual'
            ? 'Actual results stay fixed (your picks are ignored); everything else is simulated from team ratings'
            : 'Picks and actual results stay fixed; everything else is simulated from team ratings'}
          {tournament.rules?.formK
            ? `, adjusted for form in actual results${tournament.rules.formFromPicks && view === 'pick' ? ' and picks' : ''}`
            : ''}
          {simulation.chaos ? ` with ${Math.round(simulation.chaos * 100)}% chaos` : ''}.
        </span>
        {stale && !running && <span className="badge badge--stale">Out of date</span>}
      </div>
      {odds && (
        <div className="table-wrap">
          <table className="odds__table">
            <thead>
              <tr>
                {header(TEAM, 'Team')}
                {stages.map((s) => (
                  <Fragment key={s.id}>
                    {header(
                      s.id,
                      <span>
                        {s.name}
                        <span className="muted odds__what">{advancing.has(s.id) ? 'advance' : 'win'}</span>
                      </span>,
                    )}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((id) => (
                <tr key={id}>
                  <td>{tournament.teams[id].name}</td>
                  {stages.map((s) => {
                    const entered = odds.teams[id]?.stages[s.id]?.entered ?? 0
                    const chance = stageChance(id, s.id)
                    return (
                      <td key={s.id} className={entered === 0 ? 'muted' : undefined}>
                        <span className="odds__bar" style={{ ['--p' as string]: chance }} />
                        {entered === 0 ? '' : percent(chance)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {odds && odds.matches.length > 0 && <MatchesThatMatter odds={odds} advanceChance={advanceChance} advancing={advancing} />}
    </div>
  )
}

interface SwingRow {
  match: MatchOdds
  /** Per team: chance to win the match, and to advance from the stage if they win or lose. */
  teams: { id: string; wins: number; ifWin: number; ifLose: number }[]
  swing: number
}

/** Open matches, ordered by how much their result moves the two teams' chances in the stage. */
function MatchesThatMatter({
  odds,
  advanceChance,
  advancing,
}: {
  odds: MonteCarloResult
  advanceChance: (stageId: StageId, placeOdds: number[]) => number
  advancing: Map<StageId, Set<number>>
}) {
  const tournament = useTournamentStore((s) => s.tournament)
  const stageName = (id: StageId) => tournament.stages.find((s) => s.id === id)?.name ?? id

  const rows: SwingRow[] = odds.matches
    .map((match) => {
      const [a, b] = match.teams
      const teams = match.teams.map((id) => {
        const other = id === a ? b : a
        return {
          id,
          wins: id === a ? match.firstWins : 1 - match.firstWins,
          ifWin: advanceChance(match.stageId, match.ifWins[id][id]),
          ifLose: advanceChance(match.stageId, match.ifWins[other][id]),
        }
      })
      return { match, teams, swing: Math.max(...teams.map((t) => t.ifWin - t.ifLose)) }
    })
    .sort((x, y) => y.swing - x.swing)

  const points = (p: number) => `${p > 0 ? '+' : ''}${Math.round(p * 100)}`
  // Say what the chances are for when every match agrees; otherwise each match says it under its name.
  const goals = new Set(rows.map((r) => (advancing.has(r.match.stageId) ? 'Advance' : 'Win it all')))
  const goal = goals.size === 1 ? `${[...goals][0]} if they` : 'If they'

  return (
    <section className="swings">
      <h3>Matches that matter</h3>
      <p className="hint">
        Matches that can be played now, biggest swing first: each team's chance to advance from the stage (or win it, for the
        last stage) if they win the match or lose it, and the difference in percentage points.
      </p>
      <div className="table-wrap">
        <table className="odds__table swings__table">
          <thead>
            <tr>
              <th>Match</th>
              <th>Team</th>
              <th>Win match</th>
              <th>{goal} win</th>
              <th>{goal} lose</th>
              <th>Swing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ match, teams }) =>
              teams.map((t, i) => (
                <tr key={`${match.stageId}/${match.matchId}/${t.id}`}>
                  {i === 0 && (
                    <td rowSpan={2}>
                      {tournament.teams[teams[0].id].name} vs {tournament.teams[teams[1].id].name}
                      <span className="muted odds__what">
                        {stageName(match.stageId)} · {advancing.has(match.stageId) ? 'advance' : 'win'}
                      </span>
                    </td>
                  )}
                  <td>{tournament.teams[t.id].name}</td>
                  <td>{percent(t.wins)}</td>
                  <td>
                    <span className="odds__bar" style={{ ['--p' as string]: t.ifWin }} />
                    {percent(t.ifWin)}
                  </td>
                  <td>
                    <span className="odds__bar" style={{ ['--p' as string]: t.ifLose }} />
                    {percent(t.ifLose)}
                  </td>
                  <td>{points(t.ifWin - t.ifLose)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
