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

Your tournament, picks and results are saved in the browser (localStorage), so they survive a refresh.

## Using the app

### Choose a tournament

Use the dropdown in the header to load a preset. Loading one clears your current results.

| Preset | Structure |
| --- | --- |
| CS2 Major | Three 16-team Swiss stages (3 wins advance, 3 losses eliminate; Bo1, Bo3 for advancement/elimination matches) into an 8-team single-elimination playoff (Bo3, Bo5 final). CS2 scoring: first to 13 rounds, MR3 overtime. |
| NFL Playoffs | AFC and NFC brackets of 7 teams each (1 seed gets a bye, reseeding every round), then the Super Bowl. Football scoring. |

Teams in the presets are placeholders. Rename them in the **Teams** tab.

### Make picks and record results

- **Click a team** in any match to pick it as the winner. Click it again to clear the pick. Later rounds update immediately, and if you change an earlier pick, results that no longer make sense are dropped automatically.
- **Picks vs Actual results:** the switch in the header sets how your edits are recorded. Use **Picks** for predictions and **Actual results** for real outcomes. A colored dot on each match shows its source: blue for a pick, green for an actual result, purple for a simulated one.
- **Detailed scores:** click **✎** on a match (in the Swiss grid, hover the middle of the match) to open the score editor. From there you can:
  - pick or clear the winner
  - set a series score, e.g. 2–1
  - enter games one by one, with an optional name (a map dropdown in CS2) and the score

  Scores are checked against the tournament's rules as you type. For example, a CS2 map at 7–4 counts as in progress, 13–4 is final, and 17–13 is flagged as impossible. A match with some scores but no winner yet shows as **Live**.

### Views

- **Bracket:** one tab per stage, each with a status badge (Waiting, In progress, Done).
  - **Swiss stages** use the HLTV-style web. Records branch out from 0:0, green and red arrows show where winners and losers go, and advanced and eliminated teams collect in boxes along the top and bottom. Rounds not reached yet show placeholders.
  - **Elimination stages** show the bracket by round. Double elimination shows the upper and lower brackets separately.
  - **Waiting stages** list their entrants, e.g. "3rd in Stage 1".
- **Odds:** runs 2,000 simulations of the rest of the event. For each team it shows the chance of advancing from each stage, and of winning the last one. Your picks and actual results are kept fixed, so the odds reflect them.
- **Teams:** edit each team's name, short name, logo URL and rating. The short name or logo is shown in the Swiss grid (initials are used when blank). Ratings drive the simulator; blank means 1500.

### Simulate

The **Simulate** bar fills in matches that don't have a result:

- **Next round:** every match that can be played right now
- **This stage:** the rest of the selected stage
- **Everything:** the rest of the tournament

Picks and actual results are never overwritten. Matches in progress are played out from their current score.

- **Chaos:** 0 means ratings decide the odds, and 100 makes every game a coin flip.
- **Detail:** full scores, series scores only, or winners only.
- **Clear simulated:** removes only simulated results.
- **Reset all:** clears everything.

## How tournaments are described

The app doesn't have a tournament designer yet. Custom tournaments are written as presets in `src/data/presets/`, and everything below can be set there.

- **Stages.** Each stage has a format and a list of entrants in seed order. An entrant is either a team or a placement in an earlier stage ("2nd place in Stage 1"). That's how stages link together.
- **Phases** set the play order. Stages in the same phase run side by side, like the AFC and NFC.
- **Formats:**
  - **Swiss:** wins to advance and losses to be eliminated (any numbers), best-of per match type, first-round pairing, later-round pairing (Buchholz, seed or random), rematch avoidance, tiebreakers. Byes are handled for odd team counts.
  - **Single elimination:** seeding (standard 1v8, as listed or random), byes for top seeds, optional reseeding, optional third-place match, best-of and round names per round.
  - **Double elimination:** the same seeding options, best-of and round names for the upper and lower brackets, and an optional grand-final reset.
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
  data/presets/ CS2 Major, NFL Playoffs and shared rule sets
  store/        Zustand stores (tournament + results, UI state)
  components/   React UI (Swiss web, brackets, match cards, editor, odds, teams)
```

The engine recomputes every stage from the tournament definition plus the recorded results. Nothing derived (pairings, standings, who advanced) is stored, which is why changing an early result automatically updates everything after it.

## Current limitations

- No in-app tournament designer: stages, formats and rules can only be changed by editing presets in code. Team names, short names, logos and ratings can be edited in the app.
- No double-elimination preset yet, so that view gets the least use.
- Elimination brackets don't have connector lines between rounds.
- Data is stored only in your browser: there are no accounts, sharing or export.
