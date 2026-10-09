import type {
  BracketPickemCard,
  Match,
  MatchReport,
  MatchId,
  PickemCard,
  Stage,
  SwissConfig,
  SwissPickemCard,
  TeamId,
  Tournament,
} from '../types'
import { computeStageIn, type ComputedStage } from './tournament'

/**
 * Pick'em challenge cards, scored against actual results, as in Valve's
 * Major Pick'em. Swiss stages: teams to go undefeated, to advance with a
 * loss, and to go winless. Elimination stages: the winner of each match.
 */

export type SwissPickCategory = 'undefeated' | 'advance' | 'winless'
export const SWISS_PICK_CATEGORIES: SwissPickCategory[] = ['undefeated', 'advance', 'winless']

/** Whether a pick has come true, can't any more, or is still open. */
export type PickStatus = 'correct' | 'wrong' | 'pending'

export interface PickemScore {
  correct: number
  wrong: number
  pending: number
  /** Picks on the card. */
  total: number
  /** Correct picks needed to pass the stage: half the picks a full card holds, rounded up. */
  needed: number
}

/** Short labels for the categories, from the stage's win and loss targets: "3-0", "3-1 / 3-2", "0-3". */
export function categoryLabels(config: SwissConfig): Record<SwissPickCategory, string> {
  const { winsToAdvance: w, lossesToEliminate: l } = config
  const advance = Array.from({ length: Math.max(0, l - 1) }, (_, i) => `${w}-${i + 1}`)
  return {
    undefeated: `${w}-0`,
    advance: advance.length > 2 ? `${advance[0]} to ${advance.at(-1)}` : advance.join(' / '),
    winless: `0-${l}`,
  }
}

/**
 * How many teams a full card picks in each category: as many as would go
 * undefeated, advance with a loss, or go winless if every record group
 * split evenly. For 16 teams, 3 wins to advance and 3 losses out: 2, 6, 2.
 */
export function swissPickCounts(config: SwissConfig, teamCount: number): Record<SwissPickCategory, number> {
  const { winsToAdvance: w, lossesToEliminate: l } = config
  // Expected teams at each record, spreading every group's teams evenly.
  let groups = new Map<string, number>([['0-0', teamCount]])
  let advanced = 0
  for (let round = 0; round < w + l - 1; round++) {
    const next = new Map<string, number>()
    for (const [key, count] of groups) {
      const [wins, losses] = key.split('-').map(Number)
      for (const [nw, nl] of [
        [wins + 1, losses],
        [wins, losses + 1],
      ]) {
        if (nw === w) advanced += count / 2
        else if (nl < l) next.set(`${nw}-${nl}`, (next.get(`${nw}-${nl}`) ?? 0) + count / 2)
      }
    }
    groups = next
  }
  const undefeated = Math.floor(teamCount / 2 ** w)
  const winless = Math.floor(teamCount / 2 ** l)
  return { undefeated, advance: Math.max(0, Math.round(advanced) - undefeated), winless }
}

export const emptySwissCard = (): SwissPickemCard => ({ kind: 'swiss', undefeated: [], advance: [], winless: [] })
export const emptyBracketCard = (): BracketPickemCard => ({ kind: 'bracket', winners: {} })

/** Whether a stage has started for real: it has an actual result that isn't a bye. */
export function stageStarted(actual: ComputedStage | undefined): boolean {
  return !!actual?.matches.some((m) => m.result && m.result.source === 'actual')
}

/** Whether a card can be edited: before its stage starts, or once unlocked. */
export const cardEditable = (card: PickemCard | undefined, actual: ComputedStage | undefined) => !stageStarted(actual) || !!card?.unlocked

/** The category a team is picked in, if any. */
export function categoryOf(card: SwissPickemCard, teamId: TeamId): SwissPickCategory | null {
  return SWISS_PICK_CATEGORIES.find((c) => card[c].includes(teamId)) ?? null
}

/**
 * Moves a team into a category (or out of every category with null).
 * Does nothing if the category is already full.
 */
export function pickSwiss(
  card: SwissPickemCard,
  teamId: TeamId,
  category: SwissPickCategory | null,
  counts: Record<SwissPickCategory, number>,
): SwissPickemCard {
  const without = Object.fromEntries(SWISS_PICK_CATEGORIES.map((c) => [c, card[c].filter((id) => id !== teamId)])) as Record<
    SwissPickCategory,
    TeamId[]
  >
  if (category && without[category].length >= counts[category]) return card
  if (category) without[category] = [...without[category], teamId]
  return { ...card, ...without }
}

/** Whether a Swiss pick has come true, given the team's actual record. */
export function swissPickStatus(category: SwissPickCategory, config: SwissConfig, record: { wins: number; losses: number } | undefined): PickStatus {
  if (!record) return 'pending'
  const { winsToAdvance: w, lossesToEliminate: l } = config
  const { wins, losses } = record
  switch (category) {
    case 'undefeated':
      return losses > 0 ? 'wrong' : wins >= w ? 'correct' : 'pending'
    case 'winless':
      return wins > 0 ? 'wrong' : losses >= l ? 'correct' : 'pending'
    case 'advance':
      if (losses >= l || (wins >= w && losses === 0)) return 'wrong'
      return wins >= w ? 'correct' : 'pending'
  }
}

const tally = (statuses: PickStatus[], needed: number): PickemScore => ({
  correct: statuses.filter((s) => s === 'correct').length,
  wrong: statuses.filter((s) => s === 'wrong').length,
  pending: statuses.filter((s) => s === 'pending').length,
  total: statuses.length,
  needed,
})

/** Scores a Swiss card against the stage's actual standings. */
export function scoreSwissCard(card: SwissPickemCard, config: SwissConfig, actual: ComputedStage | undefined, teamCount: number): PickemScore {
  const counts = swissPickCounts(config, teamCount)
  const statuses = SWISS_PICK_CATEGORIES.flatMap((c) => card[c].map((id) => swissPickStatus(c, config, actual?.swiss?.standings[id])))
  return tally(statuses, Math.ceil((counts.undefeated + counts.advance + counts.winless) / 2))
}

/** The matches a bracket card picks: every match that isn't a bye. */
export const pickableMatches = (computed: ComputedStage) => computed.matches.filter((m) => !m.slots.some((s) => s.isBye))

/**
 * The stage as the card has it: its actual seeds, with the card's winners
 * as results, so later rounds hold the teams picked to get there.
 */
export function bracketAsPicked(
  tournament: Tournament,
  stage: Stage,
  earlier: Record<string, ComputedStage>,
  card: BracketPickemCard,
): ComputedStage {
  const results: Record<MatchId, MatchReport> = Object.fromEntries(
    Object.entries(card.winners).map(([matchId, winnerId]) => [matchId, { source: 'pick', winnerId }]),
  )
  return computeStageIn(tournament, stage, earlier, results)
}

/** Drops winners that no longer play their match, e.g. after an earlier pick changed. */
export function cleanBracketCard(card: BracketPickemCard, picked: ComputedStage): BracketPickemCard {
  const winners: Record<MatchId, TeamId> = {}
  for (const m of picked.matches) {
    const winner = card.winners[m.id]
    if (winner && m.slots.some((s) => s.teamId === winner)) winners[m.id] = winner
  }
  return { ...card, winners }
}

/**
 * Whether a bracket pick has come true: right once the actual match goes
 * the picked team's way, wrong once it doesn't or the team is knocked out
 * before getting there.
 */
export function bracketPickStatus(matchId: MatchId, winner: TeamId, actual: ComputedStage | undefined): PickStatus {
  const match = actual?.matches.find((m) => m.id === matchId)
  if (match?.result) return match.result.winnerId === winner ? 'correct' : 'wrong'
  // Both teams are set and the pick isn't one of them.
  if (match?.slots.every((s) => s.teamId) && !match.slots.some((s) => s.teamId === winner)) return 'wrong'
  return knockedOut(winner, actual) ? 'wrong' : 'pending'
}

/** Whether a team has lost a match that sends it out of the stage. */
function knockedOut(teamId: TeamId, actual: ComputedStage | undefined): boolean {
  return !!actual?.matches.some(
    (m: Match) => m.result && m.result.winnerId !== teamId && m.slots.some((s) => s.teamId === teamId) && !m.loserTo,
  )
}

/** Scores a bracket card against the stage's actual results. */
export function scoreBracketCard(card: BracketPickemCard, actual: ComputedStage | undefined, matchCount: number): PickemScore {
  const statuses = Object.entries(card.winners).map(([matchId, winner]) => bracketPickStatus(matchId, winner, actual))
  return tally(statuses, Math.ceil(matchCount / 2))
}

/**
 * A Swiss card filled from where picks (or simulations) have each team
 * finishing. Teams still playing are left out.
 */
export function swissCardFromResults(config: SwissConfig, computed: ComputedStage, counts: Record<SwissPickCategory, number>): SwissPickemCard {
  let card = emptySwissCard()
  for (const id of computed.ranking) {
    const record = computed.swiss?.standings[id]
    const category = SWISS_PICK_CATEGORIES.find((c) => swissPickStatus(c, config, record) === 'correct')
    if (category) card = pickSwiss(card, id, category, counts)
  }
  return card
}

/** A bracket card filled from the winners in picks (or simulations). */
export function bracketCardFromResults(computed: ComputedStage): BracketPickemCard {
  const winners: Record<MatchId, TeamId> = {}
  for (const m of pickableMatches(computed)) if (m.result) winners[m.id] = m.result.winnerId
  return { kind: 'bracket', winners }
}
