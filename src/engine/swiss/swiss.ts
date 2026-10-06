import type { BestOf, GameScoring, Match, MatchId, MatchReport, SwissConfig, SwissStanding, TeamId } from '../../types'
import { createRng, shuffle } from '../random'
import { resolveReport } from '../results'

export type SwissTeamStatus = 'active' | 'advanced' | 'eliminated'

export interface SwissInput {
  /** Team IDs in seed order (index 0 = top seed). */
  seeds: TeamId[]
  config: SwissConfig
  /** Results keyed by match ID. Results for matches that aren't generated are ignored. */
  results: Record<MatchId, MatchReport>
  /** Seed for random pairings and tiebreakers, so replays are stable. */
  randomSeed?: number
  /** How game scores are judged. Default free scoring. */
  scoring?: GameScoring
  /** Starting Elo ratings by team. See `startingRatings` for teams without one. */
  ratings?: Record<TeamId, number | undefined>
}

export interface SwissState {
  /** Generated rounds. The last one may still be missing results. */
  rounds: Match[][]
  standings: Record<TeamId, SwissStanding>
  status: Record<TeamId, SwissTeamStatus>
  /** Every team ranked best to worst (index 0 = place 1). Final once `complete`. */
  ranking: TeamId[]
  complete: boolean
  /**
   * Teams whose match in the round being played is already decided, with
   * the record they'll hold once the round finishes. Next round's pairings
   * wait for the whole round, but where these teams go is already known.
   */
  upcoming: Record<TeamId, { wins: number; losses: number }>
  /**
   * Places (1-based, inclusive) each finished team can still end up in:
   * advanced teams share the top places and eliminated teams the bottom
   * ones. Left out for teams still playing, and for all teams when how many
   * will advance isn't fixed yet.
   */
  places: Record<TeamId, [number, number]>
}

interface TeamRecord {
  wins: number
  losses: number
  opponents: TeamId[]
  beat: Set<TeamId>
  byes: number
}

type Pair = [TeamId, TeamId]

export const DEFAULT_RATING = 1500
export const DEFAULT_RATING_K = 32
/** Rating gap between neighbouring seeds when no team has a rating. */
const SEED_RATING_STEP = 25

/**
 * Starting ratings for a Swiss stage. If any team has a rating, unrated
 * teams start at 1500. If none do, ratings follow seed order (top seed
 * highest, 25 apart, centred on 1500), like ESL's seed-based live ratings.
 */
export function startingRatings(seeds: TeamId[], ratings: Record<TeamId, number | undefined> = {}): Map<TeamId, number> {
  const anyRated = seeds.some((id) => ratings[id] !== undefined)
  const mid = (seeds.length - 1) / 2
  return new Map(
    seeds.map((id, i) => [id, anyRated ? ratings[id] ?? DEFAULT_RATING : DEFAULT_RATING + (mid - i) * SEED_RATING_STEP]),
  )
}

/** Chance that a team rated `a` beats one rated `b`. */
const expectedScore = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400))

/**
 * Swiss match IDs come from the pair of teams, not the round, so a result
 * still applies if an earlier change moves that pairing to another round.
 */
export function swissMatchId(a: TeamId, b: TeamId, meeting = 1): MatchId {
  const id = [a, b].sort().join('|')
  return meeting > 1 ? `${id}#${meeting}` : id
}

const byeMatchId = (teamId: TeamId, round: number): MatchId => `bye:${round}:${teamId}`

/**
 * Replays a Swiss stage from its results. Each round is paired from the
 * standings after the previous one, so the whole stage is derived from
 * `seeds`, `config` and `results` alone. Generation stops at the first
 * round that has a match without a result.
 */
export function computeSwiss(input: SwissInput): SwissState {
  const state = computeRounds(input)
  // Worked out on first read: it plays the stage out, and the simulator
  // recomputes stages thousands of times without needing it.
  let places: SwissState['places'] | undefined
  return Object.defineProperty(state, 'places', {
    enumerable: true,
    get: () => (places ??= finishedPlaces(input, state)),
  }) as SwissState
}

/**
 * How many teams advance doesn't depend on results in a balanced Swiss
 * (16 teams, 3 wins/3 losses: always 8), but can with odd groups. It's
 * taken as fixed when playing the rest out with every favourite winning
 * and with every underdog winning gives the same count.
 */
function finishedPlaces(input: SwissInput, state: Omit<SwissState, 'places'>): SwissState['places'] {
  const n = input.seeds.length
  if (state.complete) return Object.fromEntries(state.ranking.map((id, i) => [id, [i + 1, i + 1]]))
  const counts = [true, false].map((favourites) => advancedAfterPlayout(input, favourites))
  if (counts[0] === null || counts[0] !== counts[1]) return {}
  const advancing = counts[0]
  const places: SwissState['places'] = {}
  for (const id of input.seeds) {
    // Includes teams that finished in the round being played.
    const record = state.upcoming[id] ?? state.standings[id]
    if (!record) continue
    const status = statusOfRecord(record, input.config)
    if (status === 'advanced') places[id] = [1, advancing]
    else if (status === 'eliminated') places[id] = [advancing + 1, n]
  }
  return places
}

const statusOfRecord = ({ wins, losses }: { wins: number; losses: number }, config: SwissConfig): SwissTeamStatus =>
  wins >= config.winsToAdvance ? 'advanced' : losses >= config.lossesToEliminate ? 'eliminated' : 'active'

/** How many teams advance if every open match goes to the better (or worse) seed. Null if it can't be played out. */
function advancedAfterPlayout(input: SwissInput, favourites: boolean): number | null {
  const seedOf = new Map(input.seeds.map((id, i) => [id, i]))
  const results = { ...input.results }
  for (let guard = 0; guard < 100; guard++) {
    const state = computeRounds({ ...input, results })
    if (state.complete) return input.seeds.filter((id) => statusOfRecord(state.standings[id], input.config) === 'advanced').length
    for (const m of state.rounds.at(-1) ?? []) {
      if (m.result) continue
      const [a, b] = m.slots.map((s) => s.teamId!)
      const better = seedOf.get(a)! < seedOf.get(b)! ? a : b
      results[m.id] = { source: 'simulated', winnerId: favourites ? better : better === a ? b : a }
    }
  }
  return null
}

function computeRounds({ seeds, config, results, randomSeed = 0, scoring, ratings }: SwissInput): Omit<SwissState, 'places'> {
  validate(seeds, config)
  const { winsToAdvance, lossesToEliminate } = config

  const seedOf = new Map(seeds.map((id, i) => [id, i]))
  const tieRng = createRng(randomSeed)
  const tieValue = new Map(seeds.map((id) => [id, tieRng()]))
  const records = new Map<TeamId, TeamRecord>(
    seeds.map((id) => [id, { wins: 0, losses: 0, opponents: [], beat: new Set(), byes: 0 }]),
  )
  const meetings = new Map<string, number>()
  const live = startingRatings(seeds, ratings)
  const ratingK = config.ratingK ?? DEFAULT_RATING_K

  const rec = (id: TeamId) => records.get(id)!
  const seed = (id: TeamId) => seedOf.get(id)!
  const rating = (id: TeamId) => live.get(id)!
  const statusOf = (id: TeamId): SwissTeamStatus =>
    rec(id).wins >= winsToAdvance ? 'advanced' : rec(id).losses >= lossesToEliminate ? 'eliminated' : 'active'
  /** Sum of opponents' win-loss differentials, as used for CS2 Majors. */
  const buchholz = (id: TeamId) =>
    rec(id).opponents.reduce((sum, opp) => sum + rec(opp).wins - rec(opp).losses, 0)
  const played = (a: TeamId, b: TeamId) => rec(a).opponents.includes(b)

  const statusOrder: Record<SwissTeamStatus, number> = { advanced: 0, active: 1, eliminated: 2 }
  const compareRank = (a: TeamId, b: TeamId): number => {
    const ra = rec(a)
    const rb = rec(b)
    const byStatus = statusOrder[statusOf(a)] - statusOrder[statusOf(b)]
    if (byStatus) return byStatus
    const byDiff = rb.wins - rb.losses - (ra.wins - ra.losses)
    if (byDiff) return byDiff
    const byWins = rb.wins - ra.wins
    if (byWins) return byWins
    for (const tiebreaker of config.tiebreakers) {
      let d = 0
      if (tiebreaker === 'buchholz') d = buchholz(b) - buchholz(a)
      else if (tiebreaker === 'rating') d = rating(b) - rating(a)
      else if (tiebreaker === 'seed') d = seed(a) - seed(b)
      else if (tiebreaker === 'random') d = tieValue.get(a)! - tieValue.get(b)!
      else if (tiebreaker === 'head-to-head') d = Number(rb.beat.has(a)) - Number(ra.beat.has(b))
      if (d) return d
    }
    return seed(a) - seed(b)
  }

  const bestOfFor = (a: TeamId, b: TeamId): BestOf => {
    const canAdvance = [a, b].some((id) => rec(id).wins === winsToAdvance - 1)
    const canBeEliminated = [a, b].some((id) => rec(id).losses === lossesToEliminate - 1)
    let bestOf = config.bestOf
    if (canAdvance && config.advancementBestOf) bestOf = Math.max(bestOf, config.advancementBestOf) as BestOf
    if (canBeEliminated && config.eliminationBestOf) bestOf = Math.max(bestOf, config.eliminationBestOf) as BestOf
    return bestOf
  }

  const recordLabel = (id: TeamId) => `${rec(id).wins}-${rec(id).losses}`

  const rounds: Match[][] = []
  const upcoming: SwissState['upcoming'] = {}
  // Each round every active team gains a win or a loss, so this bounds the stage.
  const maxRounds = winsToAdvance + lossesToEliminate - 1

  for (let round = 0; round < maxRounds; round++) {
    let active = seeds.filter((id) => statusOf(id) === 'active')
    if (active.length === 0) break

    const matches: Match[] = []

    if (active.length % 2 === 1) {
      // The lowest-ranked team that hasn't had a bye sits out and takes a win.
      const ranked = [...active].sort(compareRank).reverse()
      const byeTeam = ranked.find((id) => rec(id).byes === 0) ?? ranked[0]
      active = active.filter((id) => id !== byeTeam)
      matches.push({
        id: byeMatchId(byeTeam, round),
        side: 'swiss',
        round,
        label: recordLabel(byeTeam),
        bestOf: config.bestOf,
        slots: [{ teamId: byeTeam }, { teamId: null }],
        result: { winnerId: byeTeam, source: 'bye' },
      })
    }

    const roundRng = createRng(randomSeed + (round + 1) * 0x9e3779b9)
    const pairs =
      round === 0
        ? pairFirstRound(active, config, roundRng)
        : pairByRecord(active, config, {
            rec,
            seed,
            buchholz,
            rating,
            played: config.avoidRematches ? played : () => false,
            rng: roundRng,
            round,
          })

    for (const [a, b] of pairs) {
      const key = swissMatchId(a, b)
      const meeting = (meetings.get(key) ?? 0) + 1
      const id = swissMatchId(a, b, meeting)
      const bestOf = bestOfFor(a, b)
      const labelA = recordLabel(a)
      const labelB = recordLabel(b)
      matches.push({
        id,
        side: 'swiss',
        round,
        label: labelA === labelB ? labelA : `${labelA} v ${labelB}`,
        bestOf,
        slots: [{ teamId: a }, { teamId: b }],
        ...resolveReport(results[id], a, b, bestOf, scoring),
      })
    }

    rounds.push(matches)
    if (matches.some((m) => !m.result)) {
      for (const m of matches) {
        if (!m.result) continue
        const winner = m.result.winnerId
        upcoming[winner] = { wins: rec(winner).wins + 1, losses: rec(winner).losses }
        const loser = m.slots.map((s) => s.teamId).find((id) => id && id !== winner)
        if (loser) upcoming[loser] = { wins: rec(loser).wins, losses: rec(loser).losses + 1 }
      }
      break
    }

    for (const match of matches) {
      const [a, b] = match.slots.map((s) => s.teamId)
      const winner = match.result!.winnerId
      if (b === null) {
        rec(a!).wins++
        rec(a!).byes++
        continue
      }
      const loser = winner === a ? b : a!
      // Only the match result counts, not the game score.
      const gain = ratingK * (1 - expectedScore(rating(winner), rating(loser)))
      live.set(winner, rating(winner) + gain)
      live.set(loser, rating(loser) - gain)
      rec(winner).wins++
      rec(winner).beat.add(loser)
      rec(loser).losses++
      rec(winner).opponents.push(loser)
      rec(loser).opponents.push(winner)
      const key = swissMatchId(a!, b)
      meetings.set(key, (meetings.get(key) ?? 0) + 1)
    }
  }

  const standings: Record<TeamId, SwissStanding> = {}
  const status: Record<TeamId, SwissTeamStatus> = {}
  for (const id of seeds) {
    const r = rec(id)
    standings[id] = { teamId: id, wins: r.wins, losses: r.losses, opponents: [...r.opponents], buchholz: buchholz(id), rating: rating(id) }
    status[id] = statusOf(id)
  }

  return {
    rounds,
    standings,
    status,
    ranking: [...seeds].sort(compareRank),
    complete: seeds.every((id) => statusOf(id) !== 'active'),
    upcoming,
  }
}

function validate(seeds: TeamId[], config: SwissConfig) {
  if (seeds.length < 2) throw new Error('Swiss stage needs at least 2 teams')
  if (new Set(seeds).size !== seeds.length) throw new Error('Swiss stage has duplicate teams')
  if (!Number.isInteger(config.winsToAdvance) || config.winsToAdvance < 1)
    throw new Error('winsToAdvance must be a positive integer')
  if (!Number.isInteger(config.lossesToEliminate) || config.lossesToEliminate < 1)
    throw new Error('lossesToEliminate must be a positive integer')
}

/** `active` is in seed order and has an even length. */
function pairFirstRound(active: TeamId[], config: SwissConfig, rng: () => number): Pair[] {
  const n = active.length
  const half = n / 2
  const pairs: Pair[] = []
  const { firstRoundPairing } = config
  if (firstRoundPairing === 'high-low') {
    for (let i = 0; i < half; i++) pairs.push([active[i], active[i + half]])
  } else if (firstRoundPairing === 'fold') {
    for (let i = 0; i < half; i++) pairs.push([active[i], active[n - 1 - i]])
  } else {
    const order = firstRoundPairing === 'random' ? shuffle(active, rng) : active
    for (let i = 0; i < n; i += 2) pairs.push([order[i], order[i + 1]])
  }
  return pairs
}

interface PairingContext {
  rec: (id: TeamId) => TeamRecord
  seed: (id: TeamId) => number
  buchholz: (id: TeamId) => number
  rating: (id: TeamId) => number
  played: (a: TeamId, b: TeamId) => boolean
  rng: () => number
  /** 0-based round being paired. */
  round: number
}

/**
 * The CS2 Major priority table for a group of 6 (Valve's Major supplemental
 * rulebook): pairings by position in the group, best first.
 */
const MAJOR_PRIORITY_TABLE: [number, number][][] = [
  [[1, 6], [2, 5], [3, 4]],
  [[1, 6], [2, 4], [3, 5]],
  [[1, 5], [2, 6], [3, 4]],
  [[1, 5], [2, 4], [3, 6]],
  [[1, 4], [2, 6], [3, 5]],
  [[1, 4], [2, 5], [3, 6]],
  [[1, 6], [2, 3], [4, 5]],
  [[1, 5], [2, 3], [4, 6]],
  [[1, 3], [2, 6], [4, 5]],
  [[1, 3], [2, 5], [4, 6]],
  [[1, 4], [2, 3], [5, 6]],
  [[1, 3], [2, 4], [5, 6]],
  [[1, 2], [3, 6], [4, 5]],
  [[1, 2], [3, 5], [4, 6]],
  [[1, 2], [3, 4], [5, 6]],
]

/** The top-most row of the Major table for 6 teams in rank order that has no rematch, or null. */
export function pairByMajorTable(ids: TeamId[], played: (a: TeamId, b: TeamId) => boolean): Pair[] | null {
  if (ids.length !== 6) return null
  for (const row of MAJOR_PRIORITY_TABLE) {
    const pairs = row.map(([x, y]): Pair => [ids[x - 1], ids[y - 1]])
    if (pairs.every(([a, b]) => !played(a, b))) return pairs
  }
  return null
}

/** Pairs a group in rank order without rematches, or returns null. */
function pairGroup(ids: TeamId[], config: SwissConfig, ctx: PairingContext): Pair[] | null {
  // Majors use the table from round 4 (index 3); rounds 2-3 pair highest v lowest.
  if (config.majorPriorityTable && ctx.round >= 3 && ids.length === 6) return pairByMajorTable(ids, ctx.played)
  return pairUp(ids, ctx.played)
}

/**
 * Pairs teams within the same W-L record, best record first. Within a
 * group, the highest-ranked team plays the lowest-ranked one it hasn't met
 * (or, with `majorPriorityTable`, groups of 6 follow the Major table).
 * When a group has an odd count, one team floats down to the next group.
 * Rematches only happen when a group can't be paired any other way. Groups
 * are paired one at a time, so on rare occasions a different pairing of a
 * higher group would have spared a lower group a rematch.
 */
function pairByRecord(active: TeamId[], config: SwissConfig, ctx: PairingContext): Pair[] {
  const groups = new Map<string, TeamId[]>()
  for (const id of active) {
    const { wins, losses } = ctx.rec(id)
    const key = `${wins}-${losses}`
    groups.set(key, [...(groups.get(key) ?? []), id])
  }
  const ordered = [...groups.values()].sort((x, y) => {
    const a = ctx.rec(x[0])
    const b = ctx.rec(y[0])
    return b.wins - a.wins || a.losses - b.losses
  })

  const pairs: Pair[] = []
  let floaters: TeamId[] = []
  ordered.forEach((group, gi) => {
    // Floaters come first so they meet the weakest team of the lower group.
    const pool = [...floaters, ...sortGroup(group, config, ctx)]
    const isLast = gi === ordered.length - 1
    floaters = []

    // Float as few teams as possible (lowest-ranked first) so the rest pair
    // without rematches. The last group has nowhere to float to.
    const minFloat = pool.length % 2
    const maxFloat = isLast ? 0 : minFloat + 2
    for (let float = minFloat; float <= maxFloat; float += 2) {
      for (const floated of floatCandidates(pool, float)) {
        const paired = pairGroup(pool.filter((id) => !floated.includes(id)), config, ctx)
        if (paired) {
          pairs.push(...paired)
          floaters = [...floated].reverse() // back to rank order
          return
        }
      }
    }

    // No clean pairing: float the bottom team if needed and allow rematches.
    floaters = minFloat ? [pool[pool.length - 1]] : []
    pairs.push(...pairUp(pool.slice(0, pool.length - minFloat), () => false)!)
  })
  return pairs
}

/** Every way to pick `count` teams to float, lowest-ranked combinations first. */
function floatCandidates(pool: TeamId[], count: number): TeamId[][] {
  if (count === 0) return [[]]
  const out: TeamId[][] = []
  const pick = (start: number, chosen: TeamId[]) => {
    if (chosen.length === count) return out.push(chosen)
    for (let i = start; i >= 0; i--) pick(i - 1, [...chosen, pool[i]])
  }
  pick(pool.length - 1, [])
  return out
}

function sortGroup(group: TeamId[], config: SwissConfig, ctx: PairingContext): TeamId[] {
  switch (config.pairing) {
    case 'buchholz':
      return [...group].sort((a, b) => ctx.buchholz(b) - ctx.buchholz(a) || ctx.seed(a) - ctx.seed(b))
    case 'rating':
      return [...group].sort((a, b) => ctx.rating(b) - ctx.rating(a) || ctx.seed(a) - ctx.seed(b))
    case 'seed':
      return [...group].sort((a, b) => ctx.seed(a) - ctx.seed(b))
    case 'random':
      return shuffle(group, ctx.rng)
  }
}

/** Pairs the first team with the last one it hasn't played, backtracking as needed. */
function pairUp(ids: TeamId[], played: (a: TeamId, b: TeamId) => boolean): Pair[] | null {
  if (ids.length === 0) return []
  const [first, ...rest] = ids
  for (let i = rest.length - 1; i >= 0; i--) {
    if (played(first, rest[i])) continue
    const sub = pairUp(rest.filter((_, j) => j !== i), played)
    if (sub) return [[first, rest[i]], ...sub]
  }
  return null
}
