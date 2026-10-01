import { useEffect, useMemo, useRef, useState } from 'react'
import { createMonteCarlo, playOrder, type MonteCarloResult } from '../../engine'
import { useTournamentStore } from '../../store/tournament'
import type { StageId, Tournament } from '../../types'

const TOTAL = 2000
const CHUNK = 100

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
  const results = useTournamentStore((s) => s.results)
  const simulation = useTournamentStore((s) => s.simulation)
  const [odds, setOdds] = useState<MonteCarloResult | null>(null)
  const [running, setRunning] = useState(false)
  const [stale, setStale] = useState(false)
  const cancel = useRef<() => void>()

  useEffect(() => {
    if (odds) setStale(true)
    // Only when the inputs change, not when new odds arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament, results, simulation.chaos])

  useEffect(() => () => cancel.current?.(), [])

  const run = () => {
    cancel.current?.()
    const mc = createMonteCarlo(tournament, results, { ...simulation, seed: Date.now() })
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

  const stageChance = (teamId: string, stageId: StageId) => {
    const stageOdds = odds?.teams[teamId]?.stages[stageId]
    if (!stageOdds) return 0
    const places = advancing.get(stageId)
    if (!places) return stageOdds.places[0] ?? 0
    return [...places].reduce((sum, place) => sum + (stageOdds.places[place - 1] ?? 0), 0)
  }

  const rows = odds
    ? Object.keys(tournament.teams).sort(
        (a, b) =>
          (odds.teams[b]?.champion ?? 0) - (odds.teams[a]?.champion ?? 0) ||
          tournament.teams[a].name.localeCompare(tournament.teams[b].name),
      )
    : []

  return (
    <div className="odds">
      <div className="toolbar">
        <button className="button" onClick={run} disabled={running}>
          {running ? `Simulating… ${odds?.iterations ?? 0}/${TOTAL}` : `Run ${TOTAL.toLocaleString()} simulations`}
        </button>
        <span className="hint">
          Picks and actual results stay fixed; everything else is simulated from team ratings
          {simulation.chaos ? ` with ${Math.round(simulation.chaos * 100)}% chaos` : ''}.
        </span>
        {stale && !running && <span className="badge badge--stale">Out of date</span>}
      </div>
      {odds && (
        <div className="table-wrap">
          <table className="odds__table">
            <thead>
              <tr>
                <th>Team</th>
                {stages.map((s) => (
                  <th key={s.id}>
                    {s.name}
                    <div className="muted">{advancing.has(s.id) ? 'advance' : 'win'}</div>
                  </th>
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
    </div>
  )
}
