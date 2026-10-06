import { useMemo, useState } from 'react'
import {
  bracketSummary,
  DEFAULT_RATING_K,
  defaultConfig,
  describeConfig,
  describeEntrants,
  duplicateStage,
  eliminationRounds,
  FORMAT_LABEL,
  formatRanges,
  moveStage,
  moveStageToPhase,
  phasesOf,
  placementUses,
  previewStage,
  removeStage,
  setFromFinal,
  updateStage,
  type RoundInfo,
  type TournamentIssue,
} from '../../engine'
import type {
  DoubleElimConfig,
  DoubleElimFinals,
  EliminationSeeding,
  SeedOrder,
  SingleElimConfig,
  Stage,
  StageConfig,
  StageFormat,
  SwissConfig,
  SwissFirstRoundPairing,
  SwissPairing,
  SwissTiebreaker,
  Tournament,
} from '../../types'
import { PreviewContext } from '../common/preview'
import { StageView } from '../common/StageView'
import { EntrantsEditor } from './EntrantsEditor'
import { BestOfInput, Check, Field, NumberInput, Select } from './fields'

const SEEDING: Record<EliminationSeeding, string> = {
  standard: 'Standard (1 v lowest)',
  'as-listed': 'As listed (1 v 2, 3 v 4)',
  random: 'Random draw',
}

const SEED_ORDER: Record<SeedOrder, string> = {
  entrants: 'Entrant order',
  'live-rating': 'Live rating (Elo)',
}

const SEED_ORDER_HINT: Record<SeedOrder, string> = {
  entrants: 'Seed 1 is the first entrant.',
  'live-rating': 'Highest live rating is seed 1. Swiss qualifiers use their final live rating; others use their team rating.',
}

const FINALS: Record<DoubleElimFinals, string> = {
  'grand-final': 'Grand final',
  'upper-final-decides': 'Upper final decides 1st and 2nd',
  'no-grand-final': 'No grand final',
}

const FINALS_HINT: Record<DoubleElimFinals, string> = {
  'grand-final': 'The upper final loser drops to the lower final; the upper and lower winners meet in a grand final.',
  'upper-final-decides': "The upper final loser takes 2nd and doesn't drop. The lower final decides 3rd.",
  'no-grand-final': 'The upper final loser drops to the lower final. Upper winner 1st, lower winner 2nd.',
}

const FIRST_ROUND: Record<SwissFirstRoundPairing, string> = {
  'high-low': 'High v low half (1 v 9)',
  fold: 'Fold (1 v 16)',
  adjacent: 'Adjacent (1 v 2)',
  random: 'Random draw',
}

const PAIRING: Record<SwissPairing, string> = {
  buchholz: 'Buchholz (strength of schedule)',
  rating: 'Live rating (Elo)',
  seed: 'Seed',
  random: 'Random',
}

const TIEBREAKER: Record<SwissTiebreaker, string> = {
  buchholz: 'Buchholz',
  rating: 'Live rating',
  seed: 'Seed',
  'head-to-head': 'Head-to-head',
  random: 'Random',
}

interface Props {
  tournament: Tournament
  stage: Stage
  issues: TournamentIssue[]
  open: boolean
  onToggle: () => void
  update: (fn: (t: Tournament) => Tournament) => void
}

export function StageCard({ tournament, stage, issues, open, onToggle, update }: Props) {
  const [showPreview, setShowPreview] = useState(false)
  const phases = phasesOf(tournament.stages)
  const setStage = (fn: (s: Stage) => Stage) => update((t) => updateStage(t, stage.id, fn))
  const setConfig = <C extends StageConfig>(patch: Partial<C>) => setStage((s) => ({ ...s, config: { ...s.config, ...patch } as StageConfig }))
  const index = tournament.stages.findIndex((s) => s.id === stage.id)
  const samePhase = tournament.stages.filter((s) => s.phase === stage.phase)

  const remove = () => {
    const dependents = tournament.stages.filter((s) => s.entrants.some((e) => e.kind === 'placement' && e.stageId === stage.id))
    const extra = dependents.length ? ` ${dependents.map((s) => s.name).join(', ')} will lose the places they take from it.` : ''
    if (window.confirm(`Delete ${stage.name}?${extra}`)) update((t) => removeStage(t, stage.id))
  }

  return (
    <article className={`stage-card${issues.length ? ' stage-card--invalid' : ''}`}>
      <header className="stage-card__header">
        <button className="stage-card__toggle" onClick={onToggle} aria-expanded={open}>
          <span className="stage-card__chevron">{open ? '▾' : '▸'}</span>
          <span className="stage-card__title">{stage.name || 'Untitled stage'}</span>
          <span className="stage-card__format">{FORMAT_LABEL[stage.config.format]}</span>
          <span className="muted">
            {stage.entrants.length} teams · {describeConfig(stage.config)}
          </span>
          {issues.length > 0 && <span className="status status--invalid">{issues.length === 1 ? '1 problem' : `${issues.length} problems`}</span>}
        </button>
        <span className="stage-card__actions">
          {samePhase.length > 1 && (
            <>
              <button className="icon-button" onClick={() => update((t) => moveStage(t, stage.id, -1))} disabled={tournament.stages[index - 1]?.phase !== stage.phase} aria-label="Move left" title="Show earlier">
                ↑
              </button>
              <button className="icon-button" onClick={() => update((t) => moveStage(t, stage.id, 1))} disabled={tournament.stages[index + 1]?.phase !== stage.phase} aria-label="Move right" title="Show later">
                ↓
              </button>
            </>
          )}
          <button
            className="icon-button"
            onClick={() => update((t) => duplicateStage(t, stage.id).tournament)}
            aria-label={`Duplicate ${stage.name}`}
            title="Duplicate stage (same phase; entrants take the next free places or new placeholder teams)"
          >
            ⧉
          </button>
          <button className="icon-button" onClick={remove} aria-label={`Delete ${stage.name}`} title="Delete stage">
            ✕
          </button>
        </span>
      </header>
      {!open && <p className="stage-card__summary hint">{describeEntrants(tournament, stage)}</p>}

      {open && (
        <div className="stage-card__body">
          {issues.length > 0 && (
            <ul className="issues">
              {issues.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
          )}
          <div className="fields">
            <Field label="Name">
              <input value={stage.name} onChange={(e) => setStage((s) => ({ ...s, name: e.target.value }))} aria-label="Stage name" />
            </Field>
            <Field label="Format">
              <Select<StageFormat>
                value={stage.config.format}
                options={FORMAT_LABEL}
                label="Format"
                onChange={(format) => format !== stage.config.format && setStage((s) => ({ ...s, config: defaultConfig(format, s.config) }))}
              />
            </Field>
            <Field label="Phase" hint="Stages in the same phase run side by side.">
              <select
                value={stage.phase}
                onChange={(e) => update((t) => moveStageToPhase(t, stage.id, Number(e.target.value)))}
                aria-label="Phase"
              >
                {phases.map((p) => (
                  <option key={p} value={p}>
                    Phase {p + 1}
                  </option>
                ))}
                <option value={phases.length}>New phase at the end</option>
              </select>
            </Field>
          </div>

          <h3 className="stage-card__section">Format settings</h3>
          {stage.config.format === 'swiss' && <SwissSettings config={stage.config} setConfig={setConfig} />}
          {stage.config.format === 'single-elim' && <SingleElimSettings stage={stage} config={stage.config} setConfig={setConfig} />}
          {stage.config.format === 'double-elim' && <DoubleElimSettings stage={stage} config={stage.config} setConfig={setConfig} />}

          <h3 className="stage-card__section">
            Entrants <span className="muted">· {describeEntrants(tournament, stage)}</span>
          </h3>
          <EntrantsEditor tournament={tournament} stage={stage} update={update} />
          <PlacesSummary tournament={tournament} stage={stage} />

          <div className="row stage-card__preview-toggle">
            <button className="button" onClick={() => setShowPreview(!showPreview)}>
              {showPreview ? 'Hide preview' : 'Show preview'}
            </button>
          </div>
          {showPreview && <StagePreview tournament={tournament} stage={stage} />}
        </div>
      )}
    </article>
  )
}

function SwissSettings({ config, setConfig }: { config: SwissConfig; setConfig: (patch: Partial<SwissConfig>) => void }) {
  const unused = (Object.keys(TIEBREAKER) as SwissTiebreaker[]).filter((t) => !config.tiebreakers.includes(t))
  const moveTiebreaker = (i: number, by: -1 | 1) => {
    const next = [...config.tiebreakers]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    setConfig({ tiebreakers: next })
  }
  const rounds = config.winsToAdvance + config.lossesToEliminate - 1
  return (
    <>
      <div className="fields">
        <Field label="Wins to advance">
          <NumberInput min={1} value={config.winsToAdvance} label="Wins to advance" onChange={(n) => setConfig({ winsToAdvance: n ?? 1 })} />
        </Field>
        <Field label="Losses to eliminate" hint={`Up to ${rounds} ${rounds === 1 ? 'round' : 'rounds'}.`}>
          <NumberInput min={1} value={config.lossesToEliminate} label="Losses to eliminate" onChange={(n) => setConfig({ lossesToEliminate: n ?? 1 })} />
        </Field>
        <Field label="Best of">
          <BestOfInput value={config.bestOf} label="Best of" onChange={(n) => setConfig({ bestOf: n ?? 1 })} />
        </Field>
        <Field label="Best of to advance" hint="When a win would advance a team.">
          <BestOfInput optional value={config.advancementBestOf} placeholder={`${config.bestOf}`} label="Best of to advance" onChange={(n) => setConfig({ advancementBestOf: n })} />
        </Field>
        <Field label="Best of to eliminate" hint="When a loss would eliminate a team.">
          <BestOfInput optional value={config.eliminationBestOf} placeholder={`${config.bestOf}`} label="Best of to eliminate" onChange={(n) => setConfig({ eliminationBestOf: n })} />
        </Field>
      </div>
      <div className="fields">
        <Field label="First round">
          <Select value={config.firstRoundPairing} options={FIRST_ROUND} label="First round pairing" onChange={(firstRoundPairing) => setConfig({ firstRoundPairing })} />
        </Field>
        <Field label="Later rounds" hint="Teams with the same record are paired by this.">
          <Select value={config.pairing} options={PAIRING} label="Later round pairing" onChange={(pairing) => setConfig({ pairing })} />
        </Field>
        <Field label="Rematches">
          <Check label="Avoid rematches" checked={config.avoidRematches} onChange={(avoidRematches) => setConfig({ avoidRematches })} />
        </Field>
        {(config.pairing === 'rating' || config.tiebreakers.includes('rating')) && (
          <>
            <Field
              label="Start live ratings from"
              hint={
                config.ratingStart === 'seed'
                  ? 'Seed order, as ESL Pro League does. Team ratings (e.g. from VRS) still drive the simulator.'
                  : 'Team ratings from the Teams tab, or seed order if no team has one.'
              }
            >
              <div className="segmented" role="group" aria-label="Start live ratings from">
                <button className={config.ratingStart !== 'seed' ? 'is-active' : ''} onClick={() => setConfig({ ratingStart: undefined })}>
                  Team ratings
                </button>
                <button className={config.ratingStart === 'seed' ? 'is-active' : ''} onClick={() => setConfig({ ratingStart: 'seed' })}>
                  Seed order
                </button>
              </div>
            </Field>
            <Field label="Rating K-factor" hint="Most a live rating can move in one match.">
              <NumberInput optional min={1} value={config.ratingK} placeholder={`${DEFAULT_RATING_K}`} label="Rating K-factor" onChange={(ratingK) => setConfig({ ratingK })} />
            </Field>
          </>
        )}
      </div>
      <Field label="Tiebreakers" hint="Rank teams with the same record, in this order.">
        <div className="row">
          {config.tiebreakers.map((t, i) => (
            <span key={t} className="tiebreaker">
              {i + 1}. {TIEBREAKER[t]}
              <button className="icon-button" disabled={i === 0} onClick={() => moveTiebreaker(i, -1)} aria-label={`Move ${TIEBREAKER[t]} earlier`}>
                ←
              </button>
              <button className="icon-button" disabled={i === config.tiebreakers.length - 1} onClick={() => moveTiebreaker(i, 1)} aria-label={`Move ${TIEBREAKER[t]} later`}>
                →
              </button>
              <button className="icon-button" onClick={() => setConfig({ tiebreakers: config.tiebreakers.filter((x) => x !== t) })} aria-label={`Remove ${TIEBREAKER[t]}`}>
                ✕
              </button>
            </span>
          ))}
          {unused.length > 0 && (
            <select value="" onChange={(e) => setConfig({ tiebreakers: [...config.tiebreakers, e.target.value as SwissTiebreaker] })} aria-label="Add tiebreaker">
              <option value="" disabled>
                + Add
              </option>
              {unused.map((t) => (
                <option key={t} value={t}>
                  {TIEBREAKER[t]}
                </option>
              ))}
            </select>
          )}
        </div>
      </Field>
    </>
  )
}

function SingleElimSettings({ stage, config, setConfig }: { stage: Stage; config: SingleElimConfig; setConfig: (patch: Partial<SingleElimConfig>) => void }) {
  return (
    <>
      <div className="fields">
        <Field label="Best of" hint="Default for every round.">
          <BestOfInput value={config.bestOf} label="Best of" onChange={(n) => setConfig({ bestOf: n ?? 1 })} />
        </Field>
        <Field label="Seeding" hint={bracketSummary(stage.entrants.length)}>
          <Select value={config.seeding} options={SEEDING} label="Seeding" onChange={(seeding) => setConfig({ seeding })} />
        </Field>
        <Field label="Seed order" hint={SEED_ORDER_HINT[config.seedOrder ?? 'entrants']}>
          <Select
            value={config.seedOrder ?? 'entrants'}
            options={SEED_ORDER}
            label="Seed order"
            onChange={(next) => setConfig({ seedOrder: next === 'entrants' ? undefined : next })}
          />
        </Field>
        <Field label="Options">
          <Check label="Reseed every round" checked={!!config.reseed} onChange={(reseed) => setConfig({ reseed: reseed || undefined })} />
          <Check label="3rd place match" checked={config.thirdPlaceMatch} onChange={(thirdPlaceMatch) => setConfig({ thirdPlaceMatch })} />
        </Field>
      </div>
      <RoundTable
        rounds={eliminationRounds(stage)}
        fallbackBestOf={config.bestOf}
        names={config.roundNamesFromFinal}
        bestOfs={config.bestOfFromFinal}
        onNames={(roundNamesFromFinal) => setConfig({ roundNamesFromFinal })}
        onBestOfs={(bestOfFromFinal) => setConfig({ bestOfFromFinal })}
      />
    </>
  )
}

function DoubleElimSettings({ stage, config, setConfig }: { stage: Stage; config: DoubleElimConfig; setConfig: (patch: Partial<DoubleElimConfig>) => void }) {
  const rounds = eliminationRounds(stage)
  const finals = config.finals ?? 'grand-final'
  return (
    <>
      <div className="fields">
        <Field label="Best of" hint="Default for every round.">
          <BestOfInput value={config.bestOf} label="Best of" onChange={(n) => setConfig({ bestOf: n ?? 1 })} />
        </Field>
        <Field label="Seeding" hint={bracketSummary(stage.entrants.length)}>
          <Select value={config.seeding} options={SEEDING} label="Seeding" onChange={(seeding) => setConfig({ seeding })} />
        </Field>
        <Field label="Seed order" hint={SEED_ORDER_HINT[config.seedOrder ?? 'entrants']}>
          <Select
            value={config.seedOrder ?? 'entrants'}
            options={SEED_ORDER}
            label="Seed order"
            onChange={(next) => setConfig({ seedOrder: next === 'entrants' ? undefined : next })}
          />
        </Field>
        <Field label="Finals" hint={FINALS_HINT[finals]}>
          <Select
            value={finals}
            options={FINALS}
            label="Finals"
            onChange={(next) => setConfig({ finals: next === 'grand-final' ? undefined : next })}
          />
        </Field>
        {finals === 'grand-final' && (
          <>
            <Field label="Grand final best of">
              <BestOfInput optional value={config.grandFinalBestOf} placeholder={`${config.bestOf}`} label="Grand final best of" onChange={(grandFinalBestOf) => setConfig({ grandFinalBestOf })} />
            </Field>
            <Field label="Options">
              <Check label="Grand final reset" checked={config.grandFinalReset} onChange={(grandFinalReset) => setConfig({ grandFinalReset })} />
            </Field>
          </>
        )}
      </div>
      <RoundTable
        title="Upper bracket"
        rounds={rounds.filter((r) => r.side === 'upper')}
        fallbackBestOf={config.bestOf}
        names={config.upperRoundNamesFromFinal}
        bestOfs={config.upperBestOfFromFinal}
        onNames={(upperRoundNamesFromFinal) => setConfig({ upperRoundNamesFromFinal })}
        onBestOfs={(upperBestOfFromFinal) => setConfig({ upperBestOfFromFinal })}
      />
      <RoundTable
        title="Lower bracket"
        rounds={rounds.filter((r) => r.side === 'lower')}
        fallbackBestOf={config.bestOf}
        names={config.lowerRoundNamesFromFinal}
        bestOfs={config.lowerBestOfFromFinal}
        onNames={(lowerRoundNamesFromFinal) => setConfig({ lowerRoundNamesFromFinal })}
        onBestOfs={(lowerBestOfFromFinal) => setConfig({ lowerBestOfFromFinal })}
      />
    </>
  )
}

/** Per-round names and best-ofs, stored counted back from the final. */
function RoundTable({
  title,
  rounds,
  fallbackBestOf,
  names,
  bestOfs,
  onNames,
  onBestOfs,
}: {
  title?: string
  rounds: RoundInfo[]
  fallbackBestOf: number
  names: string[] | undefined
  bestOfs: number[] | undefined
  onNames: (names: string[] | undefined) => void
  onBestOfs: (bestOfs: number[] | undefined) => void
}) {
  if (rounds.length === 0) return <p className="hint">Add entrants to name rounds and set their best-of.</p>
  return (
    <div className="round-table">
      {title && <h4>{title}</h4>}
      <table>
        <thead>
          <tr>
            <th>Round</th>
            <th>Best of</th>
          </tr>
        </thead>
        <tbody>
          {rounds.map((round) => (
            <tr key={round.fromFinal}>
              <td>
                <input
                  value={names?.[round.fromFinal] ?? ''}
                  placeholder={round.defaultName}
                  aria-label={`${round.defaultName} name`}
                  onChange={(e) => onNames(setFromFinal(names, round.fromFinal, e.target.value || undefined))}
                />
              </td>
              <td>
                <BestOfInput
                  optional
                  value={bestOfs?.[round.fromFinal] ?? undefined}
                  placeholder={`${fallbackBestOf}`}
                  label={`${round.defaultName} best of`}
                  onChange={(n) => onBestOfs(setFromFinal(bestOfs, round.fromFinal, n))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Where this stage's places go: "1–8 → Stage 2 · 9–16 eliminated". */
function PlacesSummary({ tournament, stage }: { tournament: Tournament; stage: Stage }) {
  const uses = placementUses(tournament, stage.id)
  if (uses.size === 0) return null
  const byStage = new Map<string, number[]>()
  for (const [place, id] of uses) byStage.set(id, [...(byStage.get(id) ?? []), place])
  const unused = Array.from({ length: stage.entrants.length }, (_, i) => i + 1).filter((p) => !uses.has(p))
  const name = (id: string) => tournament.stages.find((s) => s.id === id)?.name ?? id
  return (
    <p className="hint">
      Places from this stage:{' '}
      {[...byStage].map(([id, places]) => `${formatRanges(places)} → ${name(id)}`).join(' · ')}
      {unused.length > 0 && ` · ${formatRanges(unused)} finish here`}
    </p>
  )
}

/** The stage as it would start, with placeholders for teams that qualify from earlier stages. */
function StagePreview({ tournament, stage }: { tournament: Tournament; stage: Stage }) {
  const preview = useMemo(() => previewStage(tournament, stage.id), [tournament, stage.id])
  if (!preview) return null
  return (
    <div className="stage-preview">
      <p className="hint">Preview with no results. Teams from earlier stages are shown by the place they qualify from.</p>
      <PreviewContext.Provider value={preview.teams}>
        <div className="stage">
          <StageView stage={preview.stage} computed={preview.computed} />
        </div>
      </PreviewContext.Provider>
    </div>
  )
}
