import type { Match, SingleElimConfig, TeamId } from '../../types'
import {
  bestOfFromFinal,
  bracketSize,
  finishedPlaces,
  firstRoundSlots,
  isComplete,
  rankBracket,
  resolveBracket,
  slotSource,
  validateSeeds,
  type BracketNode,
  type EliminationInput,
  type EliminationState,
} from '../elimination/bracket'

export type SingleElimInput = EliminationInput<SingleElimConfig>

export const singleElimMatchId = (round: number, index: number) => `r${round}-${index}`
export const THIRD_PLACE_MATCH_ID = 'third-place'

function roundLabel(roundsFromFinal: number, names?: string[]) {
  if (names?.[roundsFromFinal]) return names[roundsFromFinal]
  if (roundsFromFinal === 0) return 'Final'
  if (roundsFromFinal === 1) return 'Semi-finals'
  if (roundsFromFinal === 2) return 'Quarter-finals'
  return `Round of ${2 ** (roundsFromFinal + 1)}`
}

/**
 * Builds the bracket structure. With `reseed`, rounds after the first are
 * placeholders here; `computeSingleElim` fills them in as rounds finish.
 */
export function buildSingleElim(teamCount: number, config: SingleElimConfig, randomSeed = 0): BracketNode[] {
  const size = bracketSize(teamCount)
  const rounds = Math.log2(size)
  const slots = firstRoundSlots(teamCount, config.seeding, randomSeed)
  const nodes: BracketNode[] = []

  for (let round = 0; round < rounds; round++) {
    const fromFinal = rounds - 1 - round
    const count = size / 2 ** (round + 1)
    for (let i = 0; i < count; i++) {
      let sources: BracketNode['sources']
      if (round === 0) sources = [slotSource(slots[2 * i]), slotSource(slots[2 * i + 1])]
      else if (config.reseed) sources = [{ kind: 'tbd' }, { kind: 'tbd' }]
      else
        sources = [
          { kind: 'winner', matchId: singleElimMatchId(round - 1, 2 * i) },
          { kind: 'winner', matchId: singleElimMatchId(round - 1, 2 * i + 1) },
        ]
      nodes.push({
        id: singleElimMatchId(round, i),
        side: 'main',
        round,
        label: roundLabel(fromFinal, config.roundNamesFromFinal),
        bestOf: bestOfFromFinal(config.bestOf, config.bestOfFromFinal, fromFinal),
        sources,
        tier: round,
        winnerTier: fromFinal === 0 ? round + 0.5 : undefined,
      })
    }
  }

  if (config.thirdPlaceMatch && rounds >= 2) {
    const semis = rounds - 2
    nodes.push({
      id: THIRD_PLACE_MATCH_ID,
      side: 'third-place',
      round: 0,
      label: '3rd place',
      bestOf: bestOfFromFinal(config.bestOf, config.bestOfFromFinal, 1),
      sources: [
        { kind: 'loser', matchId: singleElimMatchId(semis, 0) },
        { kind: 'loser', matchId: singleElimMatchId(semis, 1) },
      ],
      // Between the final's loser (rounds - 1) and quarter-final losers (rounds - 3).
      tier: semis,
      winnerTier: semis + 0.5,
    })
  }
  return nodes
}

/**
 * Pairs each reseeded round, best remaining seed v worst, once the round
 * before it is decided. For the first round still waiting, returns where
 * the teams already through would play if every open match went to the
 * better seed, by match ID and slot.
 */
function reseed(nodes: BracketNode[], input: SingleElimInput): Map<string, [TeamId | undefined, TeamId | undefined]> {
  const seedOf = new Map(input.seeds.map((id, i) => [id, i]))
  const roundNodes = (round: number) => nodes.filter((n) => n.side === 'main' && n.round === round)
  for (let round = 1; roundNodes(round).length > 0; round++) {
    const resolved = resolveBracket(nodes, input.seeds, input.results, input.scoring)
    const previous = roundNodes(round - 1)
    const survivors = previous.map((n) => resolved.winnerOf(n.id))
    if (!survivors.every((o) => o.kind === 'team')) {
      // Assume the better seed wins each open match, to place those already through.
      const known = new Set(survivors.flatMap((o) => (o.kind === 'team' ? [o.teamId] : [])))
      const assumed = previous.map((n, i) => {
        const o = survivors[i]
        if (o.kind === 'team') return o.teamId
        const match = resolved.matches.find((m) => m.id === n.id)
        const teams = match?.slots.map((s) => s.teamId).filter((id): id is TeamId => !!id) ?? []
        return teams.length === 2 ? teams.sort((a, b) => seedOf.get(a)! - seedOf.get(b)!)[0] : null
      })
      const expected = new Map<string, [TeamId | undefined, TeamId | undefined]>()
      if (assumed.some((id) => id === null) || known.size === 0) return expected
      const order = (assumed as TeamId[]).sort((a, b) => seedOf.get(a)! - seedOf.get(b)!)
      roundNodes(round).forEach((node, i) => {
        const pair = [order[i], order[order.length - 1 - i]].map((id) => (known.has(id) ? id : undefined))
        expected.set(node.id, pair as [TeamId | undefined, TeamId | undefined])
      })
      return expected
    }
    const order = survivors.map((o) => seedOf.get((o as { teamId: string }).teamId)!).sort((a, b) => a - b)
    roundNodes(round).forEach((node, i) => {
      node.sources = [
        { kind: 'seed', index: order[i] },
        { kind: 'seed', index: order[order.length - 1 - i] },
      ]
    })
  }
  return new Map()
}

export function computeSingleElim(input: SingleElimInput): EliminationState {
  const { seeds, config, results, randomSeed = 0, scoring } = input
  validateSeeds(seeds, 2, 'Single elimination')
  const nodes = buildSingleElim(seeds.length, config, randomSeed)
  const expected = config.reseed ? reseed(nodes, input) : new Map()
  const resolved = resolveBracket(nodes, seeds, results, scoring)
  const withExpected = (m: Match): Match => {
    const pair = expected.get(m.id)
    if (!pair) return m
    return { ...m, slots: m.slots.map((s, i) => (s.teamId === null && pair[i] ? { ...s, expected: pair[i] } : s)) as Match['slots'] }
  }
  return {
    matches: resolved.matches.map(withExpected),
    ranking: rankBracket(nodes, resolved, seeds),
    places: finishedPlaces(nodes, resolved, seeds),
    complete: isComplete(resolved.matches),
  }
}
