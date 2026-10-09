import { useEffect } from 'react'
import { MatchEditor } from './components/common/MatchEditor'
import { StageView } from './components/common/StageView'
import { TeamsPanel } from './components/common/TeamsPanel'
import { PickemPanel } from './components/pickem/PickemPanel'
import { OddsPanel } from './components/simulator/OddsPanel'
import { SimulatorBar } from './components/simulator/SimulatorBar'
import { DesignPanel } from './components/design/DesignPanel'
import { playOrder } from './engine'
import { useTournamentState, useTournamentStore } from './store/tournament'
import { useUiStore, type View } from './store/ui'

const STATUS_LABEL = { waiting: 'Waiting', 'in-progress': 'In progress', complete: 'Done', invalid: 'Invalid' }
const VIEW_LABEL: Record<View, string> = { stages: 'Bracket', odds: 'Odds', pickem: "Pick'em", teams: 'Teams', design: 'Design' }

export default function App() {
  const tournament = useTournamentStore((s) => s.tournament)
  const library = useTournamentStore((s) => s.library)
  const openTournament = useTournamentStore((s) => s.openTournament)
  const editSource = useTournamentStore((s) => s.editSource)
  const setEditSource = useTournamentStore((s) => s.setEditSource)
  const state = useTournamentState()
  const { view, setView, activeStageId, setActiveStage, closeEditor } = useUiStore()

  const stages = playOrder(tournament.stages)
  const active = stages.find((s) => s.id === activeStageId) ?? stages[0]

  // Follow the action: open on the first stage that still has matches to play.
  useEffect(() => {
    if (activeStageId && stages.some((s) => s.id === activeStageId)) return
    const current = stages.find((s) => state.stages[s.id]?.status === 'in-progress') ?? stages[0]
    if (current) setActiveStage(current.id)
  }, [tournament.id, activeStageId, stages, state, setActiveStage])

  const others = Object.values(library)
    .map((e) => e.tournament)
    .sort((a, b) => a.name.localeCompare(b.name))

  const switchTo = (id: string) => {
    if (id === '__manage') return setView('design')
    closeEditor()
    openTournament(id)
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>{tournament.name}</h1>
        <select value={tournament.id} onChange={(e) => switchTo(e.target.value)} aria-label="Tournament">
          <option value={tournament.id}>{tournament.name}</option>
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value="__manage">New or manage…</option>
        </select>
        <div className="segmented" role="group" aria-label="Show and edit">
          {(['pick', 'actual'] as const).map((source) => (
            <button
              key={source}
              className={editSource === source ? 'is-active' : ''}
              onClick={() => setEditSource(source)}
              title={source === 'pick' ? 'Your picks, with actual results on top' : 'Actual results only'}
            >
              {source === 'pick' ? 'Picks' : 'Actual results'}
            </button>
          ))}
        </div>
        <nav className="segmented" aria-label="View">
          {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
            <button key={v} className={view === v ? 'is-active' : ''} onClick={() => setView(v)}>
              {VIEW_LABEL[v]}
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
          <main className="stage">
            {active ? (
              <StageView stage={active} computed={state.stages[active.id]} />
            ) : (
              <p className="hint">This tournament has no stages yet. Add some in the Design tab.</p>
            )}
          </main>
        </>
      )}
      {view === 'odds' && <OddsPanel />}
      {view === 'pickem' && <PickemPanel />}
      {view === 'teams' && <TeamsPanel />}
      {/* Keyed so expanded stage cards reset when another tournament opens. */}
      {view === 'design' && <DesignPanel key={tournament.id} />}

      <MatchEditor stages={state.stages} />
    </div>
  )
}
