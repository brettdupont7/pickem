import { useMemo, useState } from 'react'
import { addBlankTeam, addTeams, removeTeam, renameTeams, teamEntries } from '../../engine'
import { useTournamentState, useTournamentStore } from '../../store/tournament'
import type { ComputedStage } from '../../engine'
import type { Stage, StageId, SwissConfig, Team, TeamId } from '../../types'
import { PasteTeams } from './PasteTeams'
import { TeamBadge } from './TeamBadge'
import { formatAsOf, VrsPanel } from './VrsPanel'

type SortKey = 'name' | 'rating' | 'live'

interface Sort {
  key: SortKey
  desc: boolean
}

const SORT_LABEL: Record<SortKey, string> = { name: 'Name', rating: 'Rating', live: 'Live' }

export function TeamsPanel() {
  const tournament = useTournamentStore((s) => s.tournament)
  const update = useTournamentStore((s) => s.updateTournament)
  const [pasting, setPasting] = useState(false)
  const { teams } = tournament
  const entries = useMemo(() => teamEntries(tournament), [tournament])
  const stageName = (id: string) => tournament.stages.find((s) => s.id === id)?.name ?? id
  const state = useTournamentState()
  const live = useMemo(() => liveRatings(tournament.stages, state.stages), [tournament.stages, state.stages])
  // The order is fixed when a header is clicked, so rows don't jump while a rating is being typed.
  const [sort, setSort] = useState<Sort | null>(null)
  const [order, setOrder] = useState<TeamId[]>([])

  const sortBy = (key: SortKey) => {
    // Name starts A-Z and ratings start highest first; a third click restores the original order.
    const firstDesc = key !== 'name'
    const next = sort?.key !== key ? { key, desc: firstDesc } : sort.desc === firstDesc ? { key, desc: !firstDesc } : null
    setSort(next)
    if (!next) return
    const value = (team: Team) => (key === 'name' ? team.name : key === 'rating' ? team.rating : live.get(team.id)?.rating)
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

  return (
    <div className="teams">
      <p className="hint">
        Short names and logos show in the Swiss grid (initials are used when blank). Ratings drive the simulator
        (Elo scale: 200 points ≈ 76% to win a single game); blank = 1500. They're also the starting point for Swiss
        stages paired by live rating; Live shows each team's rating after its matches so far. Click Name, Rating or
        Live to sort. Enter teams into stages in the Design tab.
      </p>
      <VrsPanel />
      <div className="row teams__actions">
        <button className="button" onClick={() => update((t) => addBlankTeam(t).tournament)}>
          + Add team
        </button>
        <button className="button" onClick={() => setPasting(!pasting)}>
          Paste team names…
        </button>
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
              <th />
              {header('name')}
              <th>Short name</th>
              <th>Logo URL</th>
              {header('rating')}
              {header('live')}
              <th>Source</th>
              <th>Enters in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((id) => teams[id]).map((team) => (
              <tr key={team.id}>
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
                <td className="teams__live muted" title={live.has(team.id) ? `Live rating in ${live.get(team.id)!.stage}` : undefined}>
                  {live.has(team.id) ? Math.round(live.get(team.id)!.rating) : '—'}
                </td>
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
