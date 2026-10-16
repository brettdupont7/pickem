import { parseVrsStandings } from '../engine'
import type { Catalog } from '../types'

/**
 * VRS standings copied from HLTV, which republishes Valve's standings daily
 * (Valve's own files come about monthly). HLTV blocks scripted requests, so
 * the app can't download them: a bookmarklet run on HLTV's page in the
 * viewer's own browser copies them in Valve's Markdown format instead, and
 * the copied text is pasted into the app.
 */

export const HLTV_VRS_URL = 'https://www.hltv.org/valve-ranking/teams'

/** First line of the copied text, so a paste can be recognised. */
const MARKER = "# Pick'em VRS import"

/** Runs on hltv.org/valve-ranking/teams[/<year>/<month>/<day>[/region/<Region>]]. */
const BOOKMARKLET = `(() => {
  const show = (message, text) => {
    document.getElementById('pickem-vrs')?.remove();
    const box = document.createElement('div');
    box.id = 'pickem-vrs';
    box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:12px 16px;border-radius:8px;background:#1d2433;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    box.textContent = message;
    if (text) {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'display:block;width:100%;height:120px;margin-top:8px';
      box.append(area);
      setTimeout(() => area.select());
    } else setTimeout(() => box.remove(), 6000);
    box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
    document.body.append(box);
  };
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const pad = (n) => String(n).padStart(2, '0');
  const path = location.pathname.match(/^\\/valve-ranking\\/teams(?:\\/(\\d{4})\\/([a-z]+)\\/(\\d{1,2}))?(?:\\/region\\/([A-Za-z]+))?/);
  const teams = [...document.querySelectorAll('div.ranked-team')];
  if (location.hostname !== 'www.hltv.org' || !path || teams.length === 0) {
    show("Open HLTV's Valve ranking (hltv.org/valve-ranking/teams), then click this bookmark again.");
    return;
  }
  let date = path[1] && path[1] + '_' + pad(months.indexOf(path[2]) + 1) + '_' + pad(path[3]);
  if (!date) {
    const h = (document.querySelector('.regional-ranking-header-text')?.textContent || '').match(/on ([A-Za-z]+) (\\d{1,2})[a-z]*, (\\d{4})/);
    if (h) date = h[3] + '_' + pad(months.indexOf(h[1].toLowerCase()) + 1) + '_' + pad(h[2]);
  }
  const cell = (s) => (s || '').trim().replace(/\\|/g, '/');
  const rows = teams.map((t) => {
    const rank = (t.querySelector('.position')?.textContent || '').replace(/\\D/g, '');
    const points = ((t.querySelector('.points')?.textContent || '').match(/\\d+/) || [''])[0];
    const players = [...t.querySelectorAll('.rankingNicknames span')].map((s) => cell(s.textContent));
    return '| ' + rank + ' | ' + points + ' | ' + cell(t.querySelector('.name')?.textContent) + ' | ' + players.join(', ') + ' | |';
  });
  const text = [
    ${JSON.stringify(MARKER)},
    'Source: ' + location.origin + location.pathname,
    'Region: ' + (path[4] || 'global').toLowerCase(),
    '',
    date ? 'Standings as of ' + date : '',
    '',
    '| Standing | Points | Team Name | Roster | |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\\n');
  const done = 'Copied ' + rows.length + ' teams' + (date ? ' as of ' + date.replace(/_/g, '-') : '') + ". Paste them into Pick'em.";
  let settled = false;
  const fail = () => { if (!settled) { settled = true; show("Couldn't copy automatically. Copy this text and paste it into Pick'em:", text); } };
  // The copy can hang (e.g. waiting on a permission), so fall back after a moment.
  setTimeout(fail, 2000);
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .then(() => { if (!settled) { settled = true; show(done); } }, fail);
})()`

/** The bookmarklet as a link target, for dragging to the bookmarks bar. */
export const HLTV_BOOKMARKLET_HREF = `javascript:${encodeURIComponent(BOOKMARKLET)}`

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
