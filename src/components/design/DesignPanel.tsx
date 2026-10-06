import { useMemo, useState } from 'react'
import { addStage, duplicatePhase, hasResults, phasesOf, validateTournament } from '../../engine'
import { useTournamentStore } from '../../store/tournament'
import type { StageId } from '../../types'
import { Field, NumberInput } from './fields'
import { LibraryPanel } from './LibraryPanel'
import { RulesEditor } from './RulesEditor'
import { StageCard } from './StageCard'

/** Edit the open tournament's name, rules and stages, and manage saved tournaments. */
export function DesignPanel() {
  const tournament = useTournamentStore((s) => s.tournament)
  const actual = useTournamentStore((s) => s.actual)
  const picks = useTournamentStore((s) => s.picks)
  const update = useTournamentStore((s) => s.updateTournament)
  const [open, setOpen] = useState<Set<StageId>>(new Set())
  const issues = useMemo(() => validateTournament(tournament), [tournament])
  const general = issues.filter((i) => !i.stageId)
  const anyResults = hasResults(actual) || hasResults(picks)

  const toggle = (id: StageId) =>
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const add = () => {
    const { tournament: next, stageId } = addStage(tournament)
    update(() => next)
    setOpen((cur) => new Set(cur).add(stageId))
  }

  return (
    <div className="design">
      <LibraryPanel />

      <section className="panel">
        <header className="panel__header">
          <h2>Tournament</h2>
          {issues.length === 0 ? (
            <span className="status status--complete">Ready to play</span>
          ) : (
            <span className="status status--invalid">{issues.length === 1 ? '1 problem' : `${issues.length} problems`}</span>
          )}
        </header>
        <div className="fields">
          <Field label="Name">
            <input value={tournament.name} onChange={(e) => update((t) => ({ ...t, name: e.target.value }))} aria-label="Tournament name" />
          </Field>
          <Field label="Random seed" hint="Drives random draws, pairings and tiebreakers.">
            <div className="row">
              <NumberInput
                value={tournament.randomSeed ?? 0}
                label="Random seed"
                onChange={(randomSeed) => update((t) => ({ ...t, randomSeed: randomSeed ?? 0 }))}
              />
              <button className="button button--ghost" onClick={() => update((t) => ({ ...t, randomSeed: Math.floor(Math.random() * 1e6) }))}>
                Reshuffle
              </button>
            </div>
          </Field>
        </div>
        {anyResults && (
          <p className="hint">
            This tournament has picks or results. They're kept as you edit, but any that no longer fit the new design are ignored.
          </p>
        )}
      </section>

      <section className="panel">
        <header className="panel__header">
          <h2>Game rules</h2>
        </header>
        {general.length > 0 && (
          <ul className="issues">
            {general.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        )}
        <RulesEditor rules={tournament.rules} onChange={(rules) => update((t) => ({ ...t, rules }))} />
      </section>

      <section className="panel">
        <header className="panel__header">
          <h2>Stages</h2>
          <div className="row">
            <button className="button button--ghost" onClick={() => setOpen(new Set(tournament.stages.map((s) => s.id)))}>
              Expand all
            </button>
            <button className="button button--ghost" onClick={() => setOpen(new Set())}>
              Collapse all
            </button>
          </div>
        </header>
        <p className="hint">
          Phases play in order, and stages in the same phase run side by side. A stage's entrants are invited teams or
          places from stages in earlier phases.
        </p>
        {phasesOf(tournament.stages).map((phase) => (
          <div key={phase} className="phase">
            <div className="phase__header">
              <h3 className="phase__title">Phase {phase + 1}</h3>
              <button
                className="button button--ghost"
                onClick={() => update((t) => duplicatePhase(t, phase).tournament)}
                title="Copy every stage in this phase into a new phase right after it"
              >
                Duplicate phase
              </button>
            </div>
            {tournament.stages
              .filter((s) => s.phase === phase)
              .map((stage) => (
                <StageCard
                  key={stage.id}
                  tournament={tournament}
                  stage={stage}
                  issues={issues.filter((i) => i.stageId === stage.id)}
                  open={open.has(stage.id)}
                  onToggle={() => toggle(stage.id)}
                  update={update}
                />
              ))}
          </div>
        ))}
        <button className="button" onClick={add}>
          + Add stage
        </button>
      </section>
    </div>
  )
}
