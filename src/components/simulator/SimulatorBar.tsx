import { useTournamentStore } from '../../store/tournament'
import { useUiStore } from '../../store/ui'
import type { StageId } from '../../types'

/** Shows or hides each team's chance to win on open matches. */
function MatchOddsToggle() {
  const show = useUiStore((s) => s.showMatchOdds)
  const setShow = useUiStore((s) => s.setShowMatchOdds)
  return (
    <label className="check" title="Each team's chance to win matches still to be played, from team ratings">
      <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
      Match odds
    </label>
  )
}

export function SimulatorBar({ activeStageId }: { activeStageId: StageId | null }) {
  const simulate = useTournamentStore((s) => s.simulate)
  const clearSimulated = useTournamentStore((s) => s.clearSimulated)
  const clearResults = useTournamentStore((s) => s.clearResults)
  const simulation = useTournamentStore((s) => s.simulation)
  const setOptions = useTournamentStore((s) => s.setSimulationOptions)
  const view = useTournamentStore((s) => s.editSource)

  // Simulations are predictions, so the actual results view only offers a reset.
  if (view === 'actual')
    return (
      <div className="toolbar">
        <span className="hint">Showing actual results only. Your picks are kept and shown under Picks.</span>
        <MatchOddsToggle />
        <span className="toolbar__spacer" />
        <button
          className="button button--ghost"
          onClick={() => window.confirm('Clear every actual result? Your picks are kept.') && clearResults()}
        >
          Clear actual results
        </button>
      </div>
    )

  return (
    <div className="toolbar">
      <span className="toolbar__label">Simulate</span>
      <button className="button" onClick={() => simulate({ kind: 'round' })}>
        Next round
      </button>
      <button
        className="button"
        disabled={!activeStageId}
        onClick={() => activeStageId && simulate({ kind: 'stage', stageId: activeStageId })}
      >
        This stage
      </button>
      <button className="button" onClick={() => simulate({ kind: 'tournament' })}>
        Everything
      </button>
      <label className="slider" title="0 = ratings decide, 100 = coin flips">
        Chaos
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round((simulation.chaos ?? 0) * 100)}
          onChange={(e) => setOptions({ chaos: Number(e.target.value) / 100 })}
        />
        <span className="slider__value">{Math.round((simulation.chaos ?? 0) * 100)}</span>
      </label>
      <select
        value={simulation.detail ?? 'games'}
        onChange={(e) => setOptions({ detail: e.target.value as 'winner' | 'series' | 'games' })}
        aria-label="Simulation detail"
      >
        <option value="games">Full scores</option>
        <option value="series">Series scores</option>
        <option value="winner">Winners only</option>
      </select>
      <MatchOddsToggle />
      <span className="toolbar__spacer" />
      <button className="button button--ghost" onClick={clearSimulated}>
        Clear simulated
      </button>
      <button
        className="button button--ghost"
        onClick={() => window.confirm('Clear every pick and simulation? Actual results are kept.') && clearResults()}
      >
        Clear picks
      </button>
    </div>
  )
}
