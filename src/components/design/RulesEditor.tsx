import { useState } from 'react'
import { cs2Rules, footballRules, genericRules, valorantRules } from '../../data/presets'
import { termsFor } from '../../engine'
import type { GameRules, GameScoring, Terms } from '../../types'
import { Check, Field, NumberInput } from './fields'

const RULE_SETS: Record<string, { label: string; rules: GameRules }> = {
  generic: { label: 'Generic (higher score wins)', rules: genericRules },
  football: { label: 'American football', rules: footballRules },
  cs2: { label: 'CS2', rules: cs2Rules },
  valorant: { label: 'Valorant', rules: valorantRules },
}

const TERM_FIELDS: { key: keyof Terms; label: string }[] = [
  { key: 'game', label: 'One game' },
  { key: 'games', label: 'Several games' },
  { key: 'point', label: 'One point' },
  { key: 'points', label: 'Several points' },
]

/** How games are scored and what the UI calls them. */
export function RulesEditor({ rules, onChange }: { rules: GameRules | undefined; onChange: (rules: GameRules) => void }) {
  const current: GameRules = rules ?? genericRules
  const scoring = current.scoring
  const defaults = termsFor(undefined)
  const terms = termsFor(current)

  const setScoring = (next: GameScoring) => onChange({ ...current, scoring: next })
  const setTerm = (key: keyof Terms, value: string) => {
    const next = { ...current.terms, [key]: value || undefined }
    onChange({ ...current, terms: Object.values(next).some(Boolean) ? next : undefined })
  }

  return (
    <div className="rules">
      <div className="row">
        <select
          value=""
          aria-label="Load a rule set"
          onChange={(e) => {
            const set = RULE_SETS[e.target.value]
            if (set) onChange(structuredClone(set.rules))
          }}
        >
          <option value="" disabled>
            Load a rule set…
          </option>
          {Object.entries(RULE_SETS).map(([id, set]) => (
            <option key={id} value={id}>
              {set.label}
            </option>
          ))}
        </select>
      </div>

      <div className="fields">
        <Field label="Scoring">
          <div className="segmented" role="group" aria-label="Scoring">
            <button className={scoring.kind === 'free' ? 'is-active' : ''} onClick={() => scoring.kind !== 'free' && setScoring({ kind: 'free' })}>
              Higher score wins
            </button>
            <button
              className={scoring.kind === 'first-to' ? 'is-active' : ''}
              onClick={() => scoring.kind !== 'first-to' && setScoring({ kind: 'first-to', target: 13 })}
            >
              First to N
            </button>
          </div>
        </Field>

        {scoring.kind === 'free' ? (
          <>
            <Field label={`Typical ${terms.points.toLowerCase()} per team`} hint="Used to simulate scores. Blank: winners only.">
              <NumberInput
                optional
                value={scoring.typical?.mean}
                label="Typical score"
                onChange={(mean) =>
                  setScoring({ kind: 'free', typical: mean === undefined ? undefined : { mean, spread: scoring.typical?.spread ?? Math.round(mean / 3) } })
                }
              />
            </Field>
            {scoring.typical && (
              <Field label="Spread" hint="How much scores vary.">
                <NumberInput
                  value={scoring.typical.spread}
                  label="Score spread"
                  onChange={(spread) => setScoring({ kind: 'free', typical: { mean: scoring.typical!.mean, spread: spread ?? 0 } })}
                />
              </Field>
            )}
          </>
        ) : (
          <>
            <Field label={`${terms.points} to win a ${terms.game.toLowerCase()}`}>
              <NumberInput min={1} value={scoring.target} label="Points to win" onChange={(target) => setScoring({ ...scoring, target: target ?? 1 })} />
            </Field>
            <Field label="Overtime" hint={`Starts at ${scoring.target - 1}–${scoring.target - 1}. First to N in each overtime; 2 means win by two.`}>
              <div className="row">
                <Check
                  label="Overtime"
                  checked={!!scoring.overtime}
                  onChange={(on) => setScoring({ ...scoring, overtime: on ? { firstTo: 4 } : undefined })}
                />
                {scoring.overtime && (
                  <NumberInput
                    min={2}
                    value={scoring.overtime.firstTo}
                    label="Overtime first to"
                    onChange={(firstTo) => setScoring({ ...scoring, overtime: { firstTo: firstTo ?? 2 } })}
                  />
                )}
              </div>
            </Field>
          </>
        )}
      </div>

      <div className="fields">
        {TERM_FIELDS.map(({ key, label }) => (
          <Field key={key} label={label}>
            <input value={current.terms?.[key] ?? ''} placeholder={defaults[key]} onChange={(e) => setTerm(key, e.target.value)} aria-label={label} />
          </Field>
        ))}
      </div>

      <Field
        label="Ratings predict"
        hint={`What a rating gap means in the simulator. CS2's VRS points predict a best-of-3; the simulator then works out the chance of winning each ${terms.game.toLowerCase()}.`}
      >
        <div className="segmented" role="group" aria-label="Ratings predict">
          <button
            className={current.ratingBasis !== 'series' ? 'is-active' : ''}
            onClick={() => onChange({ ...current, ratingBasis: undefined })}
          >
            One {terms.game.toLowerCase()}
          </button>
          <button className={current.ratingBasis === 'series' ? 'is-active' : ''} onClick={() => onChange({ ...current, ratingBasis: 'series' })}>
            A best-of-3
          </button>
        </div>
      </Field>

      <Field
        label="Upset floor (%)"
        hint="The least chance an underdog has, however big the rating gap. 10% matches how often big VRS underdogs actually win."
      >
        <NumberInput
          optional
          min={0}
          value={current.upsetFloor ? Math.round(current.upsetFloor * 100) : undefined}
          placeholder="0"
          label="Upset floor (%)"
          onChange={(n) => onChange({ ...current, upsetFloor: n ? Math.min(50, n) / 100 : undefined })}
        />
      </Field>

      <Field label={`${terms.game} names (optional)`} hint={`One per line, e.g. a map pool. Offered when entering each ${terms.game.toLowerCase()}.`}>
        <GamePool
          key={(current.gamePool ?? []).join('\n')}
          pool={current.gamePool ?? []}
          onChange={(pool) => onChange({ ...current, gamePool: pool.length ? pool : undefined })}
        />
      </Field>
    </div>
  )
}

/** Edited as free text; cleaned up (trimmed, no blanks or repeats) when focus leaves. */
function GamePool({ pool, onChange }: { pool: string[]; onChange: (pool: string[]) => void }) {
  const [text, setText] = useState(pool.join('\n'))
  return (
    <textarea
      rows={3}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange([...new Set(text.split('\n').map((line) => line.trim()).filter(Boolean))])}
      aria-label="Game names"
    />
  )
}
