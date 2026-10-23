import { addTeams, linkTeam, matchTeams, slugify, takeLogo, uniqueId, uniqueName } from '../engine'
import type {
  BestOf,
  Catalog,
  DoubleElimConfig,
  EntrantSource,
  SingleElimConfig,
  Stage,
  StageId,
  SwissConfig,
  Team,
  TeamId,
  Tournament,
} from '../types'
import { majorSwiss } from './presets/cs2-major'
import { cs2Rules } from './presets/rules'

/**
 * Events copied from HLTV by the bookmarklet (hltvBookmarklet.js): the event
 * page and its grouped stages (e.g. a CS2 Major's Stage 1 and Stage 2 pages),
 * each with its formats, Swiss stage, brackets and teams, plus the current
 * Valve ranking. Built into a tournament from what HLTV states; anything it
 * doesn't state comes from the CS2 Major preset and is called out in notes.
 */

export const EVENT_FORMAT = 'pickem-hltv-event'

/** A team box under "Teams attending". */
export interface HltvSlot {
  /** Null for a slot still to be filled ("TBD"). */
  name: string | null
  /** VRS rank: at the event's start, or the latest for an upcoming event. */
  rank: number | null
  /** How the team got in, e.g. "VRS (Europe)", or the stage it qualifies from, e.g. "Stage 2". */
  from: string
  /** Set when HLTV only predicts the team, e.g. "46%" or ">99%". */
  predicted: string | null
}

export interface HltvMatch {
  team1: string | null
  team2: string | null
  /** Maps, once the match is scheduled. */
  bo: number | null
  hidden: boolean
}

export interface HltvRound {
  /** 'round1'... for single elimination; 'upperRound1', 'upperFinal', 'lowerRound1', 'consolidationFinal', 'grandFinal' for double. */
  key: string
  name: string
  matches: HltvMatch[]
}

export interface HltvBracket {
  name: string
  /** HLTV's bracket type, e.g. 'SingleElimination' or 'DoubleElimination4' (a GSL group). */
  type: string
  rounds: HltvRound[]
}

export interface HltvSwiss {
  /** Record headings in the Swiss diagram, e.g. '0:0', '1:0', ..., '3:2'. */
  titles: string[]
  /** Opening matches, as team names (null until known). */
  firstRound: (string | null)[][]
}

/** One HLTV event page. */
export interface HltvPage {
  id: string | null
  url: string
  name: string
  /** How the other pages name this one, e.g. "Stage 1" or "Stage 3 & Playoffs". */
  label: string | null
  /** Start, in ms. */
  start: number | null
  /** The Formats table: [heading, text], e.g. ['Group stage', 'Swiss Bo1\n- Elimination matches Bo3']. */
  formats: [string, string][]
  swiss: HltvSwiss[]
  brackets: HltvBracket[]
  slots: HltvSlot[]
}

export interface HltvEvent {
  format: typeof EVENT_FORMAT
  version: 1
  url: string
  copiedAt: string
  /** The Valve ranking at the time, as copied from HLTV's ranking page. */
  ranking: string | null
  /** In play order. */
  pages: HltvPage[]
}

export const isHltvEvent = (text: string) => /^\s*\{/.test(text) && text.includes(`"${EVENT_FORMAT}"`)

export function parseHltvEvent(text: string): HltvEvent {
  let event: HltvEvent
  try {
    event = JSON.parse(text)
  } catch {
    throw new Error("That event copy is incomplete. Click the bookmark on HLTV's event page again, then paste here.")
  }
  if (event?.format !== EVENT_FORMAT || event.version !== 1 || !Array.isArray(event.pages) || event.pages.length === 0)
    throw new Error("That doesn't look like an event copied from HLTV. Click the bookmark on HLTV's event page, then paste here.")
  return event
}

export interface EventImport {
  tournament: Tournament
  /** Everything worth knowing about the result: predictions, placeholders, assumptions. */
  notes: string[]
  /** The notes about teams only (for updating an existing tournament's teams). */
  teamNotes: string[]
}

class Unsupported extends Error {}

const bestOfIn = (text: string | undefined): BestOf | undefined => {
  const n = Number(text?.match(/\bBo(\d+)\b/i)?.[1])
  return n > 0 ? n : undefined
}

/** The most common value, or undefined for none. */
const mostCommon = (values: (number | null)[]): number | undefined => {
  const counts = new Map<number, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/** The Formats text for a format, e.g. 'Swiss Bo1\n- Progression matches Bo3'. */
const formatText = (page: HltvPage, format: RegExp) => page.formats.find(([, text]) => format.test(text))?.[1]

/** Drops keys whose value is undefined, so configs stay tidy. */
const tidy = <T extends object>(config: T): T => Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) as T

const numberIn = (percent: string) => Number(percent.replace(/[^\d.]/g, ''))

const pageTitle = (page: HltvPage) => page.label ?? page.name

/** The Swiss rules HLTV states: record limits from the diagram, best-ofs from Formats. */
function swissConfig(page: HltvPage, swiss: HltvSwiss, assumed: string[]): SwissConfig {
  const records = swiss.titles.map((t) => t.match(/^(\d+)\s*:\s*(\d+)$/)).filter((m): m is RegExpMatchArray => !!m)
  const wins = Math.max(0, ...records.map((m) => Number(m[1])))
  const losses = Math.max(0, ...records.map((m) => Number(m[2])))
  if (wins < 1 || losses < 1) throw new Unsupported(`${pageTitle(page)}: HLTV's Swiss diagram doesn't show the win and loss limits.`)
  const lines = formatText(page, /^swiss/i)?.split('\n') ?? []
  const bestOf = bestOfIn(lines[0])
  if (!bestOf) assumed.push(`${pageTitle(page)}: HLTV doesn't list the best-of, so it uses the CS2 Major's (Bo1, Bo3 when advancement or elimination is on the line).`)
  const base = bestOf ?? majorSwiss.bestOf
  const advancement = bestOf ? bestOfIn(lines.find((l) => /progression|advancement|advancing/i.test(l))) : majorSwiss.advancementBestOf
  const elimination = bestOf ? bestOfIn(lines.find((l) => /elimination/i.test(l))) : majorSwiss.eliminationBestOf
  return tidy({
    ...majorSwiss,
    winsToAdvance: wins,
    lossesToEliminate: losses,
    bestOf: base,
    advancementBestOf: advancement !== base ? advancement : undefined,
    eliminationBestOf: elimination !== base ? elimination : undefined,
  })
}

/** Single elimination: size and round names from the bracket, best-ofs from scheduled matches or Formats. */
function singleElimConfig(page: HltvPage, bracket: HltvBracket, thirdPlaceMatch: boolean): { config: SingleElimConfig; size: number } {
  const rounds = bracket.rounds
  const lines = formatText(page, /^single elim/i)?.split('\n') ?? []
  const base = bestOfIn(lines[0]) ?? mostCommon(rounds.flatMap((r) => r.matches.map((m) => m.bo))) ?? 3
  // "- Grand final Bo5" applies to the round named "Grand final".
  const lineFor = (round: HltvRound) => lines.slice(1).find((l) => round.name && l.toLowerCase().includes(round.name.toLowerCase()))
  const fromFinal = [...rounds].reverse().map((r) => mostCommon(r.matches.map((m) => m.bo)) ?? bestOfIn(lineFor(r)) ?? base)
  let keep = fromFinal.length
  while (keep > 0 && fromFinal[keep - 1] === base) keep--
  const names = [...rounds].reverse().map((r) => r.name)
  return {
    size: (rounds[0]?.matches.length ?? 0) * 2,
    config: tidy({
      format: 'single-elim',
      bestOf: base,
      bestOfFromFinal: keep ? fromFinal.slice(0, keep) : undefined,
      roundNamesFromFinal: names.every(Boolean) ? names : undefined,
      seeding: 'standard',
      thirdPlaceMatch,
    }),
  }
}

/** A GSL group: 4-team double elimination where the winners' match decides 1st and the decider 2nd. */
function gslConfig(page: HltvPage, group: HltvBracket, drawn: boolean): DoubleElimConfig {
  const round = (key: string) => group.rounds.find((r) => r.key === key)
  const lines = formatText(page, /^(gsl|double elim)/i)?.split('\n') ?? []
  const bestOf = mostCommon(group.rounds.flatMap((r) => r.matches.map((m) => m.bo))) ?? bestOfIn(lines[0]) ?? 3
  const grandFinal = round('grandFinal')
  const names = (...keys: string[]) => {
    const list = keys.map((k) => round(k)?.name ?? '')
    return list.every(Boolean) ? list : undefined
  }
  return tidy({
    format: 'double-elim',
    bestOf,
    upperRoundNamesFromFinal: names('upperFinal', 'upperRound1'),
    lowerRoundNamesFromFinal: names('consolidationFinal', 'lowerRound1'),
    seeding: drawn ? 'as-listed' : 'standard',
    finals: !grandFinal || grandFinal.matches.every((m) => m.hidden) ? 'no-grand-final' : 'grand-final',
    grandFinalReset: false,
  })
}

/** A page's structure: its first stages (Swiss or groups) and its playoffs. */
interface PagePlan {
  page: HltvPage
  swiss?: HltvSwiss
  groups: HltvBracket[]
  playoffs?: HltvBracket
  thirdPlace: boolean
}

function planPage(page: HltvPage): PagePlan {
  const single = page.brackets.filter((b) => b.type === 'SingleElimination')
  const matchCount = (b: HltvBracket) => b.rounds.reduce((n, r) => n + r.matches.length, 0)
  const third =
    single.find((b) => /3rd|third/i.test(b.name)) ?? (single.length > 1 ? single.find((b) => matchCount(b) === 1) : undefined)
  const playoffs = single.filter((b) => b !== third)
  const groups = page.brackets.filter((b) => b.type === 'DoubleElimination4')
  const other = page.brackets.find((b) => b.type !== 'SingleElimination' && b.type !== 'DoubleElimination4')
  const title = pageTitle(page)
  if (other) throw new Unsupported(`${title}: HLTV's "${other.name || other.type}" bracket (${other.type}) isn't supported yet.`)
  if (page.swiss.length > 1) throw new Unsupported(`${title} has more than one Swiss stage, which isn't supported yet.`)
  if (page.swiss.length && groups.length) throw new Unsupported(`${title} has both a Swiss stage and groups, which isn't supported yet.`)
  if (playoffs.length > 1) throw new Unsupported(`${title} has more than one playoff bracket, which isn't supported yet.`)
  if (!page.swiss.length && !groups.length && !playoffs.length) {
    const formats = page.formats.map(([h, t]) => `${h}: ${t.replace(/\n/g, ' ')}`).join('; ')
    throw new Unsupported(
      formats
        ? `${title}: HLTV lists the format as "${formats}", but shows no Swiss stage or bracket the import can read.`
        : `${title}: HLTV doesn't show this stage's format yet.`,
    )
  }
  return {
    page,
    swiss: page.swiss[0],
    groups,
    playoffs: playoffs[0],
    thirdPlace: !!third || page.formats.some(([h, t]) => /3rd place/i.test(`${h} ${t}`)),
  }
}

/** Builds a tournament from an HLTV event: stages, formats, teams (seeded by VRS rank) and VRS ratings. */
export function buildFromHltvEvent(event: HltvEvent, vrs: Catalog | null): EventImport {
  let plans: PagePlan[]
  try {
    plans = event.pages.map(planPage)
  } catch (e) {
    if (e instanceof Unsupported) throw new Error(`Can't build this event yet. ${e.message}`)
    throw e
  }
  const pages = plans.map((p) => p.page)
  const name = [...pages].sort((a, b) => a.name.length - b.name.length)[0].name || 'HLTV event'
  const designNotes: string[] = []
  const teamNotes: string[] = []

  let tournament: Tournament = { id: `${slugify(name)}-hltv`, name, teams: {}, stages: [], rules: structuredClone(cs2Rules) }
  const stageIds = new Set<StageId>()
  const newStageId = (stageName: string) => {
    const id = uniqueId(slugify(stageName), stageIds)
    stageIds.add(id)
    return id
  }

  // Which page a slot qualifies from, by the label the pages use for each other ("Stage 2").
  const labelKey = (s: string) => s.toLowerCase().replace(/\s*&\s*playoffs\s*$/, '').trim()
  const sourcePage = (slot: HltvSlot, self: number) => {
    const i = pages.findIndex((p, n) => n !== self && p.label && labelKey(p.label) === labelKey(slot.from))
    return i < 0 ? undefined : i
  }
  // The stage each page's teams leave from, for later pages to draw on.
  const finalStage: (StageId | undefined)[] = []

  let placeholders = 0
  const placeholder = (from: string): TeamId => {
    placeholders++
    const label = from.replace(/[()]/g, '').trim()
    const teamName = uniqueName(label ? `TBD · ${label}` : 'TBD', Object.values(tournament.teams).map((t) => t.name))
    const added = addTeams(tournament, [teamName])
    tournament = added.tournament
    return added.ids[0]
  }

  const predictions: { name: string; chance: string }[] = []
  let phase = 0
  plans.forEach((plan, index) => {
    const { page } = plan
    const base = page.label ? page.label.replace(/\s*&\s*playoffs\s*$/i, '').trim() : ''

    // Entrants: invited teams by VRS rank, then open invites, then places from earlier stages.
    const invited = page.slots
      .filter((s) => s.name && sourcePage(s, index) === undefined)
      .map((s, order) => ({ ...s, order }))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.order - b.order)
    for (const s of invited) if (s.predicted) predictions.push({ name: s.name!, chance: s.predicted })
    const added = addTeams(
      tournament,
      invited.map((s) => s.name!),
    )
    tournament = added.tournament
    const entrants: EntrantSource[] = added.ids.map((teamId) => ({ kind: 'team', teamId }))
    // HLTV lists an open slot per invite as "TBD"; predicted teams fill some of them.
    const open = page.slots.filter((s) => !s.name && sourcePage(s, index) === undefined)
    const unfilled = open.length - invited.filter((s) => s.predicted).length
    for (const s of open.slice(open.length - Math.max(0, unfilled))) entrants.push({ kind: 'team', teamId: placeholder(s.from) })
    const qualifierCounts = new Map<number, number>()
    for (const s of page.slots) {
      const from = sourcePage(s, index)
      if (from !== undefined) qualifierCounts.set(from, (qualifierCounts.get(from) ?? 0) + 1)
    }
    for (const [from, count] of qualifierCounts) {
      const stageId = finalStage[from]
      for (let place = 1; place <= count; place++) {
        if (stageId) entrants.push({ kind: 'placement', stageId, place })
        else entrants.push({ kind: 'team', teamId: placeholder(pageTitle(pages[from])) })
      }
    }

    const stages: Stage[] = []
    let first: StageId[] = []
    if (plan.swiss) {
      const config = swissConfig(page, plan.swiss, designNotes)
      const stageName = base || page.formats.find(([, t]) => /^swiss/i.test(t))?.[0] || 'Swiss stage'
      const expected = plan.swiss.firstRound.length * 2
      while (expected && entrants.length < expected) entrants.push({ kind: 'team', teamId: placeholder('') })
      if (expected && entrants.length > expected)
        teamNotes.push(`${stageName}: HLTV lists ${entrants.length} teams for a ${expected}-team Swiss stage; all were entered.`)
      const id = newStageId(stageName)
      stages.push({ id, name: stageName, phase, config, entrants })
      first = [id]
    } else if (plan.groups.length) {
      const named = new Map(
        entrants.flatMap((e) => (e.kind === 'team' ? [[tournament.teams[e.teamId].name.toLowerCase(), e] as const] : [])),
      )
      const opening = (g: HltvBracket) => g.rounds.find((r) => r.key === 'upperRound1')?.matches.flatMap((m) => [m.team1, m.team2]) ?? []
      const drawn = plan.groups.every((g) => {
        const teams = opening(g)
        return teams.length === 4 && teams.every((t) => t && named.has(t.toLowerCase()))
      })
      // Undrawn groups take teams in seed order, snaking: A B B A A B B A...
      const groupEntrants: EntrantSource[][] = plan.groups.map(() => [])
      if (drawn) plan.groups.forEach((g, i) => (groupEntrants[i] = opening(g).map((t) => named.get(t!.toLowerCase())!)))
      else {
        const n = plan.groups.length
        entrants.forEach((e, i) => {
          const lap = Math.floor(i / n)
          groupEntrants[lap % 2 ? n - 1 - (i % n) : i % n].push(e)
        })
        designNotes.push(`${pageTitle(page)}: the groups aren't drawn yet, so teams are split by VRS rank, snaking between groups.`)
      }
      plan.groups.forEach((g, i) => {
        const stageName = g.name || `Group ${String.fromCharCode(65 + i)}`
        const id = newStageId(stageName)
        stages.push({ id, name: stageName, phase, config: gslConfig(page, g, drawn), entrants: groupEntrants[i] })
        first.push(id)
      })
    }

    if (plan.playoffs) {
      const { config, size } = singleElimConfig(page, plan.playoffs, plan.thirdPlace)
      const stageName = !plan.playoffs.name || /bracket/i.test(plan.playoffs.name) ? 'Playoffs' : plan.playoffs.name
      let playoffEntrants: EntrantSource[]
      if (first.length) {
        const perStage = size / first.length
        if (!Number.isInteger(perStage) || perStage < 1)
          throw new Error(`Can't build this event yet. ${pageTitle(page)}: ${size} playoff teams can't come evenly from ${first.length} groups.`)
        playoffEntrants = Array.from({ length: perStage }, (_, p) =>
          first.map((stageId): EntrantSource => ({ kind: 'placement', stageId, place: p + 1 })),
        ).flat()
      } else {
        playoffEntrants = entrants
        while (playoffEntrants.length < size) playoffEntrants.push({ kind: 'team', teamId: placeholder('') })
      }
      const id = newStageId(stageName)
      stages.push({ id, name: stageName, phase: first.length ? phase + 1 : phase, config, entrants: playoffEntrants })
      finalStage[index] = id
    } else finalStage[index] = first.length === 1 ? first[0] : undefined

    tournament = { ...tournament, stages: [...tournament.stages, ...stages] }
    phase = Math.max(...stages.map((s) => s.phase)) + 1
  })

  if (plans.some((p) => p.swiss) && !/major/i.test(name))
    designNotes.push("Swiss pairing and tiebreakers follow Valve's Major rules, since HLTV doesn't list them. Check them under Design.")

  // Ratings: current VRS points.
  const real = Object.values(tournament.teams).filter((t) => !t.name.startsWith('TBD'))
  if (vrs) {
    const matched = matchTeams(real, vrs)
    for (const [teamId, entry] of matched) if (entry) tournament = linkTeam(tournament, teamId, entry, vrs)
    const missing = real.filter((t) => !matched.get(t.id))
    if (missing.length) teamNotes.push(`Not in the VRS ranking, so no rating: ${missing.map((t) => t.name).join(', ')}.`)
  } else if (real.length) teamNotes.push('No VRS ranking was copied, so teams have no ratings. Import VRS, then use Link teams to VRS.')

  if (predictions.length) {
    const unsure = [...predictions].sort((a, b) => numberIn(a.chance) - numberIn(b.chance)).slice(0, 3)
    teamNotes.unshift(
      `${predictions.length} invited ${predictions.length === 1 ? 'team is' : 'teams are'} HLTV's prediction, not confirmed yet ` +
        `(least likely: ${unsure.map((p) => `${p.name} ${p.chance}`).join(', ')}). Copy the event again later to update them.`,
    )
  }
  if (placeholders)
    teamNotes.push(`${placeholders} ${placeholders === 1 ? 'slot has' : 'slots have'} no team yet, so ${placeholders === 1 ? "it's a placeholder" : "they're placeholders"} named TBD.`)

  return { tournament, notes: [...teamNotes, ...designNotes], teamNotes }
}

/** A stage's invited-team slots in seed order. */
const invitedSlots = (stage: Stage) => stage.entrants.flatMap((e) => (e.kind === 'team' ? [e.teamId] : []))

/** Stages with invited teams, in play order. */
const invitingStages = (tournament: Tournament) =>
  tournament.stages
    .map((stage, order) => ({ stage, order }))
    .sort((a, b) => a.stage.phase - b.stage.phase || a.order - b.order)
    .map(({ stage }) => stage)
    .filter((stage) => invitedSlots(stage).length > 0)

/**
 * Puts the event's teams into an existing tournament's invited slots, stage
 * by stage in play order, keeping its design. Each slot's team keeps its ID
 * (so picks stay with the slot) and takes the event team's name and rating.
 */
export function updateTeamsFromHltv(tournament: Tournament, event: HltvEvent, vrs: Catalog | null): EventImport {
  const built = buildFromHltvEvent(event, vrs)
  const from = invitingStages(built.tournament)
  const to = invitingStages(tournament)
  const counts = (stages: Stage[]) => stages.map((s) => invitedSlots(s).length)
  const describe = (stages: Stage[]) => stages.map((s) => `${s.name} ${invitedSlots(s).length}`).join(', ')
  if (from.length !== to.length || counts(from).some((n, i) => n !== counts(to)[i]))
    throw new Error(
      `The teams don't line up: this tournament invites ${describe(to) || 'no teams'}, but the event invites ${describe(from)}. ` +
        'Create a new tournament from the event instead.',
    )
  const teams = { ...tournament.teams }
  let changed = 0
  from.forEach((stage, i) => {
    const target = invitedSlots(to[i])
    invitedSlots(stage).forEach((sourceId, j) => {
      const source: Team = built.tournament.teams[sourceId]
      const old = teams[target[j]]
      const same = old.name === source.name
      if (!same) changed++
      const team = tidy({
        id: old.id,
        name: source.name,
        shortName: same ? old.shortName : undefined,
        logoUrl: same ? old.logoUrl : undefined,
        logoUrlLight: same ? old.logoUrlLight : undefined,
        rating: source.rating ?? (same ? old.rating : undefined),
        ratingSource: source.ratingSource ?? (same ? old.ratingSource : undefined),
      })
      teams[old.id] = takeLogo(team, source)
    })
  })
  const total = to.reduce((n, s) => n + invitedSlots(s).length, 0)
  return {
    tournament: { ...tournament, teams },
    notes: [`Updated ${total} invited teams (${changed} changed).`, ...built.teamNotes],
    teamNotes: built.teamNotes,
  }
}
