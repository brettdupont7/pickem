import { useMemo, useState } from 'react'
import { addFromCatalog, linkTeam, matchTeams, normalizeTeamName, updateRatings } from '../../engine'
import { useCatalogStore } from '../../store/catalog'
import { useTournamentStore } from '../../store/tournament'
import type { Catalog, CatalogEntry, TeamId } from '../../types'

/** Entries shown in the picker before searching. */
const TOP = 150

export const formatAsOf = (asOf: string) =>
  asOf ? new Date(`${asOf}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown date'

type Mode = 'add' | 'link' | null

/** CS2 rankings in the Teams tab: download VRS, add teams from it, link teams to it and update their ratings. */
export function VrsPanel() {
  const vrs = useCatalogStore((s) => s.vrs)
  const refreshing = useCatalogStore((s) => s.refreshing)
  const error = useCatalogStore((s) => s.error)
  const refreshVrs = useCatalogStore((s) => s.refreshVrs)
  const tournament = useTournamentStore((s) => s.tournament)
  const update = useTournamentStore((s) => s.updateTournament)
  const [mode, setMode] = useState<Mode>(null)
  const [message, setMessage] = useState<string | null>(null)

  const linked = Object.values(tournament.teams).filter((t) => t.ratingSource?.catalog === 'vrs')
  const stale = vrs ? linked.filter((t) => t.ratingSource!.asOf !== vrs.asOf) : []
  const seriesBasis = tournament.rules?.ratingBasis === 'series'

  const applyUpdate = () => {
    if (!vrs) return
    const { updated, missing } = updateRatings(tournament, vrs)
    update((t) => updateRatings(t, vrs).tournament)
    const names = missing.map((id) => tournament.teams[id].name).join(', ')
    setMessage(
      `Updated ${updated.length} ${updated.length === 1 ? 'rating' : 'ratings'} to ${formatAsOf(vrs.asOf)}.` +
        (missing.length ? ` Not in this snapshot (kept as they were): ${names}.` : ''),
    )
  }

  const useSeriesBasis = () =>
    update((t) => ({ ...t, rules: { ...(t.rules ?? { scoring: { kind: 'free' } }), ratingBasis: 'series' } }))

  return (
    <section className="vrs">
      <div className="row vrs__bar">
        <strong>VRS rankings</strong>
        <span className="muted">
          {vrs ? `${vrs.label} · ${formatAsOf(vrs.asOf)} · ${vrs.entries.length} teams` : 'Not downloaded yet'}
        </span>
        <button className="button button--ghost" onClick={() => void refreshVrs()} disabled={refreshing}>
          {refreshing ? 'Downloading…' : vrs ? 'Refresh' : 'Download'}
        </button>
        {vrs && (
          <>
            <button className="button" onClick={() => setMode(mode === 'add' ? null : 'add')}>
              Add from VRS…
            </button>
            <button className="button" onClick={() => setMode(mode === 'link' ? null : 'link')}>
              Link teams to VRS…
            </button>
            {stale.length > 0 && (
              <button className="button" onClick={applyUpdate} title={`${stale.length} linked teams use an older snapshot`}>
                Update ratings to {formatAsOf(vrs.asOf)}
              </button>
            )}
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {message && <p className="hint">{message}</p>}
      {linked.length > 0 && !seriesBasis && (
        <p className="hint">
          VRS points predict who wins a best-of-3, but this tournament's ratings are set to predict a single map, which makes
          favourites too strong.{' '}
          <button className="link-button" onClick={useSeriesBasis}>
            Treat ratings as best-of-3 strength
          </button>
        </p>
      )}
      {vrs && mode === 'add' && <VrsPicker vrs={vrs} onClose={() => setMode(null)} onDone={setMessage} />}
      {vrs && mode === 'link' && <VrsLinker vrs={vrs} onClose={() => setMode(null)} onDone={setMessage} />}
    </section>
  )
}

interface ChildProps {
  vrs: Catalog
  onClose: () => void
  onDone: (message: string) => void
}

/** Pick teams from the rankings to add to the tournament. */
function VrsPicker({ vrs, onClose, onDone }: ChildProps) {
  const tournament = useTournamentStore((s) => s.tournament)
  const update = useTournamentStore((s) => s.updateTournament)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  const present = useMemo(() => {
    const names = new Set(Object.values(tournament.teams).map((t) => normalizeTeamName(t.name)))
    const keys = new Set(Object.values(tournament.teams).map((t) => t.ratingSource?.key))
    return (e: CatalogEntry) => keys.has(e.key) || names.has(normalizeTeamName(e.name))
  }, [tournament.teams])

  const q = query.trim().toLowerCase()
  const shown = q
    ? vrs.entries.filter((e) => e.name.toLowerCase().includes(q) || e.roster?.some((p) => p.toLowerCase().includes(q)))
    : vrs.entries.slice(0, TOP)

  const toggle = (key: string) => {
    const next = new Set(chosen)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setChosen(next)
  }

  const add = () => {
    const entries = vrs.entries.filter((e) => chosen.has(e.key))
    update((t) => addFromCatalog(t, entries, vrs).tournament)
    onDone(`Added ${entries.length} ${entries.length === 1 ? 'team' : 'teams'} from VRS with their points as ratings.`)
    onClose()
  }

  return (
    <div className="vrs__panel">
      <div className="row">
        <input
          autoFocus
          type="search"
          placeholder="Search teams or players"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search VRS teams"
        />
        <span className="muted">{q ? `${shown.length} found` : `Top ${TOP}`}</span>
      </div>
      <div className="vrs__list">
        {shown.map((e) => {
          const inTournament = present(e)
          return (
            <label key={e.key} className={`vrs__entry${inTournament ? ' is-present' : ''}`} title={e.roster?.join(', ')}>
              <input type="checkbox" disabled={inTournament} checked={chosen.has(e.key)} onChange={() => toggle(e.key)} />
              <span className="vrs__rank">#{e.rank}</span>
              <span className="vrs__name">{e.name}</span>
              <span className="vrs__points">{inTournament ? 'added' : e.points}</span>
            </label>
          )
        })}
      </div>
      <div className="row">
        <button className="button" disabled={chosen.size === 0} onClick={add}>
          Add {chosen.size || ''} {chosen.size === 1 ? 'team' : 'teams'}
        </button>
        <button className="button button--ghost" onClick={onClose}>
          Cancel
        </button>
        <span className="hint">Teams are added to the Teams list; enter them into stages in the Design tab.</span>
      </div>
    </div>
  )
}

/** Match the tournament's teams to ranking entries by name, with a dropdown to fix any. */
function VrsLinker({ vrs, onClose, onDone }: ChildProps) {
  const tournament = useTournamentStore((s) => s.tournament)
  const update = useTournamentStore((s) => s.updateTournament)
  const teams = Object.values(tournament.teams)
  const [choice, setChoice] = useState<Map<TeamId, string>>(() => {
    const matched = matchTeams(teams, vrs)
    return new Map(teams.map((t) => [t.id, matched.get(t.id)?.key ?? '']))
  })
  const byKey = useMemo(() => new Map(vrs.entries.map((e) => [e.key, e])), [vrs])
  const found = [...choice.values()].filter(Boolean).length

  const apply = () => {
    update((t) => [...choice].reduce((next, [id, key]) => (key ? linkTeam(next, id, byKey.get(key) ?? null, vrs) : next), t))
    onDone(`Linked ${found} of ${teams.length} teams to VRS and set their ratings to VRS points.`)
    onClose()
  }

  return (
    <div className="vrs__panel">
      <p className="hint">
        Matched by name, ignoring case and punctuation. Check each match and pick the right team where needed; teams left on
        "Not linked" keep their current rating.
      </p>
      <div className="table-wrap">
        <table className="vrs__links">
          <thead>
            <tr>
              <th>Team</th>
              <th>VRS team</th>
              <th>Rating</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => {
              const entry = byKey.get(choice.get(team.id) ?? '')
              return (
                <tr key={team.id}>
                  <td>{team.name}</td>
                  <td>
                    <select
                      value={choice.get(team.id) ?? ''}
                      onChange={(e) => setChoice(new Map(choice).set(team.id, e.target.value))}
                      aria-label={`VRS team for ${team.name}`}
                    >
                      <option value="">Not linked</option>
                      {vrs.entries.map((e) => (
                        <option key={e.key} value={e.key}>
                          #{e.rank} {e.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="muted">
                    {team.rating ?? '—'}
                    {entry && entry.points !== team.rating && ` → ${entry.points}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button className="button" disabled={found === 0} onClick={apply}>
          Link {found} {found === 1 ? 'team' : 'teams'}
        </button>
        <button className="button button--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
