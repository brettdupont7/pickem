import type {
  BestOf,
  BracketSide,
  EliminationSeeding,
  GameScoring,
  Match,
  MatchId,
  MatchReport,
  MatchResult,
  MatchSlot,
  SlotRef,
  TeamId,
} from '../../types'
import { createRng, shuffle } from '../random'
import { resolveReport } from '../results'

/** Where a bracket slot's team comes from. */
export type SlotSource =
  | { kind: 'seed'; index: number }
  | { kind: 'winner'; matchId: MatchId }
  | { kind: 'loser'; matchId: MatchId }
  /** A bye: no team will ever fill this slot. */
  | { kind: 'empty' }
  /** Not known yet, e.g. a reseeded round before the previous one ends. */
  | { kind: 'tbd' }

/** A match in the bracket's structure, before any results are applied. */
export interface BracketNode {
  id: MatchId
  side: BracketSide
  round: number
  label: string
  bestOf: BestOf
  sources: [SlotSource, SlotSource]
  /**
   * Ranks teams that finish here: the loser of a match with no `loserTo`
   * gets this tier. Higher tiers rank better.
   */
  tier: number
  /** Set on matches whose winner finishes (finals, 3rd place): the winner's tier. */
  winnerTier?: number
}

export interface EliminationInput<C> {
  /** Team IDs in seed order (index 0 = top seed). */
  seeds: TeamId[]
  config: C
  /** Results keyed by match ID. Results that don't fit the bracket are ignored. */
  results: Record<MatchId, MatchReport>
  /** Seed for random seeding, so replays are stable. */
  randomSeed?: number
  /** How game scores are judged. Default free scoring. */
  scoring?: GameScoring
}

export interface EliminationState {
  /** Every match in play order. Byes have a slot with `isBye` set. */
  matches: Match[]
  /** Every team ranked best to worst (index 0 = place 1). Final once `complete`. */
  ranking: TeamId[]
  /** Places each team that's done can still finish in; see `finishedPlaces`. */
  places: Record<TeamId, [number, number]>
  complete: boolean
}

type Outcome = { kind: 'team'; teamId: TeamId } | { kind: 'pending' } | { kind: 'none' }

const PENDING: Outcome = { kind: 'pending' }
const NONE: Outcome = { kind: 'none' }

export interface ResolvedBracket {
  matches: Match[]
  winnerOf: (matchId: MatchId) => Outcome
  loserOf: (matchId: MatchId) => Outcome
}

/**
 * Applies results to a bracket structure. `nodes` must be in play order:
 * every source must point at an earlier node.
 */
export function resolveBracket(
  nodes: BracketNode[],
  seeds: TeamId[],
  results: Record<MatchId, MatchReport>,
  scoring?: GameScoring,
): ResolvedBracket {
  const winners = new Map<MatchId, Outcome>()
  const losers = new Map<MatchId, Outcome>()
  const links = new Map<MatchId, { winnerTo?: SlotRef; loserTo?: SlotRef }>()

  for (const node of nodes) {
    node.sources.forEach((source, slot) => {
      if (source.kind !== 'winner' && source.kind !== 'loser') return
      const link = links.get(source.matchId) ?? {}
      link[source.kind === 'winner' ? 'winnerTo' : 'loserTo'] = { matchId: node.id, slot: slot as 0 | 1 }
      links.set(source.matchId, link)
    })
  }

  const resolveSource = (source: SlotSource): Outcome => {
    switch (source.kind) {
      case 'seed':
        return { kind: 'team', teamId: seeds[source.index] }
      case 'empty':
        return NONE
      case 'tbd':
        return PENDING
      case 'winner':
      case 'loser': {
        const outcome = (source.kind === 'winner' ? winners : losers).get(source.matchId)
        if (!outcome) throw new Error(`Bracket node depends on later match ${source.matchId}`)
        return outcome
      }
    }
  }

  const matches = nodes.map((node): Match => {
    const [a, b] = node.sources.map(resolveSource)
    const slots = [a, b].map(
      (o): MatchSlot => (o.kind === 'team' ? { teamId: o.teamId } : o.kind === 'none' ? { teamId: null, isBye: true } : { teamId: null }),
    ) as [MatchSlot, MatchSlot]

    let report: MatchReport | undefined
    let result: MatchResult | undefined
    if (a.kind === 'team' && b.kind === 'team') {
      ;({ report, result } = resolveReport(results[node.id], a.teamId, b.teamId, node.bestOf, scoring))
      if (result) {
        winners.set(node.id, { kind: 'team', teamId: result.winnerId })
        losers.set(node.id, { kind: 'team', teamId: result.winnerId === a.teamId ? b.teamId : a.teamId })
      } else {
        winners.set(node.id, PENDING)
        losers.set(node.id, PENDING)
      }
    } else if (a.kind === 'none' || b.kind === 'none') {
      // A bye: the other slot's team (once known) advances without playing.
      const other = a.kind === 'none' ? b : a
      winners.set(node.id, other)
      losers.set(node.id, NONE)
      if (other.kind === 'team') result = { winnerId: other.teamId, source: 'bye' }
    } else {
      winners.set(node.id, PENDING)
      losers.set(node.id, PENDING)
    }

    return {
      id: node.id,
      side: node.side,
      round: node.round,
      label: node.label,
      bestOf: node.bestOf,
      slots,
      report,
      result,
      ...links.get(node.id),
    }
  })

  return {
    matches,
    winnerOf: (id) => winners.get(id) ?? PENDING,
    loserOf: (id) => losers.get(id) ?? PENDING,
  }
}

/** The tier each team finished at, for teams that are done. */
function finishTiers(nodes: BracketNode[], resolved: ResolvedBracket): Map<TeamId, number> {
  const tier = new Map<TeamId, number>()
  resolved.matches.forEach((match, i) => {
    if (!match.result) return
    const node = nodes[i]
    const winner = match.result.winnerId
    // A team can finish on a bye, e.g. a lower final with no opponent.
    if (node.winnerTier !== undefined) tier.set(winner, node.winnerTier)
    if (match.result.source === 'bye') return
    const loser = match.slots.find((s) => s.teamId !== winner)!.teamId!
    if (!match.loserTo) tier.set(loser, node.tier)
  })
  return tier
}

/** Ranks teams by where they finished, then by seed. Teams still alive rank first. */
export function rankBracket(nodes: BracketNode[], resolved: ResolvedBracket, seeds: TeamId[]): TeamId[] {
  const tier = finishTiers(nodes, resolved)
  const seedOf = new Map(seeds.map((id, i) => [id, i]))
  const tierOf = (id: TeamId) => tier.get(id) ?? Infinity
  return [...seeds].sort((a, b) => tierOf(b) - tierOf(a) || seedOf.get(a)! - seedOf.get(b)!)
}

/**
 * The places (1-based, inclusive) each finished team can still end up in,
 * known before the rest of the bracket is played. How many teams finish at
 * each tier is fixed by the structure, so a tier covers a fixed run of
 * places; once every team in a tier is known, they're split by seed.
 * Teams still playing are left out.
 */
export function finishedPlaces(nodes: BracketNode[], resolved: ResolvedBracket, seeds: TeamId[]): Record<TeamId, [number, number]> {
  const counts = new Map<number, number>()
  const add = (tier: number) => counts.set(tier, (counts.get(tier) ?? 0) + 1)
  resolved.matches.forEach((match, i) => {
    const node = nodes[i]
    if (!match.loserTo && resolved.loserOf(node.id).kind !== 'none') add(node.tier)
    if (node.winnerTier !== undefined && resolved.winnerOf(node.id).kind !== 'none') add(node.winnerTier)
  })

  const tier = finishTiers(nodes, resolved)
  const seedOf = new Map(seeds.map((id, i) => [id, i]))
  const places: Record<TeamId, [number, number]> = {}
  let start = 1
  for (const [t, count] of [...counts].sort(([a], [b]) => b - a)) {
    const known = seeds.filter((id) => tier.get(id) === t).sort((a, b) => seedOf.get(a)! - seedOf.get(b)!)
    known.forEach((id, i) => {
      places[id] = known.length === count ? [start + i, start + i] : [start, start + count - 1]
    })
    start += count
  }
  return places
}

/** A bracket is complete when no match is waiting on a team or a result. */
export const isComplete = (matches: Match[]) =>
  matches.every((m) => m.result || m.slots.every((s) => s.isBye))

export function validateSeeds(seeds: TeamId[], min: number, format: string) {
  if (seeds.length < min) throw new Error(`${format} needs at least ${min} teams`)
  if (new Set(seeds).size !== seeds.length) throw new Error(`${format} has duplicate teams`)
}

export const bracketSize = (teamCount: number) => 2 ** Math.ceil(Math.log2(teamCount))

/** 1-based seeds in bracket order, e.g. 8 -> [1, 8, 4, 5, 2, 7, 3, 6]. */
export function standardOrder(size: number): number[] {
  let order = [1]
  while (order.length < size) {
    const n = order.length * 2
    order = order.flatMap((s) => [s, n + 1 - s])
  }
  return order
}

/**
 * First-round slots as seed indexes, with null for byes. With byes, each
 * bye is paired against a team so no match is empty.
 */
export function firstRoundSlots(teamCount: number, seeding: EliminationSeeding, randomSeed: number): (number | null)[] {
  const size = bracketSize(teamCount)
  if (seeding === 'standard') return standardOrder(size).map((s) => (s <= teamCount ? s - 1 : null))

  const indexes = Array.from({ length: teamCount }, (_, i) => i)
  const order = seeding === 'random' ? shuffle(indexes, createRng(randomSeed)) : indexes
  const byes = size - teamCount
  return order.flatMap((index, i) => (i < byes ? [index, null] : [index]))
}

export const slotSource = (index: number | null): SlotSource =>
  index === null ? { kind: 'empty' } : { kind: 'seed', index }

/** `fromFinal[0]` is the final, `[1]` the round before it, and so on. */
export const bestOfFromFinal = (fallback: BestOf, fromFinal: BestOf[] | undefined, roundsFromFinal: number) =>
  fromFinal?.[roundsFromFinal] ?? fallback
