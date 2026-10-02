import { useEffect } from 'react'
import { MatchEditor } from './components/common/MatchEditor'
import { StageView } from './components/common/StageView'
import { TeamsPanel } from './components/common/TeamsPanel'
import { OddsPanel } from './components/simulator/OddsPanel'
import { SimulatorBar } from './components/simulator/SimulatorBar'
import { presets } from './data/presets'
import { playOrder } from './engine'
import { useTournamentState, useTournamentStore } from './store/tournament'
import { useUiStore, type View } from './store/ui'

const STATUS_LABEL = { waiting: 'Waiting', 'in-progress': 'In progress', complete: 'Done', invalid: 'Invalid' }

export default function App() {
  const tournament = useTournamentStore((s) => s.tournament)
  const loadTournament = useTournamentStore((s) => s.loadTournament)
  const editSource = useTournamentStore((s) => s.editSource)
  const setEditSource = useTournamentStore((s) => s.setEditSource)
  const state = useTournamentState()
  const { view, setView, activeStageId, setActiveStage } = useUiStore()

  const stages = playOrder(tournament.stages)
  const active = stages.find((s) => s.id === activeStageId) ?? stages[0]

  // Follow the action: open on the first stage that still has matches to play.
  useEffect(() => {
    if (activeStageId && stages.some((s) => s.id === activeStageId)) return
    const current = stages.find((s) => state.stages[s.id]?.status === 'in-progress') ?? stages[0]
    if (current) setActiveStage(current.id)
  }, [tournament.id, activeStageId, stages, state, setActiveStage])

  const loadPreset = (id: string) => {
    const preset = presets.find((p) => p.id === id)
    if (!preset) return
    if (preset.tournament.id !== tournament.id && !window.confirm(`Load ${preset.name}? This clears your current results.`)) return
    loadTournament(preset.tournament)
    const first = playOrder(preset.tournament.stages)[0]
    if (first) setActiveStage(first.id)
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>{tournament.name}</h1>
        <select value={presets.some((p) => p.id === tournament.id) ? tournament.id : ''} onChange={(e) => loadPreset(e.target.value)} aria-label="Preset">
          {!presets.some((p) => p.id === tournament.id) && <option value="">Custom</option>}
          {presets.map((p) => (
            <option key={p.id} value={p.id} title={p.description}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="Record edits as">
          {(['pick', 'actual'] as const).map((source) => (
            <button key={source} className={editSource === source ? 'is-active' : ''} onClick={() => setEditSource(source)}>
              {source === 'pick' ? 'Picks' : 'Actual results'}
            </button>
          ))}
        </div>
        <nav className="segmented" aria-label="View">
          {(['stages', 'odds', 'teams'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'is-active' : ''} onClick={() => setView(v)}>
              {v === 'stages' ? 'Bracket' : v === 'odds' ? 'Odds' : 'Teams'}
            </button>
          ))}
        </nav>
      </header>

      {view === 'stages' && (
        <>
          <SimulatorBar activeStageId={active?.id ?? null} />
          <nav className="tabs" aria-label="Stages">
            {stages.map((s) => {
              const status = state.stages[s.id]?.status ?? 'waiting'
              return (
                <button
                  key={s.id}
                  className={`tab${s.id === active?.id ? ' is-active' : ''}`}
                  onClick={() => setActiveStage(s.id)}
                >
                  {s.name}
                  <span className={`status status--${status}`}>{STATUS_LABEL[status]}</span>
                </button>
              )
            })}
          </nav>
          <main className="stage">{active && <StageView stage={active} computed={state.stages[active.id]} />}</main>
        </>
      )}
      {view === 'odds' && <OddsPanel />}
      {view === 'teams' && <TeamsPanel />}

      <MatchEditor stages={state.stages} />
    </div>
  )
}
