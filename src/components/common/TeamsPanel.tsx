import { useTournamentStore } from '../../store/tournament'
import type { Team } from '../../types'
import { TeamBadge } from './TeamBadge'

export function TeamsPanel() {
  const teams = useTournamentStore((s) => s.tournament.teams)
  const update = useTournamentStore((s) => s.updateTournament)

  const patch = (id: string, changes: Partial<Team>) =>
    update((t) => ({ ...t, teams: { ...t.teams, [id]: { ...t.teams[id], ...changes } } }))

  return (
    <div className="teams">
      <p className="hint">
        Short names and logos show in the Swiss grid (initials are used when blank). Ratings drive the simulator
        (Elo scale: 200 points ≈ 76% to win a single game); blank = 1500.
      </p>
      <div className="table-wrap">
        <table className="teams__table">
          <thead>
            <tr>
              <th />
              <th>Name</th>
              <th>Short name</th>
              <th>Logo URL</th>
              <th>Rating</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
