import { useMemo, useState } from 'react'
import { addBlankTeam, addTeams, removeTeam, renameTeams, teamEntries } from '../../engine'
import { useTournamentStore } from '../../store/tournament'
import type { Team } from '../../types'
import { PasteTeams } from './PasteTeams'
import { TeamBadge } from './TeamBadge'

export function TeamsPanel() {
  const tournament = useTournamentStore((s) => s.tournament)
  const update = useTournamentStore((s) => s.updateTournament)
  const [pasting, setPasting] = useState(false)
  const { teams } = tournament
  const entries = useMemo(() => teamEntries(tournament), [tournament])
  const stageName = (id: string) => tournament.stages.find((s) => s.id === id)?.name ?? id

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
        (Elo scale: 200 points ≈ 76% to win a single game); blank = 1500. Enter teams into stages in the Design tab.
      </p>
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
              <th>Name</th>
              <th>Short name</th>
              <th>Logo URL</th>
              <th>Rating</th>
              <th>Enters in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {Object.values(teams).map((team) => (
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
                    onChange={(e) => patch(team.id, { rating: e.target.value === '' ? undefined : Number(e.target.value) })}
                  />
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
