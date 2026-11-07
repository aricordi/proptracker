# Robot tests (end-to-end)

A robot opens the real app in a browser (Chromium) and uses it like a person: it taps the
"Test mode: sign in as" buttons, books a time, sends a props request, packs it, returns it, and so on.
Everything runs on the **local Firebase emulator** (project `demo-proptracker`, offline only): the live
database is never touched.

## Run them

```
npm run e2e
```

That one command builds the functions and the app, starts the emulators, fills them with the test data
(`scripts/seed-emulator.mjs --reset`), serves the app on a free port, runs the journeys and then the crawl,
and stops everything. Success looks like `[e2e] journeys: passed` and `[e2e] crawl: passed` at the end.

Handy options:

- `npm run e2e -- --only journeys` or `--only crawl`: one part only.
- `npm run e2e -- --no-build`: reuse the last build (faster when only the tests changed).
- `npm run e2e -- tests/e2e/journeys/05-equipment-approves.e2e.ts`: one file (with `--only journeys`).
- `E2E_REUSE_EMULATORS=1 npm run e2e`: use emulators you already started with `npm run emulator`.

When something fails, a screenshot and a page snapshot are in `.e2e/results/`, and the emulator and app
logs in `.e2e/*.log`.

## What's covered

Journeys (`journeys/`, one file at a time, each file starts from fresh test data):

1. Creator lands on the Chat, picks a free time on the month calendar, requests it → "Waiting for approval" / "Waiting for OK".
2. (file 02, tests 2–4b) One props request from start to finish: creator searches, adds props to a shoot, sends it → arts picks,
   pack photo, packed → creator signs for the pickup, returns everything with a photo → arts checks it in
   with one prop damaged → the prop shows Damaged.
3. (file 03) Shoot day, in the Chat: the creator checks in with one selfie, reports the slot before (house left a mess, photo,
   note), wraps with what they filmed; the equipment team sees "Filmed" and the report in Schedule team, and dismisses it.
   (This file writes a shoot that is on right now, whatever the hour.)
5. Equipment team approves one booking request and denies another with a reason; Gear log; Google Calendar tab.
   Then the creator sees "Not approved" with that reason on the Chat.
6. Admin: Dashboard, every Analytics tab, a creator's report card and record.
7. Arts: Clean up props hub, combine a group of doubles, ⋯ → Find duplicates → combine, Remove + Undo, Prop insights.
8. Creator on Props only: just Props and Me, no booking anywhere, prop pages without an add button.
9. Owner: Team page groups, Settings sheet, "Use the app as: Creator" and back.
10. Laptop (1440×900): the equipment team's Requests week board; the admin's Analytics with the side panel.
11. Known bugs, written as tests that are switched off (`test.fixme`) until the bug is fixed. Right now:
    - request History (and "Signed by … on", "Returned …", Activity days, Suggested edits) shows TOMORROW's date for
      anything done from 7 PM (8 PM in summer) until midnight Toronto time (day taken from the UTC timestamp);
    - (in journey 5, `test.step.skip`) the "Approved ✓ … gets a notification" / "Denied …" confirmation on a request
      card vanishes with the card the moment the request is decided, so nobody sees it.
12. "Wanted but booked": a creator adding to their shoot opens a prop that someone else has booked that day → "Not
    available", and a quiet `prop_wants` record is written; arts sees "1 person wanted it while booked out" on Prop insights.

The crawl (`crawl/`): for every role, every route in `src/App.tsx` (read each run, ids filled in from the
test data). It fails on a crash, a console error, a server function crash (5xx) or a blank page area.
Refused server calls (4xx) and redirects are listed as notes on the test. It starts from fresh test data
(`setup/fresh-data.setup.ts`, a Playwright setup project), so `--only crawl` works on its own too.

Test data: `scripts/seed-emulator.mjs` (also fills the practice site). Extras only the robot tests need (a finished
gear booking `gb1`, a finished import `imp-job1`) are added on the emulator only. Dates the tests depend on are read
back from the test data (`getDoc('shoots/sh9')`) and day labels are formatted by the browser (`dayLabel`), so a run
that starts just before midnight still matches.

## Writing more

- Find things the way a person does: `getByRole('button', { name: 'Send the props' })`, `getByText(...)`.
  Avoid CSS classes. Wait for what the person would see (`expect(...).toBeVisible()`), never a fixed sleep.
- Use `test`, `expect`, `signIn`, `reseed`, `studioDate`, `testPhoto`, `getDoc`, `dayLabel`, `esc` from `helpers.ts`. Every test fails if
  the app logs a console error; `allowConsole(page, /pattern/)` if one is expected.
- Dates: the app counts days in Toronto time. Use `studioDate(n)` / `plainDayAhead(n)` and never assume what
  day it is: the suite must pass at any hour.
- A test fails because of a real app bug? Don't change the app in the same change: mark the step
  `test.step.skip('BUG: …')` or the test `test.fixme(...)` with a note, and report it.
