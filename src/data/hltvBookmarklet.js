(async () => {
  // Pick'em's HLTV bookmarklet. On HLTV's Valve ranking it copies the
  // standings shown; on an event page it copies the event and its grouped
  // stages (loading their pages as a click would) plus the current Valve
  // ranking. It runs in the viewer's own browser and only reads pages.
  const BOX = 'pickem-hltv';
  const show = (message, text) => {
    document.getElementById(BOX)?.remove();
    const box = document.createElement('div');
    box.id = BOX;
    box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:12px 16px;border-radius:8px;background:#1d2433;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    box.textContent = message;
    if (text) {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'display:block;width:100%;height:120px;margin-top:8px';
      const copy = document.createElement('button');
      copy.textContent = 'Copy';
      copy.style.cssText = 'margin-top:8px;padding:4px 12px';
      copy.addEventListener('click', () => {
        area.select();
        navigator.clipboard.writeText(text).then(() => (copy.textContent = 'Copied'), () => (copy.textContent = 'Press Ctrl/⌘+C'));
      });
      box.append(area, copy);
      setTimeout(() => area.select());
    } else if (!/…$/.test(message)) setTimeout(() => box.remove(), 6000);
    box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
    document.body.append(box);
  };
  const copy = (text, done) => {
    let settled = false;
    const fail = () => { if (!settled) { settled = true; show("Couldn't copy automatically. Copy this and paste it into Pick'em:", text); } };
    // The copy can hang (e.g. waiting on a permission), so fall back after a moment.
    setTimeout(fail, 2000);
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(() => { if (!settled) { settled = true; show(done); } }, fail);
  };
  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const pad = (n) => String(n).padStart(2, '0');

  /** The ranking in Valve's Markdown format, or null if `doc` isn't a ranking page. */
  const ranking = (doc, pathname) => {
    const path = pathname.match(/^\/valve-ranking\/teams(?:\/(\d{4})\/([a-z]+)\/(\d{1,2}))?(?:\/region\/([A-Za-z]+))?\/?$/);
    const teams = [...doc.querySelectorAll('div.ranked-team')];
    if (!path || teams.length === 0) return null;
    let date = path[1] && path[1] + '_' + pad(months.indexOf(path[2]) + 1) + '_' + pad(path[3]);
    if (!date) {
      const h = text(doc.querySelector('.regional-ranking-header-text')).match(/on ([A-Za-z]+) (\d{1,2})[a-z]*, (\d{4})/);
      if (h) date = h[3] + '_' + pad(months.indexOf(h[1].toLowerCase()) + 1) + '_' + pad(h[2]);
    }
    const cell = (s) => (s || '').trim().replace(/\|/g, '/');
    const rows = teams.map((t) => {
      const rank = text(t.querySelector('.position')).replace(/\D/g, '');
      const points = (text(t.querySelector('.points')).match(/\d+/) || [''])[0];
      const players = [...t.querySelectorAll('.rankingNicknames span')].map((s) => cell(s.textContent));
      // Logos come in dark- and light-theme versions or just one; HLTV's placeholder is a relative link.
      const logo = (img) => (/^https:\/\//.test(img?.getAttribute('src') || '') ? cell(img.getAttribute('src')) : '');
      const dark = logo(t.querySelector('.team-logo img.night-only') || t.querySelector('.team-logo img'));
      const light = logo(t.querySelector('.team-logo img.day-only'));
      return '| ' + rank + ' | ' + points + ' | ' + cell(t.querySelector('.name')?.textContent) + ' | ' + players.join(', ') + ' | | ' + dark + ' | ' + light + ' |';
    });
    const markdown = [
      "# Pick'em VRS import",
      'Source: ' + location.origin + pathname,
      'Region: ' + (path[4] || 'global').toLowerCase(),
      '',
      date ? 'Standings as of ' + date : '',
      '',
      '| Standing | Points | Team Name | Roster | | Logo | Light logo |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...rows,
    ].join('\n');
    return { markdown, count: rows.length, date: date && date.replace(/_/g, '-') };
  };

  /** The rounds of one of HLTV's bracket JSONs: single elimination has `rounds`, double elimination named rounds. */
  const bracket = (json) => {
    const named = Array.isArray(json.rounds)
      ? json.rounds.map((round, i) => ['round' + (i + 1), round])
      : Object.entries(json).filter(([, round]) => round && typeof round === 'object' && round.roundName);
    const team = (t) => (t && (t.name || t.description)) || null;
    return {
      name: json.name || '',
      type: (json.type || '').split('.').pop(),
      rounds: named.map(([key, round]) => ({
        key,
        name: round.roundName?.name || '',
        matches: Object.keys(round)
          .filter((k) => /^slot\d+$/.test(k))
          .map((k) => round[k])
          .map((slot) => ({
            team1: team(slot.matchup?.team1),
            team2: team(slot.matchup?.team2),
            bo: slot.matchup?.match?.numberOfMaps || null,
            hidden: !!slot.hidden,
          })),
      })),
    };
  };

  const page = (doc, url) => {
    const col = doc.querySelector('.contentCol') || doc.body;
    const dates = col.querySelectorAll('td.eventdate [data-unix]');
    return {
      id: (url.match(/\/events\/(\d+)/) || [])[1] || null,
      url: location.origin + url,
      name: text(col.querySelector('.event-hub-title')) || text(col.querySelector('h1')),
      label: null,
      start: Number(dates[0]?.getAttribute('data-unix')) || null,
      linked: [...col.querySelectorAll('.linked-events-container .linked-event')].map((a) => ({
        url: a.getAttribute('href'),
        label: text(a.querySelector('.linked-event-title')),
      })),
      formats: [...col.querySelectorAll('table.formats tr')].map((tr) => [
        text(tr.querySelector('th')),
        (tr.querySelector('td')?.textContent || '').trim(),
      ]),
      swiss: [...col.querySelectorAll('.swiss-visual-container')].map((sv) => ({
        titles: [...sv.querySelectorAll('.swiss-visual-matchups-title')].map(text),
        firstRound: [...(sv.querySelector('.swiss-visual-column')?.querySelectorAll('.swiss-visual-matchup') || [])].map((m) =>
          [...m.querySelectorAll('.swiss-visual-team')].map((t) => text(t) || t.querySelector('img')?.getAttribute('title') || null),
        ),
      })),
      brackets: [...col.querySelectorAll('[data-slotted-bracket-json]')].flatMap((el) => {
        try { return [bracket(JSON.parse(el.getAttribute('data-slotted-bracket-json')))]; } catch { return []; }
      }),
      slots: [...col.querySelectorAll('.teams-attending .team-box')].map((box) => ({
        name: text(box.querySelector('.team-name .text')) || null,
        rank: Number(text(box.querySelector('.event-vrs-rank')).replace(/\D/g, '')) || null,
        from: text(box.querySelector('.sub-text')),
        predicted: (text(box.querySelector('.vrs-prediction')).match(/[<>]?\d+(?:\.\d+)?%/) || [null])[0],
      })),
    };
  };

  const load = async (url) => {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HLTV returned ' + res.status + ' for ' + url);
    return { doc: new DOMParser().parseFromString(await res.text(), 'text/html'), url: new URL(res.url).pathname };
  };

  if (location.hostname !== 'www.hltv.org') {
    show("Open HLTV's Valve ranking or an event page on hltv.org, then click this bookmark again.");
    return;
  }

  const standings = ranking(document, location.pathname);
  if (standings) {
    copy(standings.markdown, 'Copied ' + standings.count + ' teams' + (standings.date ? ' as of ' + standings.date : '') + ". Paste them into Pick'em.");
    return;
  }

  // An event page, or an event's VRS invites view (/valve-ranking/teams/event/<id>).
  const invites = location.pathname.match(/^\/valve-ranking\/teams\/event\/(\d+)/);
  if (!invites && !/^\/events\/\d+\//.test(location.pathname)) {
    show("Open HLTV's Valve ranking or an event page on hltv.org, then click this bookmark again.");
    return;
  }

  try {
    show('Reading the event…');
    const start = invites ? await load('/events/' + invites[1] + '/event') : { doc: document, url: location.pathname };
    const here = page(start.doc, start.url);
    const others = await Promise.all(here.linked.map(async (l) => page((await load(l.url)).doc, l.url)));
    const pages = [here, ...others];
    // Each page names the others ("Stage 1", "Stage 3 & Playoffs"), so every page gets its label.
    for (const p of pages) for (const l of p.linked) {
      const target = pages.find((q) => q.url === location.origin + l.url);
      if (target && !target.label) target.label = l.label;
    }
    pages.sort((a, b) => (a.start || 0) - (b.start || 0));
    let vrs = null;
    try {
      const r = await load('/valve-ranking/teams');
      vrs = ranking(r.doc, r.url)?.markdown || null;
    } catch {}
    const event = {
      format: 'pickem-hltv-event',
      version: 1,
      url: here.url,
      copiedAt: new Date().toISOString(),
      ranking: vrs,
      pages: pages.map(({ linked, ...p }) => p),
    };
    const teams = pages.reduce((n, p) => n + p.slots.filter((s) => s.name).length, 0);
    copy(JSON.stringify(event), 'Copied ' + pages.length + (pages.length === 1 ? ' page' : ' pages') + ' with ' + teams + " teams. Paste them into Pick'em.");
  } catch (e) {
    show("Couldn't read this event: " + (e && e.message ? e.message : e));
  }
})()
