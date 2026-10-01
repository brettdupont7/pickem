import type { GameRules, GameScoring, Terms } from '../types'

export const FREE_SCORING: GameScoring = { kind: 'free' }

export const DEFAULT_TERMS: Terms = { game: 'Game', games: 'Games', point: 'Point', points: 'Points' }

export const termsFor = (rules?: GameRules): Terms => ({ ...DEFAULT_TERMS, ...rules?.terms })

export type GameScoreStatus =
  | { state: 'final'; winnerSlot: 0 | 1 }
  | { state: 'in-progress' }
  | { state: 'invalid'; error: string }

const isCount = (n: number) => Number.isInteger(n) && n >= 0

/**
 * Whether a game score (in slot order) is final, still being played, or
 * impossible under the scoring rules. `inProgress` only matters for free
 * scoring, where any score could be final.
 */
export function gameScoreStatus(scoring: GameScoring, [x, y]: [number, number], inProgress = false): GameScoreStatus {
  if (!isCount(x) || !isCount(y)) return { state: 'invalid', error: 'Scores must be whole numbers of 0 or more' }

  if (scoring.kind === 'free') {
    if (inProgress || x === y) return { state: 'in-progress' }
    return { state: 'final', winnerSlot: x > y ? 0 : 1 }
  }

  const { target, overtime } = scoring
  const final = (slot: 0 | 1): GameScoreStatus => ({ state: 'final', winnerSlot: slot })
  const high = Math.max(x, y)
  const low = Math.min(x, y)
  const leader = x > y ? 0 : 1

  if (!overtime || low < target - 1) {
    if (high < target) return { state: 'in-progress' }
    if (high === target && low < target) return final(leader)
    return { state: 'invalid', error: `A game ends when a team reaches ${target}` }
  }

  // Both reached target - 1: overtime. Strip tied blocks, then look at the current one.
  const n = overtime.firstTo
  let ex = x - (target - 1)
  let ey = y - (target - 1)
  while (ex >= n - 1 && ey >= n - 1) {
    ex -= n - 1
    ey -= n - 1
  }
  if (ex < n && ey < n) return { state: 'in-progress' }
  if (ex === n && ey < n - 1) return final(0)
  if (ey === n && ex < n - 1) return final(1)
  return { state: 'invalid', error: `Not a possible overtime score` }
}

// ---------------------------------------------------------------------------
// Simulated game scores

/** Generates a final score for a game the winner was going to win anyway. */
export type GameScoreModel = (winProbability: number, rng: () => number) => { winner: number; loser: number }

/**
 * Plays a first-to game point by point. The point win rate leans slightly
 * towards the favourite, which spreads scores realistically.
 */
export function firstToScoreModel(target: number, overtime?: { firstTo: number }): GameScoreModel {
  return (winProbability, rng) => {
    const q = 0.5 + (winProbability - 0.5) * 0.3
    let a = 0
    let b = 0
    const tiedForOvertime = () => overtime !== undefined && a === target - 1 && b === target - 1
    while (a < target && b < target && !tiedForOvertime()) rng() < q ? a++ : b++
    if (overtime) {
      const n = overtime.firstTo
      while (a === b) {
        let oa = 0
        let ob = 0
        while (oa < n && ob < n && !(oa === n - 1 && ob === n - 1)) rng() < q ? oa++ : ob++
        a += oa
        b += ob
      }
    }
    return { winner: Math.max(a, b), loser: Math.min(a, b) }
  }
}

/** Two independent normal-ish scores; a tie goes to the winner by one. */
export function freeScoreModel(mean: number, spread: number): GameScoreModel {
  return (winProbability, rng) => {
    // Sum of uniforms approximates a normal distribution.
    const normal = () => (rng() + rng() + rng() + rng() - 2) * Math.sqrt(3)
    const edge = (winProbability - 0.5) * spread
    const s1 = Math.max(0, Math.round(mean + edge + normal() * spread))
    const s2 = Math.max(0, Math.round(mean - edge + normal() * spread))
    return s1 === s2 ? { winner: s1 + 1, loser: s2 } : { winner: Math.max(s1, s2), loser: Math.min(s1, s2) }
  }
}

/** The score model the rules imply, or null when scores can't be simulated. */
export function scoreModelFor(scoring: GameScoring): GameScoreModel | null {
  if (scoring.kind === 'first-to') return firstToScoreModel(scoring.target, scoring.overtime)
  return scoring.typical ? freeScoreModel(scoring.typical.mean, scoring.typical.spread) : null
}
