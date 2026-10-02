import type { DoubleElimConfig } from '../../types'
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

export type DoubleElimInput = EliminationInput<DoubleElimConfig>

export const upperMatchId = (round: number, index: number) => `u${round}-${index}`
export const lowerMatchId = (round: number, index: number) => `l${round}-${index}`
export const GRAND_FINAL_ID = 'grand-final'
export const GRAND_FINAL_RESET_ID = 'grand-final-reset'

function upperLabel(roundsFromFinal: number, round: number, names?: string[]) {
  if (names?.[roundsFromFinal]) return names[roundsFromFinal]
  if (roundsFromFinal === 0) return 'Upper final'
  if (roundsFromFinal === 1) return 'Upper semi-finals'
  if (roundsFromFinal === 2) return 'Upper quarter-finals'
  return `Upper round ${round + 1}`
}

/**
 * Builds the bracket structure for 2^k slots:
 * - upper: k rounds
 * - lower: 2(k - 1) rounds. Even rounds pair lower-bracket survivors (round 0
 *   pairs upper round 0's losers); odd rounds bring in the losers of the
 *   next upper round, in reverse order to delay rematches. When the upper
 *   final decides 1st and 2nd, its loser doesn't drop, so the last round
 *   (where it would join) is left out.
 * - grand final, unless `finals` says otherwise: upper winner (slot 0) v
 *   lower winner (slot 1)
 * The reset match isn't part of the structure; see `computeDoubleElim`.
 */
export function buildDoubleElim(teamCount: number, config: DoubleElimConfig, randomSeed = 0): BracketNode[] {
  const size = bracketSize(teamCount)
  const finals = config.finals ?? 'grand-final'
  const upperRounds = Math.log2(size)
  const lowerRounds = 2 * (upperRounds - 1) - (finals === 'upper-final-decides' ? 1 : 0)
  const slots = firstRoundSlots(teamCount, config.seeding, randomSeed)
  const nodes: BracketNode[] = []

  // Upper losers drop, so upper tiers only rank the upper final when its
  // loser stays put. Lower round r's losers get tier r.
  for (let round = 0; round < upperRounds; round++) {
    const fromFinal = upperRounds - 1 - round
    const count = size / 2 ** (round + 1)
    for (let i = 0; i < count; i++) {
      nodes.push({
        id: upperMatchId(round, i),
        side: 'upper',
        round,
        label: upperLabel(fromFinal, round, config.upperRoundNamesFromFinal),
        bestOf: bestOfFromFinal(config.bestOf, config.upperBestOfFromFinal, fromFinal),
        sources:
          round === 0
            ? [slotSource(slots[2 * i]), slotSource(slots[2 * i + 1])]
            : [
                { kind: 'winner', matchId: upperMatchId(round - 1, 2 * i) },
                { kind: 'winner', matchId: upperMatchId(round - 1, 2 * i + 1) },
              ],
        ...(fromFinal === 0 ? upperFinalTiers(finals, lowerRounds) : { tier: 0 }),
      })
    }
  }

  let count = size / 4
  for (let round = 0; round < lowerRounds; round++) {
    const fromFinal = lowerRounds - 1 - round
    const dropRound = round % 2 === 1
    if (round > 0 && !dropRound) count /= 2
    for (let i = 0; i < count; i++) {
      let sources: BracketNode['sources']
      if (round === 0) {
        sources = [
          { kind: 'loser', matchId: upperMatchId(0, 2 * i) },
          { kind: 'loser', matchId: upperMatchId(0, 2 * i + 1) },
        ]
      } else if (dropRound) {
        sources = [
          { kind: 'winner', matchId: lowerMatchId(round - 1, i) },
          { kind: 'loser', matchId: upperMatchId((round + 1) / 2, count - 1 - i) },
        ]
      } else {
        sources = [
          { kind: 'winner', matchId: lowerMatchId(round - 1, 2 * i) },
          { kind: 'winner', matchId: lowerMatchId(round - 1, 2 * i + 1) },
        ]
      }
      nodes.push({
        id: lowerMatchId(round, i),
        side: 'lower',
        round,
        label: config.lowerRoundNamesFromFinal?.[fromFinal] ?? (fromFinal === 0 ? 'Lower final' : `Lower round ${round + 1}`),
        bestOf: bestOfFromFinal(config.bestOf, config.lowerBestOfFromFinal, fromFinal),
        sources,
        tier: round,
        // Without a grand final, the lower winner finishes here: 2nd, or 3rd behind the upper finalists.
        winnerTier: fromFinal === 0 && finals !== 'grand-final' ? lowerRounds : undefined,
      })
    }
  }

  if (finals !== 'grand-final') return nodes
  nodes.push({
    id: GRAND_FINAL_ID,
    side: 'grand-final',
    round: 0,
    label: 'Grand final',
    bestOf: config.grandFinalBestOf ?? config.bestOf,
    sources: [
      { kind: 'winner', matchId: upperMatchId(upperRounds - 1, 0) },
      { kind: 'winner', matchId: lowerMatchId(lowerRounds - 1, 0) },
    ],
    tier: lowerRounds,
    winnerTier: lowerRounds + 0.5,
  })
  return nodes
}

/** Where the upper finalists place, when they don't meet again in a grand final. */
function upperFinalTiers(finals: NonNullable<DoubleElimConfig['finals']>, lowerRounds: number): Pick<BracketNode, 'tier' | 'winnerTier'> {
  switch (finals) {
    case 'grand-final':
      return { tier: 0 }
    case 'no-grand-final':
      return { tier: 0, winnerTier: lowerRounds + 1 }
    case 'upper-final-decides':
      return { tier: lowerRounds + 1, winnerTier: lowerRounds + 2 }
  }
}

export function computeDoubleElim({ seeds, config, results, randomSeed = 0, scoring }: DoubleElimInput): EliminationState {
  validateSeeds(seeds, 3, 'Double elimination')
  const nodes = buildDoubleElim(seeds.length, config, randomSeed)
  let resolved = resolveBracket(nodes, seeds, results, scoring)

  // If the lower-bracket team wins the grand final, both teams have one
  // loss, so a reset series decides the title.
  const grandFinal = resolved.matches.at(-1)!
  if (grandFinal.id === GRAND_FINAL_ID && config.grandFinalReset && grandFinal.result && grandFinal.result.winnerId === grandFinal.slots[1].teamId) {
    const gfNode = nodes.at(-1)!
    gfNode.winnerTier = undefined
    nodes.push({
      id: GRAND_FINAL_RESET_ID,
      side: 'grand-final',
      round: 1,
      label: 'Grand final reset',
      bestOf: grandFinal.bestOf,
      sources: [
        { kind: 'loser', matchId: GRAND_FINAL_ID },
        { kind: 'winner', matchId: GRAND_FINAL_ID },
      ],
      tier: gfNode.tier + 1,
      winnerTier: gfNode.tier + 1.5,
    })
    resolved = resolveBracket(nodes, seeds, results, scoring)
  }

  return {
    matches: resolved.matches,
    ranking: rankBracket(nodes, resolved, seeds),
    places: finishedPlaces(nodes, resolved, seeds),
    complete: isComplete(resolved.matches),
  }
}
