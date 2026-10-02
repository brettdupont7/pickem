import type {
  BestOf,
  GameResult,
  GameScoring,
  Match,
  MatchReport,
  MatchResult,
  ResultSource,
  TeamId,
  TeamScore,
} from '../types'
import { FREE_SCORING, gameScoreStatus } from './rules'

/** Games needed to win a series. */
export const winsNeeded = (bestOf: BestOf) => Math.ceil(bestOf / 2)

export function bestOfError(bestOf: BestOf): string | null {
  return Number.isInteger(bestOf) && bestOf >= 1 && bestOf % 2 === 1 ? null : 'Best-of must be an odd number'
}

export interface ResolvedReport {
  /** The report with anything that doesn't fit this match removed. */
  report?: MatchReport
  /** Set when the report decides the match. */
  result?: MatchResult
}

const fitsTeams = (score: TeamScore | undefined, a: TeamId, b: TeamId) =>
  !score || Object.keys(score).every((id) => id === a || id === b)

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0

/** The winner of one game: from its score if final under the rules, otherwise its `winnerId`. */
export function gameWinner(game: GameResult, a: TeamId, b: TeamId, scoring: GameScoring = FREE_SCORING) {
  const sa = game.score?.[a]
  const sb = game.score?.[b]
  if (isCount(sa) && isCount(sb)) {
    const status = gameScoreStatus(scoring, [sa, sb], game.inProgress)
    if (status.state === 'final') return status.winnerSlot === 0 ? a : b
  }
  return game.winnerId === a || game.winnerId === b ? game.winnerId : undefined
}

/**
 * Problem with a series score for a best-of, or null if it's valid.
 * A partial score (no one has reached the winning number yet) is valid.
 */
export function seriesScoreError(bestOf: BestOf, [x, y]: [number, number]): string | null {
  const needed = winsNeeded(bestOf)
  if (!isCount(x) || !isCount(y)) return 'Scores must be whole numbers of 0 or more'
  if (x > needed || y > needed) return `A Bo${bestOf} ends when a team wins ${needed}`
  if (x === needed && y === needed) return `Only one team can win ${needed}`
  return null
}

/**
 * Checks a report against the two teams actually in the match. Anything
 * referring to another team (e.g. after an earlier result changed who plays
 * here) or that's impossible for the best-of is dropped.
 */
export function resolveReport(
  report: MatchReport | undefined,
  a: TeamId,
  b: TeamId,
  bestOf: BestOf,
  scoring: GameScoring = FREE_SCORING,
): ResolvedReport {
  if (!report) return {}
  const needed = winsNeeded(bestOf)

  let games = report.games?.filter(Boolean)
  const gamesFit = games?.every(
    (g) => fitsTeams(g.score, a, b) && (g.winnerId === undefined || g.winnerId === a || g.winnerId === b),
  )
  if (!gamesFit) games = undefined

  let score: TeamScore | undefined
  if (games?.length) {
    // Count games in order, ignoring any after the series was clinched.
    const won = { [a]: 0, [b]: 0 }
    let played = 0
    for (const game of games) {
      if (won[a] === needed || won[b] === needed) break
      played++
      const winner = gameWinner(game, a, b, scoring)
      if (winner) won[winner]++
    }
    games = games.slice(0, played)
    score = won
  } else if (report.score && fitsTeams(report.score, a, b)) {
    const pair: [number, number] = [report.score[a] ?? 0, report.score[b] ?? 0]
    if (!seriesScoreError(bestOf, pair)) score = { [a]: pair[0], [b]: pair[1] }
  }

  const clinched = score && (score[a] === needed ? a : score[b] === needed ? b : undefined)
  const picked = report.winnerId === a || report.winnerId === b ? report.winnerId : undefined
  // A picked winner stands unless the score says the other team already won.
  const winnerId = clinched ?? picked

  if (!winnerId && !score && !games?.length) return {}
  const normalized: MatchReport = { source: report.source }
  if (winnerId) normalized.winnerId = winnerId
  if (score) normalized.score = score
  if (games?.length) normalized.games = games
  return { report: normalized, result: winnerId ? (normalized as MatchResult) : undefined }
}

type MatchShape = Pick<Match, 'slots' | 'bestOf'>

/** Resolves a report for a match whose two slots are filled. */
export function resolveForMatch(
  report: MatchReport | undefined,
  match: MatchShape,
  scoring: GameScoring = FREE_SCORING,
): ResolvedReport {
  const [a, b] = match.slots.map((s) => s.teamId)
  if (!a || !b) return {}
  return resolveReport(report, a, b, match.bestOf, scoring)
}

// ---------------------------------------------------------------------------
// Edit helpers. Each takes the match as currently computed plus its stored
// report, and returns the report to store (undefined = clear it).

export interface EditOptions {
  /** Default 'pick'. */
  source?: ResultSource
  /** The tournament's game scoring. Default free scoring. */
  scoring?: GameScoring
}

function teamsOf(match: MatchShape): [TeamId, TeamId] {
  const [a, b] = match.slots.map((s) => s.teamId)
  if (!a || !b) throw new Error('Both teams must be known to record a result')
  return [a, b]
}

/** Re-derives the winner so a detailed report also stores it explicitly. */
function finalize(match: MatchShape, report: MatchReport, scoring?: GameScoring): MatchReport | undefined {
  return resolveForMatch({ ...report, winnerId: undefined }, match, scoring).report
}

/**
 * One-click pick. Clicking the team that already won clears the result.
 * Picking a winner for a match in progress keeps the scores entered so far;
 * overturning a decided match replaces its scores.
 */
export function pickWinner(
  match: MatchShape,
  current: MatchReport | undefined,
  teamId: TeamId,
  { source = 'pick', scoring }: EditOptions = {},
): MatchReport | undefined {
  const [a, b] = teamsOf(match)
  if (teamId !== a && teamId !== b) throw new Error(`${teamId} isn't playing in this match`)
  const { report, result } = resolveForMatch(current, match, scoring)
  if (result?.winnerId === teamId) return undefined
  if (report && !result) return { ...report, source, winnerId: teamId }
  return { source, winnerId: teamId }
}

/** Sets the series score in slot order, e.g. [2, 1]. Replaces any per-game results. */
export function setSeriesScore(
  match: MatchShape,
  score: [number, number],
  { source = 'pick', scoring }: EditOptions = {},
): MatchReport | undefined {
  const [a, b] = teamsOf(match)
  const error = seriesScoreError(match.bestOf, score)
  if (error) throw new Error(error)
  return finalize(match, { source, score: { [a]: score[0], [b]: score[1] } }, scoring)
}

/** A game as entered in the UI, in slot order. */
export interface GameInput {
  name?: string
  /** Points in slot order. Either side may be blank while it's being typed. */
  score?: [number | null, number | null]
  /** Free scoring only: the score isn't final yet. */
  inProgress?: boolean
  /** Slot that won, for games without a decisive score. */
  winnerSlot?: 0 | 1
}

function toGameResult([a, b]: [TeamId, TeamId], input: GameInput): GameResult {
  const game: GameResult = {}
  if (input.name) game.name = input.name
  if (input.score) {
    const score: TeamScore = {}
    if (input.score[0] !== null) score[a] = input.score[0]
    if (input.score[1] !== null) score[b] = input.score[1]
    if (Object.keys(score).length) game.score = score
  }
  if (input.inProgress) game.inProgress = true
  if (input.winnerSlot !== undefined) game.winnerId = input.winnerSlot === 0 ? a : b
  return game
}

/**
 * Sets game `index` (0-based). Setting the next index adds a game. The
 * series score and winner are derived from the games.
 */
export function setGame(
  match: MatchShape,
  current: MatchReport | undefined,
  index: number,
  input: GameInput,
  { source = 'pick', scoring }: EditOptions = {},
): MatchReport | undefined {
  const teams = teamsOf(match)
  const games = [...(resolveForMatch(current, match, scoring).report?.games ?? [])]
  if (index < 0 || index > games.length || index >= match.bestOf) throw new Error(`Game ${index + 1} can't be set`)
  games[index] = toGameResult(teams, input)
  return finalize(match, { source, games }, scoring)
}

/** Removes game `index`; later games move up. */
export function removeGame(
  match: MatchShape,
  current: MatchReport | undefined,
  index: number,
  { source = 'pick', scoring }: EditOptions = {},
): MatchReport | undefined {
  const games = (resolveForMatch(current, match, scoring).report?.games ?? []).filter((_, i) => i !== index)
  return games.length ? finalize(match, { source, games }, scoring) : undefined
}

// ---------------------------------------------------------------------------
// Display summary

export type MatchStatus = 'tbd' | 'ready' | 'live' | 'decided' | 'bye'

export interface GameView {
  name?: string
  /** Points in slot order; null where none was entered. */
  score: [number | null, number | null]
  winnerSlot: 0 | 1 | null
}

/** Everything a match card needs, in slot order. */
export interface MatchView {
  status: MatchStatus
  teams: [TeamId | null, TeamId | null]
  /** Games won in slot order, when known. */
  seriesScore: [number, number] | null
  winnerSlot: 0 | 1 | null
  games: GameView[]
  source?: ResultSource
}

export function describeMatch(match: Match, scoring: GameScoring = FREE_SCORING): MatchView {
  const teams = match.slots.map((s) => s.teamId) as [TeamId | null, TeamId | null]
  const [a, b] = teams
  const report = match.report ?? match.result
  const winnerId = match.result?.winnerId
  const slotOf = (id: TeamId | undefined) => (id === undefined ? null : id === a ? 0 : id === b ? 1 : null)

  let status: MatchStatus
  if (match.result?.source === 'bye' || match.slots.some((s) => s.isBye)) status = 'bye'
  else if (!a || !b) status = 'tbd'
  else if (match.result) status = 'decided'
  else if (report) status = 'live'
  else status = 'ready'

  return {
    status,
    teams,
    seriesScore: report?.score && a && b ? [report.score[a] ?? 0, report.score[b] ?? 0] : null,
    winnerSlot: slotOf(winnerId),
    games: (report?.games ?? []).map((g) => ({
      name: g.name,
      score: [a ? g.score?.[a] ?? null : null, b ? g.score?.[b] ?? null : null],
      winnerSlot: a && b ? slotOf(gameWinner(g, a, b, scoring)) : null,
    })),
    source: report?.source,
  }
}
