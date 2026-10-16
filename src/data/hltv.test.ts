import { describe, expect, it } from 'vitest'
import { matchTeams } from '../engine'
import { HLTV_BOOKMARKLET_HREF, HLTV_BOOKMARKLET_SOURCE, parseHltvImport } from './hltv'

// Just enough of HLTV's ranking page for the bookmarklet, with made-up teams.
const el = (text = '') => ({ textContent: text, style: {}, append() {}, addEventListener() {}, remove() {}, select() {} })
const team = (rank: number, points: number, name: string, players: string[]) => {
  const parts: Record<string, ReturnType<typeof el>> = {
    '.position': el(`#${rank}`),
    '.points': el(`(${points} Valve points)`),
    '.name': el(name),
  }
  return {
    querySelector: (s: string) => parts[s] ?? null,
    querySelectorAll: (s: string) => (s === '.rankingNicknames span' ? players.map((p) => el(p)) : []),
  }
}

async function runBookmarklet(pathname: string, teams: ReturnType<typeof team>[], header = '') {
  let copied = ''
  let toast = ''
  const document = {
    querySelectorAll: (s: string) => (s === 'div.ranked-team' ? teams : []),
    querySelector: (s: string) => (s === '.regional-ranking-header-text' ? el(header) : null),
    getElementById: () => null,
    createElement: () => {
      const box = el()
      return new Proxy(box, {
        set: (target, key, value) => {
          if (key === 'textContent') toast = value
          return Reflect.set(target, key, value)
        },
      })
    },
    body: el(),
  }
  const location = { hostname: 'www.hltv.org', origin: 'https://www.hltv.org', pathname }
  const navigator = { clipboard: { writeText: async (text: string) => void (copied = text) } }
  new Function('document', 'location', 'navigator', 'setTimeout', HLTV_BOOKMARKLET_SOURCE)(document, location, navigator, () => {})
  await new Promise((r) => setTimeout(r))
  return { copied, toast }
}

const teams = [
  team(1, 1983, 'Alpha', ['a1', 'a2', 'a3', 'a4', 'a5']),
  team(2, 1943, 'Natus Vincere', ['n1', 'n2', 'n3', 'n4', 'n5']),
  team(3, 1200, 'Alpha', ['x1', 'x2', 'x3', 'x4', 'x5']),
]

describe('HLTV bookmarklet', () => {
  it('is a valid bookmark link', () => {
    expect(HLTV_BOOKMARKLET_HREF.startsWith('javascript:')).toBe(true)
    expect(() => new Function(decodeURIComponent(HLTV_BOOKMARKLET_HREF.slice('javascript:'.length)))).not.toThrow()
  })

  it('copies the standings in a form the app imports', async () => {
    const { copied, toast } = await runBookmarklet('/valve-ranking/teams/2026/october/16', teams)
    expect(toast).toBe("Copied 3 teams as of 2026-10-16. Paste them into Pick'em.")
    const vrs = parseHltvImport(copied)
    expect(vrs).toMatchObject({ source: 'vrs', label: 'VRS (global, via HLTV)', asOf: '2026-10-16' })
    expect(vrs.url).toBe('https://www.hltv.org/valve-ranking/teams/2026/october/16')
    expect(vrs.entries.map((e) => [e.key, e.rank, e.points, e.name])).toEqual([
      ['alpha', 1, 1983, 'Alpha'],
      ['natusvincere', 2, 1943, 'Natus Vincere'],
      ['alpha#3', 3, 1200, 'Alpha'],
    ])
    expect(vrs.entries[1].roster).toEqual(['n1', 'n2', 'n3', 'n4', 'n5'])
  })

  it('reads the region and, without a date in the address, the date from the heading', async () => {
    const { copied } = await runBookmarklet('/valve-ranking/teams/region/Europe', teams, 'Valve europe ranking on March 2nd, 2026Beta')
    expect(parseHltvImport(copied)).toMatchObject({ label: 'VRS (europe, via HLTV)', asOf: '2026-03-02' })
  })

  it('copies nothing on other pages', async () => {
    const { copied, toast } = await runBookmarklet('/ranking/teams', teams)
    expect(copied).toBe('')
    expect(toast).toMatch(/Open HLTV's Valve ranking/)
  })
})

describe('parseHltvImport', () => {
  it('keeps teams linked to a Valve snapshot linked', async () => {
    const vrs = parseHltvImport((await runBookmarklet('/valve-ranking/teams/2026/october/16', teams)).copied)
    const matched = matchTeams([{ id: 'n', name: 'NaVi', ratingSource: { catalog: 'vrs', key: 'natusvincere', rank: 3, asOf: '2026-10-05' } }], vrs)
    expect(matched.get('n')?.points).toBe(1943)
  })

  it("accepts a file from Valve's repository too", () => {
    const valve = '### Standings as of 2026_10_05<br />\n\n| Standing | Points | Team Name | Roster | |\n| :- | -: | :- | :- | :- |\n| 1 | 2046 | Alpha | a1 | [details](x.md) |'
    expect(parseHltvImport(valve)).toMatchObject({ label: 'VRS (global)', asOf: '2026-10-05' })
  })

  it('explains anything else', () => {
    expect(() => parseHltvImport('hello')).toThrow("doesn't look like a ranking copied from HLTV")
  })
})
