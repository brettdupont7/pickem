import type { SingleElimConfig } from '../../types'
import {
  bestOfFromFinal,
  bracketSize,
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

/** Pairs each reseeded round, best remaining seed v worst, once the round before it is decided. */
function reseed(nodes: BracketNode[], input: SingleElimInput) {
  const seedOf = new Map(input.seeds.map((id, i) => [id, i]))
  const roundNodes = (round: number) => nodes.filter((n) => n.side === 'main' && n.round === round)
  for (let round = 1; roundNodes(round).length > 0; round++) {
    const resolved = resolveBracket(nodes, input.seeds, input.results, input.scoring)
    const survivors = roundNodes(round - 1).map((n) => resolved.winnerOf(n.id))
    if (!survivors.every((o) => o.kind === 'team')) return
    const order = survivors.map((o) => seedOf.get((o as { teamId: string }).teamId)!).sort((a, b) => a - b)
    roundNodes(round).forEach((node, i) => {
      node.sources = [
        { kind: 'seed', index: order[i] },
        { kind: 'seed', index: order[order.length - 1 - i] },
      ]
    })
  }
}

export function computeSingleElim(input: SingleElimInput): EliminationState {
  const { seeds, config, results, randomSeed = 0, scoring } = input
  validateSeeds(seeds, 2, 'Single elimination')
  const nodes = buildSingleElim(seeds.length, config, randomSeed)
  if (config.reseed) reseed(nodes, input)
  const resolved = resolveBracket(nodes, seeds, results, scoring)
  return {
    matches: resolved.matches,
    ranking: rankBracket(nodes, resolved, seeds),
    complete: isComplete(resolved.matches),
  }
}
