# Prop Tracker — notes for Claude

Prop Tracker is a phone-first web app (React + Firebase) for a film production
team's arts department. It is being extended into a click-and-collect system:
creators reserve props, the arts department picks/packs them, everything is logged.

## How to work with the owner (always follow these)

- The owner has almost no coding experience. Claude does the technical work; the
  owner makes the decisions.
- Explain things in plain language. No jargon without a one-line explanation.
- Work in small steps. After each step, say what changed and how the owner can
  see it working themselves.
- Work on a git branch, never directly on `main`. Commit often with clear messages.
- Never delete or overwrite existing prop data. Test against a copy or the
  Firebase emulator, not live data.
- Ask before anything that costs money, deploys to the live site, or changes
  Firebase billing or security rules.
- When a decision belongs to the owner, give 2–3 options with a recommendation,
  then wait.
- When giving the owner commands to run, give the exact command and say what
  success looks like.
- At the end of each phase, update the "Project status" section below in plain
  language so a fresh session can pick up cleanly.
- Each phase: stop, summarize, explain how to test it, wait for the go-ahead.
- Run the automated tests (double-booking + security rules) before calling a
  phase done. Test each phase on a Firebase preview channel before it goes live.
- Ask the owner which email service to use before picking one.
- Out of scope for now: actors, locations, Google Calendar. Do not build these.

## Build plan

1. Foundation: login with two roles (Creator, Arts department/admin), clean prop
   data structure, security rules.
2. Search and prop pages, automatic AI tagging on add.
3. Availability and reservations (date ranges, quantities, lead time, no double-booking).
4. Arts department queue, request statuses, email notifications.
5. Returns, audit trail, damage tracking, late returns.
6. Batch import of 1,000+ props (dry run of 10, review screen, resume, cost cap).

## Project status

Phases 1 and 2 are built and tested locally. NOTHING IS DEPLOYED YET.
The owner decided to deploy after Phase 2; next step is the go-live checklist below.
The old UID-based users (Keanu, friend #3) do not need access; only the owner does for now.

### Phase 1 (Foundation)
- Roles in Firestore `users/{lowercase email}` (`role`, `active`):
  owner (full admin; `alexisricordi@gmail.com` hard-coded in `src/config.ts`,
  `firestore.rules`, `storage.rules`, `functions/src/index.ts`), arts (inventory
  + invite creators), creator (search + view only).
- Invite-only Google sign-in; People screen at `/users`.
- Nothing is deleted: props are archived, users deactivated. Rules block deletes.
- Prop fields: name, photos[], tags, categoryId, quantity, condition
  (good/fair/damaged), bin/location, replacementCost, notes, description, archived.
- Old records are converted on read (`src/services/itemShape.ts`); legacy fields are kept.
- Categories editable at `/categories`. Videos feature removed.

### Phase 2 (Search, prop pages, AI)
- Server functions in `functions/` (region northamerica-northeast1 / Montréal):
  `analyzePropPhoto` (staff), `searchSimilar` (members), `onItemWritten`
  (auto-indexes props for smart search), `rebuildSearchIndex` (owner).
  The Gemini key is a Firebase secret (`GEMINI_API_KEY`); it is no longer in the website.
  Models live in `functions/src/gemini.ts` (`gemini-3.5-flash-lite`, `gemini-embedding-2` @ 768 dims).
  In the emulator with no key, functions return fake answers (free, offline).
- Smart-search fingerprints live in `item_vectors/{id}` (server-only, Firestore vector
  index in `firestore.indexes.json`). Old per-prop `embedding` arrays are legacy, unused.
- Search screen: 2-across photo grid, A–Z, Category + Availability filters
  (staff also get "Archived"), matches name/tags/description/notes, then
  "Similar, might work too" (cut-off `SIMILAR_MIN_SCORE` in `src/config.ts`;
  tune after go-live with real props).
- Add prop: AI fills name, category, tags (reusing existing spellings), description;
  fields marked ✦ AI; admin reviews.
- Notes: `notes` = "Notes for creators" (public); internal notes in
  `item_private/{id}` (staff-only rules).
- Admin tab = menu (`/admin`). Health page `/health` (owner + arts): fix-it list,
  inventory counts, look-alike tag merge, possible duplicate props (dismissals in
  `health/dismissed`), empty bins/areas, unused tags, AI usage, CSV export.
- High-value warning at $500+ (`HIGH_VALUE_THRESHOLD`).

### Testing
- `npm test`: 61 tests in the emulator (rules, server functions, search/health logic).
- Try it locally: `npm run emulator`, then `npm run seed`, then `npm run dev:emulator`,
  open http://localhost:5173 and use the "Test mode: sign in as" buttons.
- CI: `.github/workflows/preview.yml` runs the tests on every push to a non-main
  branch and, once the secrets exist, publishes to the `preview` channel.

### Go-live checklist (each step needs the owner's OK)
1. Owner adds GitHub secrets (deploy service account + VITE_FIREBASE_* values).
2. Set the Gemini secret: `firebase functions:secrets:set GEMINI_API_KEY`.
3. Deploy server functions, Firestore rules + vector index, Storage rules
   (these are live-wide; the old site keeps working for the owner).
4. Owner opens the preview, tests, then runs "Rebuild smart search" on Health.
5. Deploy hosting to live.
6. Later, with approval: remove the obsolete `embedding` arrays from props
   (they make every phone download extra data).

### Next
- Phase 3: availability calendar + reservations (date ranges, quantities,
  lead time, no double-booking).
