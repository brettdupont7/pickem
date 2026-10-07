import type { GameResult, Match, MatchId, MatchReport, StageId, TeamId, Tournament, TournamentResults } from '../../types'
import { createRng } from '../random'
import { resolveForMatch, winsNeeded } from '../results'
import { FREE_SCORING, scoreModelFor, type GameScoreModel } from '../rules'
import { computeStageIn, computeTournament, playOrder, type ComputedStage } from '../tournament'

export interface SimulationOptions {
  /** Overrides each team's `rating`. */
  ratings?: Record<TeamId, number>
  /** Rating for teams with none. Default 1500. */
  defaultRating?: number
  /** 0 = ratings decide (Elo odds), 1 = every game is a coin flip. Default 0. */
  chaos?: number
  /** How much a simulated result records. Default 'games'. */
  detail?: 'winner' | 'series' | 'games'
  /**
   * Scores for each game when detail is 'games'. Defaults to what the
   * tournament's scoring rules imply; null for winners only.
   */
  gameScore?: GameScoreModel | null
  /** Seed for the simulation's randomness. Default 0. */
  seed?: number
}

export const isPlayable = (m: Match) => !m.result && m.slots.every((s) => s.teamId !== null)

/** Chance of winning a best-of-3 when each game is won with chance `p`. */
const bestOf3 = (p: number) => p * p * (3 - 2 * p)

/** The per-game chance that wins a best-of-3 with chance `series` (inverse of `bestOf3`). */
export function gameChanceForBestOf3(series: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (bestOf3(mid) < series) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Chance of winning `need` games before losing `otherNeeds`, winning each game with chance `p`. */
export function seriesChance(p: number, need: number, otherNeeds: number): number {
  if (need <= 0) return 1
  if (otherNeeds <= 0) return 0
  // Win the last game, having lost k of the games before it.
  let total = 0
  let ways = 1
  for (let k = 0; k < otherNeeds; k++) {
    if (k > 0) ways = (ways * (need - 1 + k)) / k
    total += ways * p ** need * (1 - p) ** k
  }
  return total
}

export function createSimulator(tournament: Tournament, options: SimulationOptions = {}) {
  const scoring = tournament.rules?.scoring ?? FREE_SCORING
  const { defaultRating = 1500, chaos = 0, detail = 'games' } = options
  const gameScore = options.gameScore === undefined ? scoreModelFor(scoring) : options.gameScore
  const rating = (id: TeamId) => options.ratings?.[id] ?? tournament.teams[id]?.rating ?? defaultRating

  const seriesBasis = tournament.rules?.ratingBasis === 'series'
  const floor = Math.min(0.5, Math.max(0, tournament.rules?.upsetFloor ?? 0))

  /**
   * Chance that `a` beats `b` in a single game. The Elo formula gives the
   * chance of winning whatever ratings predict: one game, or with a
   * 'series' basis a best-of-3, which is converted to a per-game chance.
   * The upset floor keeps the underdog's chance of that above a minimum.
   */
  const gameWinProbability = (a: TeamId, b: TeamId) => {
    const elo = 1 / (1 + 10 ** (((rating(b) - rating(a)) * (1 - chaos)) / 400))
    const predicted = floor + (1 - 2 * floor) * elo
    return seriesBasis ? gameChanceForBestOf3(predicted) : predicted
  }

  /**
   * Chance that the team in the first slot wins the match, continuing from
   * any series score already recorded.
   */
  const matchWinProbability = (match: Match, current: MatchReport | undefined = match.report) => {
    const [a, b] = match.slots.map((s) => s.teamId!)
    const score = resolveForMatch(current, match, scoring).report?.score
    const needed = winsNeeded(match.bestOf)
    return seriesChance(gameWinProbability(a, b), needed - (score?.[a] ?? 0), needed - (score?.[b] ?? 0))
  }

  /**
   * Simulates a match, continuing from any games or series score already
   * recorded. Returns the report to store.
   */
  function simulateMatch(match: Match, current: MatchReport | undefined, rng: () => number): MatchReport {
    const [a, b] = match.slots.map((s) => s.teamId!)
    const existing = resolveForMatch(current, match, scoring).report
    const needed = winsNeeded(match.bestOf)
    const won = { [a]: existing?.score?.[a] ?? 0, [b]: existing?.score?.[b] ?? 0 }
    // Only extend existing games if they account for the whole score so far.
    const games: GameResult[] = existing?.games ? [...existing.games] : []
    const keepGames = detail === 'games' && (games.length > 0 || (won[a] === 0 && won[b] === 0))

    const p = gameWinProbability(a, b)
    while (won[a] < needed && won[b] < needed) {
      const winner = rng() < p ? a : b
      const loser = winner === a ? b : a
      won[winner]++
      if (keepGames) {
        const game: GameResult = { winnerId: winner }
        if (gameScore) {
          const s = gameScore(winner === a ? p : 1 - p, rng)
          game.score = { [winner]: s.winner, [loser]: s.loser }
        }
        games.push(game)
      }
    }

    const winnerId = won[a] === needed ? a : b
    const report: MatchReport = { source: 'simulated', winnerId }
    if (detail !== 'winner') report.score = won
    if (keepGames && games.length) report.games = games
    return report
  }

  return { gameWinProbability, matchWinProbability, simulateMatch, rating }
}

export type SimulationScope =
  /** Only matches that can be played right now. */
  | { kind: 'round' }
  /** Everything up to the end of one stage. */
  | { kind: 'stage'; stageId: StageId }
  | { kind: 'tournament' }

/**
 * Fills in undecided matches with simulated results. Decided matches are
 * never touched; matches in progress are played out from where they are.
 * Returns new results without modifying the input.
 */
export function simulate(
  tournament: Tournament,
  results: TournamentResults,
  scope: SimulationScope,
  options: SimulationOptions = {},
): TournamentResults {
  const { simulateMatch } = createSimulator(tournament, options)
  const rng = createRng(options.seed ?? 0)
  const next: TournamentResults = Object.fromEntries(
    Object.entries(results).map(([id, reports]) => [id, { ...reports }]),
  )

  for (let guard = 0; guard < 1000; guard++) {
    const state = computeTournament(tournament, next)
    if (scope.kind === 'stage' && state.stages[scope.stageId]?.status !== 'in-progress') break

    let changed = false
    for (const stage of playOrder(tournament.stages)) {
      if (scope.kind === 'stage' && stage.id !== scope.stageId) continue
      for (const match of state.stages[stage.id].matches.filter(isPlayable)) {
        const reports = (next[stage.id] ??= {})
        reports[match.id] = simulateMatch(match, reports[match.id], rng)
        changed = true
      }
    }
    if (!changed || scope.kind === 'round') break
  }
  return next
}

/** Removes every simulated result, keeping picks and actual results. */
export function clearSimulated(results: TournamentResults): TournamentResults {
  return Object.fromEntries(
    Object.entries(results).map(([id, reports]) => [
      id,
      Object.fromEntries(Object.entries(reports).filter(([, r]) => r.source !== 'simulated')),
    ]),
  )
}

// ---------------------------------------------------------------------------
// Monte Carlo

export interface StageOdds {
  /** Chance of playing in this stage. */
  entered: number
  /** places[i] = chance of finishing in place i + 1. */
  places: number[]
  /** Swiss only: chance of each final record, e.g. { '3-0': 0.12 }. */
  records?: Record<string, number>
}

export interface TeamOdds {
  stages: Record<StageId, StageOdds>
  /** Chance of finishing first in the last stage. */
  champion: number
}

/**
 * A match that could be played when the simulations started, with each
 * team's odds in the match's stage depending on who wins it.
 */
export interface MatchOdds {
  stageId: StageId
  matchId: MatchId
  teams: [TeamId, TeamId]
  /** Share of simulations the first team won. */
  firstWins: number
  /**
   * ifWins[winner][team][i] = chance that `team` finishes the stage in
   * place i + 1 when `winner` wins this match. Both teams are included.
   */
  ifWins: Record<TeamId, Record<TeamId, number[]>>
}

export interface MonteCarloResult {
  iterations: number
  teams: Record<TeamId, TeamOdds>
  /** Matches playable at the start, in play order. */
  matches: MatchOdds[]
}

/**
 * Runs the rest of the tournament many times from the current results.
 * Picks and actual results are kept fixed, so the odds are conditional on
 * them. Call `run` in chunks (e.g. per animation frame) to keep the UI
 * responsive, and read `result()` whenever.
 */
export function createMonteCarlo(tournament: Tournament, results: TournamentResults, options: SimulationOptions = {}) {
  const { simulateMatch } = createSimulator(tournament, { ...options, detail: 'winner' })
  const rng = createRng(options.seed ?? 0)
  const stages = playOrder(tournament.stages)
  const lastStageId = stages.at(-1)?.id

  let iterations = 0
  const entered = new Map<string, number>()
  const places = new Map<string, number[]>()
  const records = new Map<string, Record<string, number>>()
  const champions = new Map<TeamId, number>()
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)

  // Matches that can be played now, and per winner: wins, and places of both teams.
  const initial = computeTournament(tournament, results)
  const tracked = stages.flatMap((stage) =>
    (initial.stages[stage.id]?.matches ?? []).filter(isPlayable).map((m) => ({
      stageId: stage.id,
      matchId: m.id,
      teams: m.slots.map((s) => s.teamId!) as [TeamId, TeamId],
      wins: new Map<TeamId, number>(),
      places: new Map<string, number[]>(),
    })),
  )
  const trackedIn = new Map<StageId, typeof tracked>()
  for (const t of tracked) trackedIn.set(t.stageId, [...(trackedIn.get(t.stageId) ?? []), t])

  function runOnce() {
    const computed: Record<StageId, ComputedStage> = {}
    for (const stage of stages) {
      const reports = { ...results[stage.id] }
      let state = computeStageIn(tournament, stage, computed, reports)
      for (let guard = 0; state.status === 'in-progress' && guard < 200; guard++) {
        for (const match of state.matches.filter(isPlayable)) {
          reports[match.id] = simulateMatch(match, reports[match.id], rng)
        }
        state = computeStageIn(tournament, stage, computed, reports)
      }
      computed[stage.id] = state
      if (state.status !== 'complete') continue

      for (const t of trackedIn.get(stage.id) ?? []) {
        const winner = reports[t.matchId]?.winnerId
        if (!winner || !t.teams.includes(winner)) continue
        t.wins.set(winner, (t.wins.get(winner) ?? 0) + 1)
        for (const team of t.teams) {
          const i = state.ranking.indexOf(team)
          if (i < 0) continue
          const key = `${winner}>${team}`
          const counts = t.places.get(key) ?? []
          counts[i] = (counts[i] ?? 0) + 1
          t.places.set(key, counts)
        }
      }

      state.ranking.forEach((teamId, i) => {
        const key = `${teamId}@${stage.id}`
        bump(entered, key)
        const counts = places.get(key) ?? []
        counts[i] = (counts[i] ?? 0) + 1
        places.set(key, counts)
        const standing = state.swiss?.standings[teamId]
        if (standing) {
          const record = `${standing.wins}-${standing.losses}`
          const counts = records.get(key) ?? {}
          counts[record] = (counts[record] ?? 0) + 1
          records.set(key, counts)
        }
      })
      if (stage.id === lastStageId) bump(champions, state.ranking[0])
    }
    iterations++
  }

  return {
    run(count: number) {
      for (let i = 0; i < count; i++) runOnce()
    },
    result(): MonteCarloResult {
      const teams: Record<TeamId, TeamOdds> = {}
      const share = (n = 0) => (iterations ? n / iterations : 0)
      for (const teamId of Object.keys(tournament.teams)) {
        const odds: TeamOdds = { stages: {}, champion: share(champions.get(teamId)) }
        for (const stage of stages) {
          const key = `${teamId}@${stage.id}`
          if (!entered.has(key)) continue
          const stageOdds: StageOdds = {
            entered: share(entered.get(key)),
            places: Array.from(places.get(key) ?? [], (n) => share(n)),
          }
          const rec = records.get(key)
          if (rec) stageOdds.records = Object.fromEntries(Object.entries(rec).map(([r, n]) => [r, share(n)]))
          odds.stages[stage.id] = stageOdds
        }
        teams[teamId] = odds
      }
      const matches: MatchOdds[] = tracked.map((t) => {
        const ifWins: MatchOdds['ifWins'] = {}
        for (const winner of t.teams) {
          const n = t.wins.get(winner) ?? 0
          ifWins[winner] = Object.fromEntries(
            t.teams.map((team) => [team, Array.from(t.places.get(`${winner}>${team}`) ?? [], (c) => (n ? (c ?? 0) / n : 0))]),
          )
        }
        return { stageId: t.stageId, matchId: t.matchId, teams: t.teams, firstWins: share(t.wins.get(t.teams[0])), ifWins }
      })
      return { iterations, teams, matches }
    },
  }
}

export function runMonteCarlo(
  tournament: Tournament,
  results: TournamentResults,
  iterations: number,
  options: SimulationOptions = {},
): MonteCarloResult {
  const mc = createMonteCarlo(tournament, results, options)
  mc.run(iterations)
  return mc.result()
}
