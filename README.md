# Pickem

A tournament bracket app for making picks, recording results and simulating outcomes, inspired by HLTV.org's event pages. It isn't tied to one sport: the same engine runs a CS2 Major, an NFL playoff bracket or anything you can describe as stages of Swiss, single elimination or double elimination.

## Goal

- **Any tournament shape.** Chain stages together however the event works. For example, a CS2 Major is three Swiss stages feeding an 8-team playoff, and the NFL is two conference brackets feeding the Super Bowl.
- **Any sport or game.** Scoring rules, series length, round names and wording ("Map" vs "Game", "Round" vs "Point") all come from the tournament's settings.
- **As simple or detailed as you like.** Click a team to pick it, or enter the exact series score and per-game scores.
- **A simulator.** Fill in the rest of an event from team ratings, or run thousands of simulations to see each team's odds.

## Getting started

Requires Node 18+.

```sh
npm install
npm run dev     # start the app at http://localhost:5173
npm test        # run the engine tests
npm run build   # type-check and build for production
```

Your tournaments, picks and results are saved in the browser (localStorage), so they survive a refresh.

## Using the app

### Choose a tournament

Use the dropdown in the header to switch between your saved tournaments. Each one keeps its own picks and results. Choose **New or manage…** to open the library in the **Design** tab, where you can:

- start a new tournament, either blank (8 teams, single elimination) or from a preset
- duplicate a tournament with its picks and results (**Duplicate**), or just its format and teams (**Duplicate design**), e.g. to set up next season
- export or delete a tournament
- import a tournament file

| Preset | Structure |
| --- | --- |
| CS2 Major | Three 16-team Swiss stages (3 wins advance, 3 losses eliminate; Bo1, Bo3 for advancement/elimination matches) into an 8-team single-elimination playoff (Bo3, Bo5 final). CS2 scoring: first to 13 rounds, MR3 overtime. |
| Groups + Playoffs | Two 8-team double-elimination groups (Bo3) where the upper final decides 1st and 2nd and the lower bracket decides 3rd, into a 6-team single-elimination playoff (Bo3, Bo5 final). Group winners get byes to the semi-finals. CS2 scoring. |
| NFL Playoffs | AFC and NFC brackets of 7 teams each (1 seed gets a bye, reseeding every round), then the Super Bowl. Football scoring. |

Teams in the presets are placeholders. To rename them all at once, paste a list of names in the **Teams** tab.

### Make picks and record results

- **Click a team** in any match to pick it as the winner. Click it again to clear the pick. Later rounds update immediately, and if you change an earlier pick, results that no longer make sense are dropped automatically.
- **Picks vs Actual results:** picks and actual results are stored separately, so recording what really happened never overwrites a prediction. The switch in the header picks which one you see and edit:
  - **Actual results** shows only real outcomes. Your picks are hidden, and clicking a team records the actual result.
  - **Picks** shows your picks, with every decided actual result on top. Actual results are locked here (change them under Actual results), so later rounds follow reality as far as it's known and your picks after that. Where you'd picked a match that's now decided, a **✓** or **✗** next to the team you picked shows whether you got it right. An actual match that's still in progress doesn't hide your pick.

  A colored dot on each match shows its source: blue for a pick, green for an actual result, purple for a simulated one.
- **Detailed scores:** click **✎** on a match (in the Swiss grid, hover the middle of the match) to open the score editor. From there you can:
  - pick or clear the winner
  - set a series score, e.g. 2–1
  - enter games one by one, with an optional name (a map dropdown in CS2) and the score

  Scores are checked against the tournament's rules as you type. For example, a CS2 map at 7–4 counts as in progress, 13–4 is final, and 17–13 is flagged as impossible. A match with some scores but no winner yet shows as **Live**.

### Views

- **Bracket:** one tab per stage, each with a status badge (Waiting, In progress, Done).
  - **Swiss stages** use the HLTV-style web. Records branch out from 0:0, green and red arrows show where winners and losers go, and advanced and eliminated teams collect in boxes along the top and bottom. Rounds not reached yet show placeholders.
  - **Elimination stages** show the bracket by round, with lines from each match to the one its winner plays next. The lines turn green once the winner is decided. Double elimination shows the upper and lower brackets separately, with the grand final to the right of both. Reseeded rounds have no lines, since opponents aren't fixed in advance. Once a match is decided, a mark next to each team's score shows where it goes: a green **→** if it plays on (to its next match, or to a later stage once its place is certain), a red **↓** if it drops to the lower bracket or the 3rd place match, and nothing if it's out. Hover a mark for details. Once a stage is done, **Final placings** lists every team's place and which later stage it goes to.
  - **Waiting stages** list their entrants, e.g. "3rd in Stage 1".
- **Odds:** runs 2,000 simulations of the rest of the event. For each team it shows the chance of advancing from each stage, and of winning the last one. It uses whichever view is selected: under **Picks**, your picks and actual results are kept fixed; under **Actual results**, only actual results are, so the odds show the real-world outlook.
- **Teams:** at the top, **VRS rankings** brings in Valve's Regional Standings for CS2:
  - **Download / Refresh** fetches the latest global standings from [Valve's repository](https://github.com/ValveSoftware/counter-strike_regional_standings) and keeps them in the browser, apart from your tournaments.
  - **Add from VRS…** lists the top 150 (search covers every team and player); tick teams to add them with their VRS points as their rating.
  - **Link teams to VRS…** matches the tournament's teams to VRS by name (ignoring case, punctuation, words like "Team" and short names like NAVI), lets you correct any match, then sets their ratings to VRS points.
  - **Update ratings to …** appears when a newer snapshot is downloaded; ratings never change on their own, so an event in progress keeps the ratings it started with.
  - The **Source** column shows where each rating came from, e.g. "VRS #3 · Oct 5, 2026". Typing a rating by hand makes it manual again.

  Below that, add, remove and edit teams: name, short name, logo URL and rating. The short name or logo is shown in the Swiss grid (initials are used when blank). Ratings drive the simulator; blank means 1500. They're also the starting ratings for Swiss stages paired by live rating, and the **Live** column shows each team's current live rating. Click the **Name**, **Rating** or **Live** header to sort (click again to reverse, a third time to restore the original order). **Paste team names…** takes one name per line and either renames the existing teams in order or adds them as new teams.
- **Design:** the tournament library and the designer (see below).

### Simulate

The **Simulate** bar (under **Picks** only, since simulated results are predictions) fills in matches that don't have a result:

- **Next round:** every match that can be played right now
- **This stage:** the rest of the selected stage
- **Everything:** the rest of the tournament

Picks and actual results are never overwritten, and simulated results are stored with your picks. A match you have partly scored as a pick is played out from its current score.

- **Chaos:** 0 means ratings decide the odds, and 100 makes every game a coin flip.
- **Detail:** full scores, series scores only, or winners only.
- **Clear simulated:** removes only simulated results.
- **Clear picks:** clears every pick and simulation, keeping actual results. Under **Actual results**, **Clear actual results** does the reverse.

## Designing a tournament

The **Design** tab edits the open tournament. Changes apply straight away, and the bracket updates to match. Picks and results are kept, but any that no longer fit the new design are ignored.

- **Tournament:** the name, and the random seed used for random draws, pairings and tiebreakers. **Reshuffle** picks a new seed.
- **Game rules:**
  - **Scoring:** "Higher score wins" (with an optional typical score for the simulator) or "First to N" with optional overtime.
  - **Words:** what the UI calls a game and a point.
  - **Game names:** an optional list, such as a map pool.
  - **Ratings predict:** whether a rating gap predicts one game (default) or a best-of-3. VRS points predict a best-of-3, so the CS2 rule set uses that; the simulator then works out the per-game chance that gives those odds, so a Bo3 matches VRS and a Bo1 is closer to a coin flip.
  - **Load a rule set** fills these in for CS2, Valorant, American football or a generic sport.
- **Stages:** grouped by phase. Click a stage to expand it. Each badge shows how many problems the stage has.
  - **Duplicating:** **⧉** on a stage copies it into the same phase, and **Duplicate phase** copies every stage in a phase into a new phase right after it. Copies keep the format and settings, and get entrants that work straight away: places from another stage move to the next free places (a copy of a playoff taking 1st–8th takes 9th–16th), and invited teams, or places with none left, become new placeholder teams to rename.
  - **Name, format and phase.** Switching format keeps the best-of and seeding. Choose **New phase at the end** to move a stage after everything else.
  - **Format settings:**
    - **Swiss:** wins and losses, best-ofs, pairing, rematches and tiebreakers (ordered).
    - **Elimination:** seeding, reseeding, 3rd place match, and a table to rename each round or change its best-of. The table updates with the entrant count; leave a cell blank for the default.
    - **Double elimination finals:**
      - **Grand final** (default): the upper winner meets the lower winner, with an optional best-of and reset.
      - **Upper final decides 1st and 2nd:** the upper-final loser takes 2nd without dropping, and the lower final decides 3rd.
      - **No grand final:** the upper-final loser drops as usual, then the upper winner takes 1st and the lower winner 2nd.
  - **Entrants** in seed order. Each slot is a team or a place in an earlier stage, and can be moved up or down.
    - **+ Team** adds the next team that isn't entered anywhere, or creates a new one.
    - **Paste teams…** adds a list of names: existing teams are reused and new ones created.
    - **Add places** links stages, e.g. places 1–8 from Stage 1. It suggests the places nobody uses yet.
  - **Places from this stage** shows which later stages take which places, and which places finish here.
  - **Show preview** draws the stage as it would start. Teams from earlier stages appear as placeholders like "3rd in Stage 1".
- Problems such as a team entered twice, a place that doesn't exist or an even best-of are listed on the stage they belong to. The tournament badge says **Ready to play** when there are none.

### Tournament files

**Export** saves a tournament as JSON, with its picks and actual results (kept separately) unless you untick **Include picks and results when exporting**. **Import** loads a file as a new tournament. It accepts an exported file, including ones from before picks and results were separated, or a bare tournament object, and fills in any stage settings that are missing with defaults.

## How tournaments are described

Everything the designer edits is plain data, described below. Presets live in `src/data/presets/`.

- **Stages.** Each stage has a format and a list of entrants in seed order. An entrant is either a team or a placement in an earlier stage ("2nd place in Stage 1"). That's how stages link together.
- **Phases** set the play order. Stages in the same phase run side by side, like the AFC and NFC.
- **Formats:**
  - **Swiss:** wins to advance and losses to be eliminated (any numbers), best-of per match type, first-round pairing, later-round pairing (Buchholz, live rating, seed or random), rematch avoidance, tiebreakers. Live rating works like ESL Pro League: teams start from their Teams-tab ratings (or from seed order if none are rated), ratings move by Elo after every match result (K-factor configurable, default 32), and each record group pairs the highest-rated team against the lowest. ESL doesn't publish its exact formula, so this is an approximation. Byes are handled for odd team counts.
  - **Single elimination:** seeding (standard 1v8, as listed or random), seed order (entrant order, or live rating so that Swiss qualifiers are seeded by the live rating they finished with), byes for top seeds, optional reseeding, optional third-place match, best-of and round names per round.
  - **Double elimination:** the same seeding options, best-of and round names for the upper and lower brackets, and how it ends: a grand final (with optional reset), no grand final, or the upper final deciding 1st and 2nd.
- **Game rules** (per tournament):
  - **Free scoring:** the higher score wins, as in football or basketball.
  - **First-to-N with optional overtime:** CS2 is first to 13 with overtime first to 4, and Valorant is first to 13 then win by two.
  - **Also set here:** the words the UI uses, and an optional list of game names such as a map pool.
- **Best-of** can be any odd number (Bo1, Bo3, Bo5, Bo7, …).

`validateTournament()` in `src/engine/tournament.ts` reports mistakes in a tournament definition, such as a team entered twice or a stage taking a placement that doesn't exist.

## Project structure

```
src/
  types/        Data model: teams, matches, results, stages, rules, tournaments
  engine/       Pure TypeScript, no React
    swiss/          Swiss pairing and standings
    single-elim/    Single-elimination brackets (incl. reseeding)
    double-elim/    Double-elimination brackets
    elimination/    Shared bracket logic (seeding, byes, results, ranking)
    simulator/      Rating-based simulation and Monte Carlo odds
    results.ts      Recording results and edit helpers used by the UI
    rules.ts        Game scoring rules and simulated score models
    tournament.ts   Links stages together and validates tournaments
    design.ts       Designer helpers: add/remove stages and teams, round info, previews
    io.ts           Tournament files (export/import)
  data/presets/ CS2 Major, NFL Playoffs and shared rule sets
  store/        Zustand stores (open tournament + results, library, UI state)
  components/   React UI (Swiss web, brackets, match cards, editor, odds, teams, designer)
```

The engine recomputes every stage from the tournament definition plus the recorded results. Nothing derived (pairings, standings, who advanced) is stored, which is why changing an early result automatically updates everything after it.

## Current limitations

- The designer is a form, not a visual graph: stages are linked by choosing places, not by dragging connections.
- Data is stored only in your browser. There are no accounts or live sharing, but tournaments can be exported and imported as files.
