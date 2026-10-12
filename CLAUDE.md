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

### Phase 1 (Foundation): built and tested locally, NOT yet deployed
Waiting on the owner to approve deploying security rules + a preview channel.

What exists now:
- Three roles stored in Firestore `users/{lowercase email}` with `role` and `active`:
  - owner: full admin. `alexisricordi@gmail.com` is hard-coded as owner in
    `src/config.ts`, `firestore.rules`, `storage.rules`, so it can never be locked out.
  - arts: manages inventory (props, categories, bins, storage areas, tags,
    characters, checkouts) and can invite/turn off creators only.
  - creator: search + prop pages only (read-only).
- Sign-in: Google sign-in, then the email must be in `users` and active. People
  screen (`/users`) invites people; no emails are sent yet (Phase 4).
- Nothing is ever deleted: props are archived (`archived: true`), users are
  deactivated (`active: false`). Rules block deletes.
- Prop fields: name, photos[] (first = cover), tags, categoryId, quantity,
  condition (good/fair/damaged), bin/location, replacementCost, notes,
  description, archived. Characters are arts-only.
- Old records are converted on read in `src/services/itemShape.ts` (no data
  migration was run). Legacy fields (`itemType`, `cost`, `photoUrl`,
  status "damaged") are kept and still understood.
- Categories: `categories` collection, editable at `/categories`. Defaults
  (Prop, Costume, Set Dressing, Gear) are created the first time staff open the app.
- Videos/Drive checklist feature removed (old `video_checklists` data kept,
  owner-read-only).

How to test locally (emulator = private offline copy, never touches live data):
- `npm test`: runs 36 automated tests (security rules + reading old records).
- `npm run emulator` (terminal 1), `npm run seed` (sample data),
  `npm run dev:emulator` (terminal 2), then open http://localhost:5173 and use
  the "Test mode: sign in as" buttons.

Known issues / next up:
- Before deploying rules live: invite Keanu and friend #3 (old UID-based
  users) via the People screen, or they lose access.
- `text-embedding-004` is shut down, so "similar" search returns nothing. Fix in Phase 2.
- Gemini API key is still in the browser bundle. Move server-side (Phase 2 or 6).
- Current Checkout screen is the old simple one; replaced in Phase 3.
- Next: Phase 2 (search, filters, prop pages, auto AI tagging).
