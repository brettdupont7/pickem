import { parseVrsStandings } from '../engine'
import type { Catalog } from '../types'
import BOOKMARKLET from './hltvBookmarklet.js?raw'

/**
 * Data copied from HLTV: VRS standings, which HLTV republishes daily
 * (Valve's own files come about monthly), and events (see hltvEvent.ts).
 * HLTV blocks scripted requests, so the app can't download them: a
 * bookmarklet (hltvBookmarklet.js) run on HLTV's pages in the viewer's own
 * browser copies them, and the copied text is pasted into the app.
 */

export const HLTV_VRS_URL = 'https://www.hltv.org/valve-ranking/teams'

/** First line of copied standings, so a paste can be recognised. */
const MARKER = "# Pick'em VRS import"

/** The bookmarklet as a link target, for dragging to the bookmarks bar. */
export const HLTV_BOOKMARKLET_HREF = `javascript:${encodeURIComponent(BOOKMARKLET.trim())}`

/** The bookmarklet's source, for running it directly (e.g. in tests or a console). */
export const HLTV_BOOKMARKLET_SOURCE = BOOKMARKLET

/**
 * Parses standings pasted from the bookmarklet. A standings file copied from
 * Valve's repository works too.
 */
export function parseHltvImport(text: string): Catalog {
  if (!text.startsWith(MARKER)) {
    try {
      return parseVrsStandings(text)
    } catch {
      throw new Error("That doesn't look like a ranking copied from HLTV. Click the bookmark on HLTV's Valve ranking page, then paste here.")
    }
  }
  const region = text.match(/^Region: (\w+)$/m)?.[1] ?? 'global'
  const url = text.match(/^Source: (\S+)$/m)?.[1]
  const catalog = parseVrsStandings(text, { region, url })
  if (!catalog.asOf) throw new Error("The copied ranking has no date. Copy it again from HLTV's Valve ranking page.")
  return { ...catalog, label: `VRS (${region}, via HLTV)` }
}
