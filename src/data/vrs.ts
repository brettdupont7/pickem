import { parseVrsStandings } from '../engine'
import type { Catalog } from '../types'

/**
 * Downloads the latest Valve Regional Standings for CS2 from Valve's public
 * repository. Standings are published about monthly as
 * live/<year>/standings_<region>_<yyyy>_<mm>_<dd>.md.
 */

const REPO = 'ValveSoftware/counter-strike_regional_standings'
const API = `https://api.github.com/repos/${REPO}/contents`
const RAW = `https://raw.githubusercontent.com/${REPO}/main`

export type VrsRegion = 'global' | 'europe' | 'americas' | 'asia'

interface ContentItem {
  name: string
  type: 'file' | 'dir'
}

async function list(path: string): Promise<ContentItem[]> {
  const res = await fetch(`${API}/${path}`, { headers: { Accept: 'application/vnd.github+json' } })
  if (res.status === 403 || res.status === 429) throw new Error('GitHub is rate-limiting requests. Try again in a few minutes.')
  if (!res.ok) throw new Error(`Couldn't reach GitHub (${res.status})`)
  return res.json()
}

export async function fetchLatestVrs(region: VrsRegion = 'global'): Promise<Catalog> {
  const years = (await list('live'))
    .filter((i) => i.type === 'dir' && /^\d{4}$/.test(i.name))
    .map((i) => i.name)
    .sort()
  // The newest year may not have this region's standings yet, so look back a year if needed.
  for (const year of years.reverse().slice(0, 2)) {
    const pattern = new RegExp(`^standings_${region}_(\\d{4})_(\\d{2})_(\\d{2})\\.md$`)
    const latest = (await list(`live/${year}`))
      .map((i) => i.name)
      .filter((name) => pattern.test(name))
      .sort()
      .at(-1)
    if (!latest) continue
    const url = `${RAW}/live/${year}/${latest}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Couldn't download ${latest} (${res.status})`)
    return parseVrsStandings(await res.text(), { region, url })
  }
  throw new Error(`No ${region} standings found`)
}
