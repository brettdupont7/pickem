import type { Catalog, CatalogEntry, Team, TeamId, Tournament } from '../types'
import { addTeams } from './design'

/** Ranking catalogs: parsing snapshots and linking a tournament's teams to them. */

/**
 * Rules that make VRS points predict well: they predict a best-of-3, and
 * Valve's fit of observed vs expected win rates (observed ≈ 0.8 × expected
 * + 0.13) shows even big underdogs win about 10% of the time.
 */
export const VRS_CALIBRATION = { ratingBasis: 'series', upsetFloor: 0.1 } as const

/** Words that don't tell teams apart: "Team Spirit" is "Spirit", "FURIA Esports" is "FURIA". */
const FILLER = new Set(['team', 'esports', 'esport', 'gaming', 'club', 'the'])

/** Common short names, mapped to the normalized full name. */
const ALIASES: Record<string, string> = {
  navi: 'natusvincere',
  nip: 'ninjasinpyjamas',
  mousesports: 'mouz',
  faze: 'fazeclan',
  col: 'complexity',
  eg: 'evilgeniuses',
}

/** Compares names ignoring case, accents, punctuation, filler words and common short names. */
export function normalizeTeamName(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const kept = words.filter((w) => !FILLER.has(w))
  const joined = (kept.length ? kept : words).join('')
  return ALIASES[joined] ?? joined
}

/**
 * Parses a standings file from Valve's Regional Standings repository
 * (live/<year>/standings_<region>_<date>.md): a Markdown table of
 * standing, points, team name and roster. The date comes from the heading
 * ("Standings as of 2026_10_05") unless given.
 */
export function parseVrsStandings(markdown: string, options: { region?: string; asOf?: string; url?: string } = {}): Catalog {
  const heading = markdown.match(/Standings as of (\d{4})_(\d{2})_(\d{2})/)
  const asOf = options.asOf ?? (heading ? `${heading[1]}-${heading[2]}-${heading[3]}` : '')
  const entries: CatalogEntry[] = []
  const seen = new Set<string>()
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map((c) => c.trim())
    // | Standing | Points | Team Name | Roster | details |
    if (cells.length < 5) continue
    const rank = Number(cells[1])
    const points = Number(cells[2])
    const name = cells[3]
    if (!Number.isInteger(rank) || rank < 1 || !Number.isFinite(points) || !name) continue
    const roster = cells[4] ? cells[4].split(',').map((p) => p.trim()).filter(Boolean) : undefined
    // A name can repeat (e.g. an org with two rosters); later ones get their rank in the key.
    const base = normalizeTeamName(name)
    const key = seen.has(base) ? `${base}#${rank}` : base
    seen.add(base)
    entries.push({ key, rank, name, points, roster })
  }
  if (entries.length === 0) throw new Error("This doesn't look like a VRS standings file")
  const region = options.region ?? 'global'
  return { source: 'vrs', label: `VRS (${region})`, asOf, url: options.url, entries: entries.sort((a, b) => a.rank - b.rank) }
}

/** The catalog entry each team matches by name, or null. Teams already linked keep their link. */
export function matchTeams(teams: Team[], catalog: Catalog): Map<TeamId, CatalogEntry | null> {
  const byKey = new Map(catalog.entries.map((e) => [e.key, e]))
  const byName = new Map<string, CatalogEntry>()
  for (const e of catalog.entries) if (!byName.has(normalizeTeamName(e.name))) byName.set(normalizeTeamName(e.name), e)
  return new Map(
    teams.map((team) => {
      const linked = team.ratingSource?.catalog === catalog.source ? byKey.get(team.ratingSource.key) : undefined
      return [team.id, linked ?? byName.get(normalizeTeamName(team.name)) ?? null]
    }),
  )
}

/** Links a team to an entry, taking its rating; null removes the link and keeps the rating. */
export function linkTeam(tournament: Tournament, teamId: TeamId, entry: CatalogEntry | null, catalog: Catalog): Tournament {
  const team = tournament.teams[teamId]
  if (!team) return tournament
  const next: Team = entry
    ? { ...team, rating: entry.points, ratingSource: { catalog: catalog.source, key: entry.key, rank: entry.rank, asOf: catalog.asOf } }
    : { ...team, ratingSource: undefined }
  return { ...tournament, teams: { ...tournament.teams, [teamId]: next } }
}

/** Adds entries as teams (reusing teams with the same name) and links them. Returns the team IDs in order. */
export function addFromCatalog(tournament: Tournament, entries: CatalogEntry[], catalog: Catalog): { tournament: Tournament; ids: TeamId[] } {
  const { tournament: added, ids } = addTeams(
    tournament,
    entries.map((e) => e.name),
  )
  const linked = ids.reduce((t, id, i) => linkTeam(t, id, entries[i], catalog), added)
  return { tournament: linked, ids }
}

/**
 * Updates every team linked to this catalog to the snapshot's points and
 * rank. Teams whose entry isn't in the snapshot are left as they are.
 */
export function updateRatings(tournament: Tournament, catalog: Catalog): { tournament: Tournament; updated: TeamId[]; missing: TeamId[] } {
  const byKey = new Map(catalog.entries.map((e) => [e.key, e]))
  const updated: TeamId[] = []
  const missing: TeamId[] = []
  let next = tournament
  for (const team of Object.values(tournament.teams)) {
    if (team.ratingSource?.catalog !== catalog.source) continue
    const entry = byKey.get(team.ratingSource.key)
    if (!entry) {
      missing.push(team.id)
      continue
    }
    next = linkTeam(next, team.id, entry, catalog)
    updated.push(team.id)
  }
  return { tournament: next, updated, missing }
}

/**
 * Re-seeds a stage's invited teams by ranking (best first), as CS2 Majors
 * seed by VRS. Teams move only among the invited-team slots; places from
 * earlier stages keep their slots, and unranked teams follow ranked ones.
 */
export function seedByRank(tournament: Tournament, stageId: string): Tournament {
  const stage = tournament.stages.find((s) => s.id === stageId)
  if (!stage) return tournament
  const slots = stage.entrants.flatMap((e, i) => (e.kind === 'team' ? [i] : []))
  const rank = (i: number) => {
    const e = stage.entrants[i]
    return (e.kind === 'team' && tournament.teams[e.teamId]?.ratingSource?.rank) || Infinity
  }
  const sorted = [...slots].sort((a, b) => rank(a) - rank(b) || a - b)
  const entrants = [...stage.entrants]
  slots.forEach((slot, n) => (entrants[slot] = stage.entrants[sorted[n]]))
  return { ...tournament, stages: tournament.stages.map((s) => (s.id === stageId ? { ...s, entrants } : s)) }
}
