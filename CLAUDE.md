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

Phases 1–4 (plus Phase 5's photo returns and check-in) are built and tested.
LIVE NOW (Oct 12, 2026): backend — all server functions, new Firestore + Storage rules, indexes.
Oct 13: per-category turnaround (costume washing days) deployed to the backend too.
NOT live yet: the website itself (hosting). The live site still runs the OLD app; the new app
is only on the preview link. Owner is testing the preview next.
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

### Phase 3 (Availability and reservations)
- Booking rules in `functions/src/booking.ts`, shared by server and app
  (the app imports it via `../../functions/src/booking`). Dates are 'YYYY-MM-DD'
  in America/Toronto.
- Settings in `app_settings/booking`: `leadTimeDays` (default 3; arts/owner skip it)
  and `bufferDays` (turnaround, default 1). Editable at Admin → Booking rules (arts + owner).
  Per-category turnaround (e.g. costumes need washing): `categories/{id}.turnaroundDays`
  (0–30; blank = use the default), set on the same screen; `turnaroundFor()` in booking.ts
  picks it, used by `createReservation` and the app's availability (`src/hooks/useTurnaround.ts`).
- Closed days (Phase 5, owner decision): `closedWeekdays` (0=Sun…6=Sat, default [0] = Sundays) and
  `closedDates` (holidays) in app_settings/booking, set in Booking rules. Shoots CAN be on closed days.
  Notice and turnaround count only open days (`addOpenDays`); pickup is the last open day on/before
  the shoot (`pickupDay`); props are late from 10am on the next open day after the shoot (`returnDueDay`,
  `RETURN_DEADLINE_HOUR`). Calendar shows "closed"; queue urgency counts to pickup day.
- A unit is tied up from shoot start to end + buffer. If the end date passes and the
  reservation isn't marked returned, the hold stays open-ended (owner's choice:
  props come back only when someone marks them returned). Props on the old
  quick-checkout screen (`status: 'checked-out'`) are unavailable until returned there.
- Creators can't reserve damaged props; archived props can't be reserved at all.
- `reservations/{id}`: title, notes, creatorEmail/Name, startDate/endDate, status
  (`requested` | `declined` | `cancelled` | `returned`), lines[{itemId, itemName, qty, photo}],
  itemIds, history[]. Written ONLY by server functions.
- `item_bookings/{itemId}.entries[]`: active holds (no names). Server functions update
  these inside transactions, which is what prevents double-booking (tested with races).
- Server functions: `createReservation`, `cancelReservation` (own or staff),
  `declineReservation` (staff, reason required), `markReservationReturned` (staff;
  placeholder until Phase 5's return check).
- App: shoot-date picker on Search (cards show Free / "3 of 10 free" / Booked),
  availability calendar + "Add to reservation" on prop pages, cart (kept on the phone),
  `/reserve` review + submit, Bookings tab (`/reservations`, creators see own, staff see all),
  booking detail with cancel/decline/mark returned + history.
- Old quick Checkout moved to Admin menu until Phase 4 replaces it.
- Needs the composite index in `firestore.indexes.json` (reservations: creatorEmail + startDate).

### Phase 4 (Pick & pack queue) + Phase 5 returns/check-in
Owner decisions: pack photo required (≥1 of everything packed); creator signs off pickup on
their phone (only the creator who booked can); creator return photo required; arts then
checks in each prop; pickup is always the same place (no pickup-spot field); build requests =
description + qty + optional reference photo; can't-find props are marked "not available"
with a reason (rest still goes); built props can be added to inventory at check-in;
email service: DECIDE LATER (status emails are queued in `outbox`, nothing sends yet).
- Statuses: requested → preparing ("Being picked" / "Being built or sourced") → packed
  ("Packed & ready") → collected → return_pending ("Returned, being checked") → returned.
  Cancel/decline allowed until collected. All holds stay until returned (check-in).
- Server functions: setLinePick, setBuildState, markPacked, confirmPickup, startReturn,
  checkIn (+ create/cancel/decline). `markReservationReturned` was removed.
- Check-in: damaged → prop condition 'damaged'; missing → prop `missingQty` (not bookable
  until "Found it" on the prop page); built props optionally become new items (no photo,
  so they show on the Health fix-it list).
- Storage: `reservation-photos/{resId}/{pack|return|checkin}/` (add-only; visible to that
  creator + staff), `request-photos/{email}/` (build reference photos).
- App: staff tab "Queue" (To prepare / Ready / Out / Returns / Done, urgent shoots flagged);
  booking page shows progress line, picking list grouped by storage area → bin with instant
  double-tap-safe ticks, pack photos, pickup sign-off, return form, check-in form, history.
  Creators: "My bookings", "+ New request", build requests on the reservation screen.
- Phase 5 remainder was built Oct 13 (see "Next" below).

### Fixes after first live test (Oct 12)
- Callable functions were unreachable (HTTP 401): failed first-deploy creates left them without
  the public invoker, and `firebase deploy` does NOT re-apply it on updates even with
  `invoker: 'public'` (CALLABLE in functions/src/auth.ts). Fix that actually worked: the
  deploy workflow's last step sets allUsers→run.invoker on every callable with gcloud.
  When adding a new callable function, ADD IT TO THAT LIST in deploy-backend.yml (and the
  check list in server-logs.yml). Functions still check sign-in + role themselves.
- Owner request: bookings max 1 day by default → `maxDays` in app_settings/booking (1–60,
  editable in Booking rules). Creators limited; arts/owner can book longer. With maxDays 1 the
  date picker shows a single "Shoot day" field. Date fields now stack (they overlapped on phones).
- Owner feedback round 2: ONE shoot day per booking for everyone (UI always single "Shoot day",
  "props due back the same night"); "Longest booking" control removed from Booking rules
  (server maxDays still defaults to 1 for creators). Creators don't see bin/storage
  locations (prop page hidden; /bin QR pages staff-only). Reserve screen bottom padding fixed.
  Smart search does NOT need manual rebuilds: onItemWritten indexes new/edited props.
- "View as" (Account screen, owner only): preview the app as Arts or Creator. UI-only; the server
  still treats the owner as owner. Sky-blue strip at top with Exit.
- `.github/workflows/server-logs.yml`: read-only "Read server logs" button (invoker access,
  failed requests, function errors) for diagnosing live problems.

### Testing
- `npm test`: 188 tests in the emulator (rules, server functions incl. double-booking races and the full pick→return journey, booking/search/health logic).
- Try it locally: `npm run emulator`, then `npm run seed`, then `npm run dev:emulator`,
  open http://localhost:5173 and use the "Test mode: sign in as" buttons.
- CI: `.github/workflows/preview.yml` runs the tests on every push to a non-main
  branch and, once the secrets exist, publishes to the `preview` channel.

### Deploying
- Preview (hosting only): automatic on every push to a non-main branch →
  https://proptracker-9732e--preview-9kd7p2pf.web.app (uses the REAL database).
  GitHub secrets: FIREBASE_SERVICE_ACCOUNT (github-preview account) + 6 VITE_FIREBASE_*.
- Backend (functions + Firestore rules/indexes + Storage rules): manual button,
  GitHub → Actions → "Deploy backend" → Run workflow (`.github/workflows/deploy-backend.yml`).
  Uses secret FIREBASE_DEPLOY_SERVICE_ACCOUNT (github-deploy account). Gemini key lives in
  Google Cloud Secret Manager as GEMINI_API_KEY (never in GitHub). Always ask the owner first.

### Go-live checklist (each step needs the owner's OK)
1. ✅ GitHub secrets added (8).
2. ✅ Gemini key stored in Secret Manager (new "AQ." style key; sent via x-goog-api-key header).
3. ✅ Backend deployed (needed Cloud Billing API enabled; first run had flaky Cloud Build
   failures, the workflow now retries once and sets a 7-day image cleanup policy).
4. Owner opens the preview, tests, then runs "Rebuild smart search" on Health.
5. Deploy hosting to live.
6. Later, with approval: remove the obsolete `embedding` arrays from props
   (they make every phone download extra data).
7. After hosting goes live: delete the OLD Gemini key (it was exposed in the old website code).

### Next
- Go-live (owner adding GitHub secrets).
- Deploy gotcha: the deploy fails if the code even DECLARES a secret that doesn't exist, so
  `defineSecret('SMTP_PASSWORD')` only runs when SMTP_SECRET_READY is true (or in the emulator).
- Email ON HOLD (Oct 13): no new Gmail possible; Proton needs a domain; Yahoo's app-password button is
  greyed out (owner thinks account must age a few days); iCloud is the fallback. To turn on: owner
  stores SMTP_PASSWORD in Secret Manager → set `SMTP_SECRET_READY = true` in functions/src/email.ts →
  (with owner OK for Cloud Scheduler) uncomment `checkLateAndAtRisk` in notices.ts → deploy →
  owner sets Admin → Email. Until then emails are logged as "skipped" (deploys work without the secret).
- Email code (built Oct 13): first plan was a Gmail inbox (no domain DNS access),
  Resend later. `functions/src/email.ts`: `sendQueuedEmail` (on outbox create; SMTP via nodemailer 10;
  'arts-team' = active arts + owner; host 'fake' or emulator w/o password = practice send) and
  `sendTestEmail` (owner). Settings in app_settings/email (owner-only screen Admin → Email, presets
  Gmail/Resend/Brevo); password = Secret Manager SMTP_PASSWORD (deploy FAILS until it exists).
  `functions/src/notices.ts`: `checkLateAndAtRisk` hourly (Cloud Scheduler — owner OK needed) +
  `checkNoticesNow` (owner): emails late creators + arts once (lateNotifiedAt) and at-risk
  bookings once per prop (riskNotified). Owner reads `outbox` (rules). After go-live, change
  "Link in emails" to the live URL.
- Phase 5 remainder (owner's decisions, Oct 13), in steps:
  1. ✅ Closed days (deployed Oct 13).
  2. ✅ Late returns: `isLate()` in booking.ts = status 'collected' and past 10am on the next open
     day after the shoot. `createReservation` refuses creators with late props (problem 'late');
     arts/owner never blocked. App: LateBanner (Search + Reserve screens, Reserve button disabled),
     "Late" badge in Queue/booking page with due time. Reminder EMAIL deferred until an email
     service is picked (needs a scheduled function = Cloud Scheduler; ask owner then).
  2b. ✅ At-risk upcoming bookings (owner: warn arts + creator): item_bookings entries get `out: true`
     at confirmPickup (removed at startReturn). `lineRisk()` in booking.ts flags a not-yet-picked line
     of a requested/preparing booking when another holder is late, or the prop is damaged/missing.
     App: `src/hooks/useAtRisk.ts`; amber "⚠ At risk" on Queue/My bookings cards; warning box on the
     booking page (creator gets "Find similar" → Search with ?q=). Email for it comes with the sender.
  3. ✅ Activity log (built Oct 13): `functions/src/activity.ts` triggers write `activity/{id}`
     (server-only; staff read). `logItemChange` diffs TRACKED_FIELDS on items (who = updatedBy: email
     from server, sign-in ID from the app → looked up). Rules now REQUIRE items' updatedBy == the
     signed-in user's ID (old live app already does this). `logReservationChange` turns each new
     history entry into `{resId}_h{n}` + "not available" marks. Screen: Admin → Activity
     (`src/components/ActivityList.tsx`, reusable with itemId / creatorEmail filters). Indexes for
     activity (kind/itemIds/creatorEmail + at desc) in firestore.indexes.json.
  4. ✅ History pages (built Oct 13): prop page "Show history" (staff; `src/components/PropHistory.tsx`:
     "Who had it" from reservations where itemIds contains the prop + "Changes" from activity) and
     `/people/:email` (staff; `PersonHistoryScreen`, opened from People → person → "Bookings &
     history" or "Booked by" on a booking): bookings, late returns (`wasReturnedLate`), damaged/
     missing with current replacement cost and total (`src/lib/history.ts`; records only, no billing).
  PHASE 5 IS COMPLETE except email sending (on hold). Owner to test on the preview.
- COLLECTIONS (Oct 13, owner decision): the props already in the app are the OWNER'S OWN (at home);
  imported props are Prime Capitol's. Item field `collection`: 'company' (Prime Capitol, everyone) |
  'personal' (owner only). MISSING FIELD = PERSONAL (no existing data changed). `functions/src/collections.ts`.
  Enforced in firestore.rules (items read/create/update, item_private), createReservation (personal =
  "Unknown prop" for non-owners), searchSimilar (filtered), activity (personal changes →
  `activity_personal`, owner-only). Non-owners must query items with where('collection','==','company')
  (index added). App: owner switch Prime Capitol/Personal on Search, "Belongs to" on add/edit
  (owner only; arts always company), Personal badge, Activity → Personal tab (owner).
  Imported and built-at-check-in props are 'company'. Seed has one personal prop ("Grandma's brass lamp").
- Phase 6 (batch import) BUILT Oct 13, NOT deployed. Owner decisions: photos are in Google Drive
  (~70 folders, ~1,500 photos), app pulls them directly; one prop per photo; a sign in each photo
  names the bin, and "x2"/"x3" signs give quantity; unknown bins → suggested new bin (created on
  approve in storage area `locations/imported` "Imported – needs sorting"); hard cap $10.
  Server: `functions/src/drive.ts` (Drive API as the functions' service account — owner shares the
  folders with that email as Viewer; Google Drive API must be enabled on the project; sharp shrinks
  photos to 1600px JPEG, HEIC falls back to Drive's thumbnail; emulator fake folders "test:N"),
  `functions/src/importer.ts` (importInfo, startImport [owner], processImport [owner; 8 photos/call,
  client loops], approveImports/skipImports [staff]), `analyzeImportPhoto` + PRICE_PER_M in gemini.ts,
  `functions/src/tags.ts` (server tag normalizing). `import_items/{driveFileId}` = one record per
  Drive photo forever (resume/no duplicates); `import_jobs/{id}` with counts + spentUsd; budget in
  app_settings/import {capUsd, spentUsd} — each AI call reserves $0.01 first in a transaction.
  App: Admin → Import (`ImportScreen`), review at /import/:jobId (`ImportReviewScreen`).
  Estimate: ~$0.002/photo → ~$3 for 1,500. Ask the owner before the full run.
  DEPLOYED Oct 13; owner's dry run "did really well". Follow-ups (Oct 13):
  - Bin names: review screen no longer prefixes "Bin"; new bins from signs are tidied ("bin 5" → "Bin 5").
  - Duplicates (same prop photographed several times): review screen has tick boxes, "N look-alikes"
    chips (same AI name + bin), "Merge into one" (identical copies → quantity, or same prop more angles)
    and "Add to existing…" (extra photos and/or units on a Prime Capitol prop) → `mergeImports`.
  - Testing clean-up (owner decision: IMPORTED props only, owner only, never ever-booked ones):
    `undoImport` (deletes the job's props + photos + records so the same Drive photos can be imported
    again) and `deleteImportedProp` (button on imported props). Logged in activity as 'deleted'.
    Client deletes are still blocked by the rules; only these server functions delete.
  - Owner reported "merging two gave two ×2 entries": it was ONE prop; the Approved tab listed each
    photo separately. Approved tab now shows one entry per prop (with all its photos and quantity).
  - DUPLICATE FINDER (owner idea; Admin → Find duplicates, `src/screens/DuplicatesScreen.tsx`,
    `functions/src/dedupe.ts`): `findDuplicates` = free pairwise similarity of existing item_vectors
    fingerprints (≥0.86, top 300, skips health/dismissed pairs shared with Health); `comparePropPhotos`
    = optional Gemini photo check (~$0.001, counted in the import cap); `mergeProps` (owner) keeps one,
    adds photos (+ quantity for copies), deletes the other if imported & never booked else archives it
    (`mergedInto`), re-points import_items so re-imports don't resurrect it. Refuses props in a current booking.
  - Rooms: bins already belong to "storage areas" (= rooms); imported bins go to "Imported – needs
    sorting". Owner may later want "Room" wording and moving many bins at once.
