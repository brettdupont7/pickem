import { useMemo, useState } from 'react'
import { addBlankTeam, addTeams, formRatings, removeTeam, removeTeams, renameTeams, teamEntries, termsFor } from '../../engine'
import { useTournamentState, useTournamentStore } from '../../store/tournament'
import type { ComputedStage } from '../../engine'
import type { Stage, StageId, SwissConfig, Team, TeamId } from '../../types'
import { PasteTeams } from './PasteTeams'
import { TeamBadge } from './TeamBadge'
import { formatAsOf, VrsPanel } from './VrsPanel'

type SortKey = 'name' | 'rating' | 'form' | 'live'

interface Sort {
  key: SortKey
  desc: boolean
}

const SORT_LABEL: Record<SortKey, string> = { name: 'Name', rating: 'Rating', form: 'Form', live: 'Pairing' }

/** Whether the Pairing column is shown; a per-browser preference, so storage may be unavailable. */
const SHOW_PAIRING_KEY = 'pickem-show-pairing'
const readShowPairing = () => {
  try {
    return localStorage.getItem(SHOW_PAIRING_KEY) === '1'
  } catch {
    return false
  }
}
const writeShowPairing = (show: boolean) => {
  try {
    localStorage.setItem(SHOW_PAIRING_KEY, show ? '1' : '0')
  } catch {
    // Not remembered; the column still toggles for this visit.
  }
}

export function TeamsPanel() {
  const tournament = useTournamentStore((s) => s.tournament)
  const update = useTournamentStore((s) => s.updateTournament)
  const [pasting, setPasting] = useState(false)
  const { teams } = tournament
  const entries = useMemo(() => teamEntries(tournament), [tournament])
  const stageName = (id: string) => tournament.stages.find((s) => s.id === id)?.name ?? id
  const state = useTournamentState()
  const actual = useTournamentStore((s) => s.actual)
  // Ratings after actual results, when the tournament's rules switch form on.
  const form = useMemo(() => (tournament.rules?.formK ? formRatings(tournament, actual) : null), [tournament, actual])
  const live = useMemo(() => liveRatings(tournament.stages, state.stages), [tournament.stages, state.stages])
  // Pairing ratings only decide Swiss matchups, so they're hidden unless asked for.
  const [showPairingPref, setShowPairingPref] = useState(readShowPairing)
  const showPairing = showPairingPref && live.size > 0
  const togglePairing = (show: boolean) => {
    setShowPairingPref(show)
    writeShowPairing(show)
    if (!show && sort?.key === 'live') setSort(null)
  }
  // The order is fixed when a header is clicked, so rows don't jump while a rating is being typed.
  const [sort, setSort] = useState<Sort | null>(null)
  const [order, setOrder] = useState<TeamId[]>([])

  const sortBy = (key: SortKey) => {
    // Name starts A-Z and ratings start highest first; a third click restores the original order.
    const firstDesc = key !== 'name'
    const next = sort?.key !== key ? { key, desc: firstDesc } : sort.desc === firstDesc ? { key, desc: !firstDesc } : null
    setSort(next)
    if (!next) return
    const value = (team: Team) =>
      key === 'name' ? team.name : key === 'rating' ? team.rating : key === 'form' ? form?.[team.id] : live.get(team.id)?.rating
    setOrder(
      Object.values(teams)
        .sort((a, b) => {
          const va = value(a)
          const vb = value(b)
          // Teams without a value always go last.
          if (va === undefined || vb === undefined) return Number(va === undefined) - Number(vb === undefined)
          const d = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
          return next.desc ? -d : d
        })
        .map((t) => t.id),
    )
  }

  const ids = Object.keys(teams)
  const rows = sort ? [...order.filter((id) => teams[id]), ...ids.filter((id) => !order.includes(id))] : ids

  // Ticked teams, for removing several at once; teams removed some other way drop out.
  const [checked, setChecked] = useState<Set<TeamId>>(() => new Set())
  const selected = ids.filter((id) => checked.has(id))
  const allSelected = ids.length > 0 && selected.length === ids.length
  const toggle = (id: TeamId, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  // What a rating gap means under this tournament's rules, for the hint.
  const rules = tournament.rules
  const ratingScale =
    `200 points ≈ 76% to win ${rules?.ratingBasis === 'series' ? 'a best-of-3' : `one ${termsFor(rules).game.toLowerCase()}`}` +
    (rules?.upsetFloor ? `, before the ${Math.round(rules.upsetFloor * 100)}% upset floor` : '')
  const sortable = ['Name', 'Rating', ...(form ? ['Form'] : []), ...(showPairing ? ['Pairing'] : [])]
  const sortableNames = `${sortable.slice(0, -1).join(', ')} or ${sortable.at(-1)}`

  const header = (key: SortKey) => (
    <th aria-sort={sort?.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button className="teams__sort" onClick={() => sortBy(key)} title={`Sort by ${SORT_LABEL[key].toLowerCase()}`}>
        {SORT_LABEL[key]}
        <span className="teams__sort-arrow">{sort?.key === key ? (sort.desc ? '▼' : '▲') : ''}</span>
      </button>
    </th>
  )

  const patch = (id: string, changes: Partial<Team>) =>
    update((t) => ({ ...t, teams: { ...t.teams, [id]: { ...t.teams[id], ...changes } } }))

  const remove = (team: Team) => {
    const stage = entries.get(team.id)
    if (stage && !window.confirm(`Remove ${team.name}? They'll also be taken out of ${stageName(stage)}.`)) return
    update((t) => removeTeam(t, team.id))
  }

  const removeSelected = () => {
    const entered = selected.filter((id) => entries.has(id)).length
    const what = selected.length === 1 ? teams[selected[0]].name : `${selected.length} teams`
    const also =
      entered === 0
        ? ''
        : selected.length === 1
          ? ` They'll also be taken out of ${stageName(entries.get(selected[0])!)}.`
          : ` ${entered < selected.length ? `${entered} of them` : selected.length === 2 ? 'Both' : 'All of them'} will also be taken out of the stages they're entered in.`
    if (!window.confirm(`Remove ${what}?${also}`)) return
    update((t) => removeTeams(t, selected))
    setChecked(new Set())
  }

  return (
    <div className="teams">
      <p className="hint">
        Short names and logos show in the Swiss grid (initials are used when blank). Ratings drive the simulator (Elo
        scale: {ratingScale}; set in Game rules); blank = 1500.
        {form ? ' With Form on, odds use each team’s Form rating instead.' : ''} Click {sortableNames} to sort. Enter
        teams into stages in the Design tab.
      </p>
      <VrsPanel />
      <div className="row teams__actions">
        <button className="button" onClick={() => update((t) => addBlankTeam(t).tournament)}>
          + Add team
        </button>
        <button className="button" onClick={() => setPasting(!pasting)}>
          Paste team names…
        </button>
        {selected.length > 0 && (
          <>
            <button className="button" onClick={removeSelected}>
              Remove selected ({selected.length})
            </button>
            <button className="button" onClick={() => setChecked(new Set())}>
              Clear selection
            </button>
          </>
        )}
        {live.size > 0 && (
          <label className="check" title="Ratings a Swiss stage uses to decide who plays whom (an Elo-style stand-in for ESL's live ratings), not team strength">
            <input type="checkbox" checked={showPairing} onChange={(e) => togglePairing(e.target.checked)} />
            Show pairing ratings
          </label>
        )}
      </div>
      {pasting && (
        <PasteTeams
          onClose={() => setPasting(false)}
          hint="Rename replaces the current names from the top of the list down. It's the quickest way to fill in a preset's placeholder teams."
          actions={[
            { label: 'Rename teams in order', run: (names) => update((t) => renameTeams(t, names)) },
            { label: 'Add as new teams', run: (names) => update((t) => addTeams(t, names).tournament) },
          ]}
        />
      )}
      <div className="table-wrap">
        <table className="teams__table">
          <thead>
            <tr>
              <th className="teams__select">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.length > 0 && !allSelected
                  }}
                  onChange={(e) => setChecked(e.target.checked ? new Set(ids) : new Set())}
                  disabled={ids.length === 0}
                  aria-label="Select all teams"
                  title={allSelected ? 'Deselect all' : 'Select all'}
                />
              </th>
              <th />
              {header('name')}
              <th>Short name</th>
              <th>Logo URL</th>
              {header('rating')}
              {form && header('form')}
              {showPairing && header('live')}
              <th>Source</th>
              <th>Enters in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((id) => teams[id]).map((team) => (
              <tr key={team.id} className={checked.has(team.id) ? 'is-selected' : undefined}>
                <td className="teams__select">
                  <input
                    type="checkbox"
                    checked={checked.has(team.id)}
                    onChange={(e) => toggle(team.id, e.target.checked)}
                    aria-label={`Select ${team.name}`}
                  />
                </td>
                <td>
                  <TeamBadge team={team} />
                </td>
                <td>
                  <input value={team.name} onChange={(e) => patch(team.id, { name: e.target.value })} aria-label="Team name" />
                </td>
                <td>
                  <input
                    className="teams__short"
                    value={team.shortName ?? ''}
                    maxLength={4}
                    placeholder="Auto"
                    aria-label={`${team.name} short name`}
                    onChange={(e) => patch(team.id, { shortName: e.target.value || undefined })}
                  />
                </td>
                <td>
                  <input
                    type="url"
                    value={team.logoUrl ?? ''}
                    placeholder="https://…"
                    aria-label={`${team.name} logo URL`}
                    onChange={(e) => patch(team.id, { logoUrl: e.target.value || undefined })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step={25}
                    placeholder="1500"
                    value={team.rating ?? ''}
                    aria-label={`${team.name} rating`}
                    // A rating typed by hand no longer comes from a ranking.
                    onChange={(e) =>
                      patch(team.id, { rating: e.target.value === '' ? undefined : Number(e.target.value), ratingSource: undefined })
                    }
                  />
                </td>
                {form && (
                  <td className="teams__live" title="Rating after this tournament's actual results; the odds use this">
                    {Math.round(form[team.id])}
                    {team.rating !== undefined && Math.round(form[team.id]) !== Math.round(team.rating) && (
                      <span className={`teams__delta ${form[team.id] > team.rating ? 'is-up' : 'is-down'}`}>
                        {form[team.id] > team.rating ? '+' : ''}
                        {Math.round(form[team.id] - team.rating)}
                      </span>
                    )}
                  </td>
                )}
                {showPairing && (
                  <td
                    className="teams__live muted"
                    title={live.has(team.id) ? `Decides ${live.get(team.id)!.stage} matchups; not a strength rating` : undefined}
                  >
                    {live.has(team.id) ? Math.round(live.get(team.id)!.rating) : '—'}
                  </td>
                )}
                <td className="muted teams__source">
                  {team.ratingSource ? (
                    <span title={`Rating from ${team.ratingSource.catalog.toUpperCase()} standings of ${formatAsOf(team.ratingSource.asOf)}`}>
                      {team.ratingSource.catalog.toUpperCase()} #{team.ratingSource.rank} · {formatAsOf(team.ratingSource.asOf)}
                    </span>
                  ) : (
                    'Manual'
                  )}
                </td>
                <td className="muted">{entries.has(team.id) ? stageName(entries.get(team.id)!) : 'Not entered'}</td>
                <td>
                  <button className="icon-button" onClick={() => remove(team)} aria-label={`Remove ${team.name}`} title="Remove team">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Each team's live rating from the latest Swiss stage it's in that pairs or
 * breaks ties by rating. Before a team's first match it's the starting rating.
 */
function liveRatings(
  stages: Stage[],
  computed: Record<StageId, ComputedStage>,
): Map<TeamId, { rating: number; stage: string }> {
  const out = new Map<TeamId, { rating: number; stage: string }>()
  const ordered = [...stages].sort((a, b) => a.phase - b.phase)
  for (const stage of ordered) {
    const config = stage.config as SwissConfig
    const swiss = computed[stage.id]?.swiss
    if (!swiss || (config.pairing !== 'rating' && !config.tiebreakers.includes('rating'))) continue
    for (const standing of Object.values(swiss.standings)) {
      out.set(standing.teamId, { rating: standing.rating, stage: stage.name })
    }
  }
  return out
}
