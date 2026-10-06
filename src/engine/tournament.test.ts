import { describe, expect, it } from 'vitest'
import { cs2Major } from '../data/presets/cs2-major'
import { nflPlayoffs } from '../data/presets/nfl-playoffs'
import { groupsPlayoffs } from '../data/presets/groups-playoffs'
import type { SwissConfig, Tournament } from '../types'
import { favouriteWins, playTournament, randomWinner } from './testing'
import { simulate } from './simulator'
import { computeTournament, validateTournament } from './tournament'

/** Lower team number = stronger team. */
const allTeams = Object.keys(cs2Major.teams).sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))

describe('computeTournament', () => {
  it('starts with only the first stage playable', () => {
    const state = computeTournament(cs2Major, {})
    expect(state.stages['stage-1'].status).toBe('in-progress')
    expect(state.stages['stage-1'].matches).toHaveLength(8)
    for (const id of ['stage-2', 'stage-3', 'playoffs']) {
      expect(state.stages[id].status).toBe('waiting')
      expect(state.stages[id].seeds).toBeNull()
    }
  })

  it('plays a full CS2 Major through to a champion', () => {
    const state = playTournament(cs2Major, favouriteWins(allTeams))
    for (const stage of Object.values(state.stages)) expect(stage.status).toBe('complete')

    const stage1 = state.stages['stage-1']
    const stage2 = state.stages['stage-2']
    expect(stage2.seeds!.slice(0, 8)).toEqual(allTeams.slice(16, 24))
    expect(stage2.seeds!.slice(8)).toEqual(stage1.ranking.slice(0, 8))
    expect(state.stages['stage-3'].seeds!.slice(8)).toEqual(stage2.ranking.slice(0, 8))
    expect(state.stages.playoffs.seeds).toEqual(state.stages['stage-3'].ranking.slice(0, 8))
    expect(state.stages.playoffs.matches).toHaveLength(7)
  })

  it('finishes with random results', () => {
    for (let s = 0; s < 10; s++) {
      const state = playTournament({ ...cs2Major, randomSeed: s }, randomWinner(s))
      const champion = state.stages.playoffs.ranking[0]
      expect(state.stages.playoffs.status).toBe('complete')
      expect(cs2Major.teams[champion]).toBeDefined()
    }
  })

  it('re-seeds later stages when an earlier result changes', () => {
    const results = {}
    const before = playTournament(cs2Major, favouriteWins(allTeams), results)
    const flipped = favouriteWins([...allTeams].reverse())
    const first = before.stages['stage-1'].matches[0]
    ;(results as Record<string, Record<string, unknown>>)['stage-1'][first.id] = { winnerId: flipped(first), source: 'pick' }
    const after = computeTournament(cs2Major, results)
    expect(after.stages['stage-1'].ranking).not.toEqual(before.stages['stage-1'].ranking)
  })

  it('marks a stage invalid when it draws from a stage that comes later', () => {
    const broken: Tournament = {
      ...cs2Major,
      stages: cs2Major.stages.map((s) => (s.id === 'stage-2' ? { ...s, phase: 0 } : s)),
    }
    const state = computeTournament(broken, {})
    expect(state.stages['stage-2'].status).toBe('invalid')
    expect(state.stages['stage-2'].error).toMatch(/Stage 1/)
  })

  it('marks a stage invalid when the engine rejects it', () => {
    const tiny: Tournament = {
      ...cs2Major,
      stages: [{ ...cs2Major.stages[0], entrants: [{ kind: 'team', teamId: 'team-1' }] }],
    }
    expect(computeTournament(tiny, {}).stages['stage-1'].status).toBe('invalid')
  })
})

describe('live rating seed order', () => {
  const liveSeeded: Tournament = {
    ...cs2Major,
    stages: cs2Major.stages.map((s) =>
      s.id === 'playoffs' && s.config.format === 'single-elim' ? { ...s, config: { ...s.config, seedOrder: 'live-rating' } } : s,
    ),
  }

  it('seeds the playoffs by final Swiss live rating, highest first', () => {
    const state = playTournament(liveSeeded, randomWinner(3))
    const qualifiers = state.stages['stage-3'].ranking.slice(0, 8)
    const rating = (id: string) => state.stages['stage-3'].swiss!.standings[id].rating
    const seeds = state.stages.playoffs.seeds!
    expect([...seeds].sort()).toEqual([...qualifiers].sort())
    expect(seeds.map(rating)).toEqual([...qualifiers.map(rating)].sort((a, b) => b - a))
  })

  it('uses entrant order by default', () => {
    const state = playTournament(cs2Major, randomWinner(3))
    expect(state.stages.playoffs.seeds).toEqual(state.stages['stage-3'].ranking.slice(0, 8))
  })
})

describe('live rating start', () => {
  const withStage1 = (config: Partial<SwissConfig>, ratings: boolean): Tournament => ({
    ...cs2Major,
    teams: Object.fromEntries(
      // Ratings shuffled against seed order, so they'd pair differently from seeds.
      Object.values(cs2Major.teams).map((t, i) => [t.id, ratings ? { ...t, rating: 1000 + 10 * ((i * 7) % 16) } : t]),
    ),
    stages: cs2Major.stages.map((s) => (s.id === 'stage-1' && s.config.format === 'swiss' ? { ...s, config: { ...s.config, pairing: 'rating', ...config } } : s)),
  })
  const round2 = (t: Tournament) => {
    const results = {}
    playTournament(t, favouriteWins(allTeams), results)
    const first = computeTournament(t, {}).stages['stage-1'].matches.map((m) => m.id)
    const r1 = Object.fromEntries(Object.entries((results as Record<string, Record<string, unknown>>)['stage-1']).filter(([id]) => first.includes(id)))
    return computeTournament(t, { 'stage-1': r1 } as never).stages['stage-1'].swiss!.rounds[1].map((m) => m.id)
  }

  it('can ignore team ratings and start from seed order', () => {
    const seeded = round2(withStage1({}, false))
    expect(round2(withStage1({}, true))).not.toEqual(seeded)
    expect(round2(withStage1({ ratingStart: 'seed' }, true))).toEqual(seeded)
  })
})

describe('validateTournament', () => {
  it('accepts the CS2 Major preset', () => {
    expect(validateTournament(cs2Major)).toEqual([])
  })

  it('reports designer mistakes', () => {
    const [stage1, stage2] = cs2Major.stages
    const broken: Tournament = {
      ...cs2Major,
      stages: [
        { ...stage1, entrants: [...stage1.entrants, { kind: 'team', teamId: 'nobody' }] },
        {
          ...stage2,
          entrants: [
            { kind: 'team', teamId: 'team-1' },
            { kind: 'placement', stageId: 'stage-1', place: 1 },
            { kind: 'placement', stageId: 'stage-1', place: 1 },
            { kind: 'placement', stageId: 'stage-1', place: 99 },
            { kind: 'placement', stageId: 'missing', place: 1 },
          ],
        },
      ],
    }
    const messages = validateTournament(broken).map((i) => i.message)
    expect(messages).toEqual([
      'Unknown team "nobody"',
      'Team 1 is also entered in Stage 1',
      'Place 1 of Stage 1 is also used by Stage 2',
      'Place 99 doesn\'t exist in Stage 1 (17 teams)',
      'Draws from unknown stage "missing"',
    ])
  })
})

describe('NFL playoffs preset', () => {
  it('is valid', () => {
    expect(validateTournament(nflPlayoffs)).toEqual([])
  })

  it('gives each 1 seed a bye and crowns a Super Bowl champion', () => {
    const order = Object.keys(nflPlayoffs.teams).sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
    const state = playTournament(nflPlayoffs, favouriteWins(order))
    for (const conf of ['afc', 'nfc']) {
      const byes = state.stages[conf].matches.filter((m) => m.result?.source === 'bye')
      expect(byes.map((m) => m.result!.winnerId)).toEqual([`${conf}-1`])
      expect(state.stages[conf].ranking[0]).toBe(`${conf}-1`)
    }
    expect(state.stages['super-bowl'].seeds).toEqual(['afc-1', 'nfc-1'])
    expect(state.stages['super-bowl'].matches[0].label).toBe('Super Bowl')
    expect(state.stages['super-bowl'].status).toBe('complete')
  })

  it('simulates football scores', () => {
    const results = simulate(nflPlayoffs, {}, { kind: 'tournament' }, { seed: 3 })
    const superBowl = computeTournament(nflPlayoffs, results).stages['super-bowl'].matches[0]
    const [game] = superBowl.result!.games!
    const scores = Object.values(game.score!)
    expect(scores).toHaveLength(2)
    expect(scores[0]).not.toBe(scores[1])
  })
})

describe('validateTournament rules', () => {
  it('rejects even best-ofs and bad scoring', () => {
    const broken: Tournament = {
      ...nflPlayoffs,
      rules: { scoring: { kind: 'first-to', target: 0, overtime: { firstTo: 1 } } },
      stages: nflPlayoffs.stages.map((s) =>
        s.id === 'afc' && s.config.format === 'single-elim' ? { ...s, config: { ...s.config, bestOf: 2 } } : s,
      ),
    }
    expect(validateTournament(broken).map((i) => i.message)).toEqual([
      'Best-of 2 must be an odd number',
      'Points to win a game must be at least 1',
      'Overtime must be first to at least 2',
    ])
  })
})

describe('Groups + Playoffs preset', () => {
  it('is valid and sends the top 3 of each group to the playoffs', () => {
    expect(validateTournament(groupsPlayoffs)).toEqual([])
    const order = Object.keys(groupsPlayoffs.teams)
    const state = playTournament(groupsPlayoffs, favouriteWins(order))
    expect(state.stages['group-a'].ranking.slice(0, 3)).toEqual(['a-1', 'a-2', 'a-3'])
    expect(state.stages.playoffs.seeds).toEqual(['a-1', 'b-1', 'a-2', 'b-2', 'a-3', 'b-3'])
    // Group winners have byes into the semi-finals.
    const byes = state.stages.playoffs.matches.filter((m) => m.result?.source === 'bye')
    expect(byes.map((m) => m.result!.winnerId)).toEqual(['a-1', 'b-1'])
    expect(state.stages.playoffs.status).toBe('complete')
  })
})
