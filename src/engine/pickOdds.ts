import type { BracketPickemCard, MatchId, PickemCard, Stage, StageId, SwissConfig, SwissPickemCard, TeamId, Tournament, TournamentResults } from '../types'
import { placementUses } from './design'
import {
  bracketAsPicked,
  emptyBracketCard,
  emptySwissCard,
  pickableMatches,
  pickSwiss,
  SWISS_PICK_CATEGORIES,
  swissPickStatus,
  type SwissPickCategory,
} from './pickem'
import { createMonteCarlo, type SimulationOptions } from './simulator'
import { placesOf, type ComputedStage } from './tournament'

/**
 * How likely picks are to come true: the rest of the event is simulated
 * from actual results many times, and each simulation's outcome is kept,
 * so any combination of picks can be checked against the same samples.
 */

/** What one simulation decided in one stage. */
export interface StageSample {
  ranking: TeamId[]
  /** Swiss only: each team's final record. */
  records?: Record<TeamId, [number, number]>
  winners: Record<MatchId, TeamId>
}

/** One entry per simulation: every stage that finished in it. */
export type OutcomeSamples = Record<StageId, StageSample>[]

/** Simulates from `actual` and keeps each simulation's outcome. Run in chunks; read `samples()` whenever. */
export function createOutcomeSampler(tournament: Tournament, actual: TournamentResults, options: SimulationOptions = {}) {
  const samples: OutcomeSamples = []
  const mc = createMonteCarlo(tournament, actual, { ...options, detail: 'winner' }, (stages) => {
    const sample: Record<StageId, StageSample> = {}
    for (const [id, s] of Object.entries(stages)) {
      if (s.status !== 'complete') continue
      sample[id] = {
        ranking: s.ranking,
        records: s.swiss && Object.fromEntries(Object.entries(s.swiss.standings).map(([team, st]) => [team, [st.wins, st.losses]])),
        winners: Object.fromEntries(s.matches.flatMap((m) => (m.result ? [[m.id, m.result.winnerId]] : []))),
      }
    }
    samples.push(sample)
  })
  return { run: (count: number) => mc.run(count), samples: () => samples }
}

/** Share of samples where `test` holds. */
const share = (samples: OutcomeSamples, test: (sample: Record<StageId, StageSample>) => boolean) =>
  samples.length ? samples.filter(test).length / samples.length : 0

// ---------------------------------------------------------------------------
// Pick'em cards

export interface CardOdds {
  /** Chance each pick comes true, keyed by `pickKey`. */
  picks: Record<string, number>
  /** Expected number of correct picks. */
  expected: number
  /** Chance of at least `needed` correct picks. */
  pass: number
  /** Swiss only: chance every pick in a group comes true, for groups with picks. */
  groups?: Partial<Record<SwissPickCategory, number>>
}

/** Key for one pick: a Swiss team in its category, or a bracket match. */
export const pickKey = (card: PickemCard, id: string) => (card.kind === 'swiss' ? `${card.kind}:${id}` : `bracket:${id}`)

type Pick = { key: string; group?: SwissPickCategory; correct: (sample: StageSample | undefined) => boolean }

function picksOf(card: PickemCard, config: Stage['config']): Pick[] {
  if (card.kind === 'bracket') {
    return Object.entries(card.winners).map(([matchId, winner]) => ({
      key: pickKey(card, matchId),
      correct: (s) => s?.winners[matchId] === winner,
    }))
  }
  const swiss = config as SwissConfig
  return SWISS_PICK_CATEGORIES.flatMap((group) =>
    card[group].map((teamId) => ({
      key: pickKey(card, teamId),
      group,
      correct: (s: StageSample | undefined) => {
        const record = s?.records?.[teamId]
        return !!record && swissPickStatus(group, swiss, { wins: record[0], losses: record[1] }) === 'correct'
      },
    })),
  )
}

/** How likely a card's picks are, from simulated outcomes of its stage. */
export function cardOdds(stage: Stage, card: PickemCard, samples: OutcomeSamples, needed: number): CardOdds {
  const picks = picksOf(card, stage.config)
  const hits = new Map<string, number>()
  const groupHits = new Map<SwissPickCategory, number>()
  let passes = 0
  let total = 0
  for (const sample of samples) {
    const s = sample[stage.id]
    const right = new Set(picks.filter((p) => p.correct(s)).map((p) => p.key))
    for (const key of right) hits.set(key, (hits.get(key) ?? 0) + 1)
    total += right.size
    if (right.size >= needed) passes++
    for (const group of SWISS_PICK_CATEGORIES) {
      const inGroup = picks.filter((p) => p.group === group)
      if (inGroup.length && inGroup.every((p) => right.has(p.key))) groupHits.set(group, (groupHits.get(group) ?? 0) + 1)
    }
  }
  const n = samples.length || 1
  const groups =
    card.kind === 'swiss'
      ? Object.fromEntries(SWISS_PICK_CATEGORIES.filter((g) => card[g].length).map((g) => [g, (groupHits.get(g) ?? 0) / n]))
      : undefined
  return {
    picks: Object.fromEntries(picks.map((p) => [p.key, (hits.get(p.key) ?? 0) / n])),
    expected: total / n,
    pass: passes / n,
    groups,
  }
}

/**
 * The card a favourites-only player would fill in: each slot goes to the
 * team likeliest to finish that way, likeliest first, one slot per team.
 */
export function favouriteSwissCard(
  stage: Stage,
  teams: TeamId[],
  counts: Record<SwissPickCategory, number>,
  samples: OutcomeSamples,
): SwissPickemCard {
  const config = stage.config as SwissConfig
  const chances = teams.flatMap((teamId) =>
    SWISS_PICK_CATEGORIES.map((group) => ({
      teamId,
      group,
      p: share(samples, (sample) => {
        const record = sample[stage.id]?.records?.[teamId]
        return !!record && swissPickStatus(group, config, { wins: record[0], losses: record[1] }) === 'correct'
      }),
    })),
  )
  let card = emptySwissCard()
  for (const { teamId, group } of chances.sort((a, b) => b.p - a.p)) {
    if (SWISS_PICK_CATEGORIES.some((g) => card[g].includes(teamId))) continue
    card = pickSwiss(card, teamId, group, counts)
  }
  return card
}

/** The bracket a favourites-only player would pick: in each match, the team likelier to win it. */
export function favouriteBracketCard(
  tournament: Tournament,
  stage: Stage,
  earlier: Record<StageId, ComputedStage>,
  samples: OutcomeSamples,
): BracketPickemCard {
  const winRate = (matchId: MatchId, teamId: TeamId) => share(samples, (sample) => sample[stage.id]?.winners[matchId] === teamId)
  let card = emptyBracketCard()
  // Each pass fills the matches whose teams the picks so far have set.
  for (let guard = 0; guard < 64; guard++) {
    const open = pickableMatches(bracketAsPicked(tournament, stage, earlier, card)).filter(
      (m) => !card.winners[m.id] && m.slots.every((s) => s.teamId),
    )
    if (!open.length) break
    const winners = { ...card.winners }
    for (const m of open) {
      const [a, b] = m.slots.map((s) => s.teamId!)
      winners[m.id] = winRate(m.id, b) > winRate(m.id, a) ? b : a
    }
    card = { ...card, winners }
  }
  return card
}

// ---------------------------------------------------------------------------
// Bracket picks

/** How likely the teams the picks send on from a stage (or the picked winner of the last one) all get there. */
export interface PickedSetOdds {
  stageId: StageId
  /** 'advance': teams picked to reach a later stage. 'win': the picked winner of the last stage. */
  kind: 'advance' | 'win'
  picked: TeamId[]
  /** Chance every picked team does it. */
  chance: number
  /** The same number of teams likeliest to do it, and the chance they all do. */
  favourites: TeamId[]
  favouritesChance: number
}

/**
 * For each stage not yet decided by actual results: the teams the picks
 * already have going through (or winning the event), and how likely that is
 * compared with picking the favourites.
 */
export function pickedSetOdds(
  tournament: Tournament,
  picked: Record<StageId, ComputedStage>,
  actual: Record<StageId, ComputedStage>,
  samples: OutcomeSamples,
): PickedSetOdds[] {
  const out: PickedSetOdds[] = []
  for (const stage of tournament.stages) {
    const real = actual[stage.id]
    const mine = picked[stage.id]
    if (!mine || real?.status === 'complete' || mine.status === 'waiting' || mine.status === 'invalid') continue
    const used = [...placementUses(tournament, stage.id).keys()]
    const kind = used.length ? 'advance' : 'win'
    const places = new Set(used.length ? used : [1])
    // Teams certain to finish in a place that goes on, given the picks so far.
    const ranges = mine.status === 'complete' ? Object.fromEntries(mine.ranking.map((id, i) => [id, [i + 1, i + 1]])) : placesOf(mine)
    const goingOn = Object.entries(ranges)
      .filter(([, [lo, hi]]) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).every((p) => places.has(p)))
      .map(([id]) => id)
    if (!goingOn.length) continue

    const goesOn = (sample: Record<StageId, StageSample>, teamId: TeamId) => {
      const i = sample[stage.id]?.ranking.indexOf(teamId) ?? -1
      return i >= 0 && places.has(i + 1)
    }
    const allGoOn = (teams: TeamId[]) => share(samples, (sample) => teams.every((id) => goesOn(sample, id)))
    // Any team could be a favourite: which teams reach a later stage can differ between simulations.
    const favourites = Object.keys(tournament.teams)
      .map((id) => ({ id, p: share(samples, (sample) => goesOn(sample, id)) }))
      .sort((a, b) => b.p - a.p)
      .slice(0, goingOn.length)
      .map((f) => f.id)
    out.push({ stageId: stage.id, kind, picked: goingOn, chance: allGoOn(goingOn), favourites, favouritesChance: allGoOn(favourites) })
  }
  return out
}
