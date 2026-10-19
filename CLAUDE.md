# Prime App (was Prop Tracker) — notes for Claude

Prop Tracker is a phone-first web app (React + Firebase) for a film production
team's arts department. It is being extended into a click-and-collect system:
creators reserve props, the arts department picks/packs them, everything is logged.

## How to work with the owner (always follow these)

- OWNER'S GUIDE: plain-language manual in `docs/owner-guide.html`, published (private) at
  https://claude.ai/artifact/EAKCeBrx2mW7h1QxiXDVzR . Whenever a rule, role, setting or automatic job changes, update
  that file and republish it to the SAME URL (Artifact tool, `url` + file) so the owner never loses track.

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
- Out of scope for now: actors, locations, Google Calendar. Do not build these until the owner
  starts the NEXT SPRINT (see "Next sprint" below).

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
WEBSITE LIVE (Oct 13, owner OK): the new app is on https://proptracker-9732e.web.app (button GitHub →
Actions → "Deploy website (LIVE)", `.github/workflows/deploy-website.yml`: tests → build → publish to the
live channel with FIREBASE_SERVICE_ACCOUNT; undo = Firebase console → Hosting → release history → Roll back).
Pushes to the branch still only update the preview; the live site changes ONLY via that button (ask first).
Owner's real address: https://proptracker.arbcreative.co (custom domain on the same hosting). Sign-in failed
there at first ("nothing happens") because it wasn't in Authentication → Authorized domains; added Oct 13 with
the "Allow a web address to sign in" button (`.github/workflows/add-signin-domain.yml`, keeps existing ones;
owner OK). "Read server logs" now also lists the authorized domains. Invite messages link to LIVE_APP_URL =
proptracker.arbcreative.co (owner choice). Login now shows WHY Google sign-in failed (code in brackets).
iPhone Safari then showed "Unable to process request due to missing initial state" (the Google sign-in page ran
on proptracker-9732e.firebaseapp.com, a different address, and Safari blocks the hand-back). Fix (Google's
recommended): `signInDomain()` in src/firebase.ts uses the app's own address as authDomain on our 3 hosting
addresses (arbcreative, web.app, preview). Owner added https://<each>/__/auth/handler to the OAuth web client's
Authorized redirect URIs (Oct 13). A NEW address needs both: add it there AND to signInDomain's list + authorized domains.
Owner confirmed iPhone sign-in works. LIVE Oct 13 (website run 3) together with fast photos + proof-photo shrink.
INVITEE SIGN-IN "nothing pops up" (Oct 15, Ariel): likely opened the invite inside an app's built-in browser
(Instagram/Messenger/Gmail…), where Google blocks sign-in. Login now: `src/lib/inAppBrowser.ts` detects those and
shows "Open this page in Safari or Chrome" + Copy link; if the pop-up is blocked it falls back to signInWithRedirect
(works because authDomain = the app's own address) and getRedirectResult shows any error.
Ariel's video (Oct 15, real Safari): Google's sign-in page opened BLANK and closed → his AD BLOCKER (and Private
Browsing) blocked Google's sign-in scripts. Login now has "Trouble signing in? Sign in another way" (signInWithRedirect)
and, after an error, help text: Safari aA → Turn Off Content Blockers / use a normal tab. Can't be fixed from our side.
REAL CAUSE (Oct 15, ad blocker off and still failing; "Sign in with Google" opened new tabs of the home page): the PWA
service worker's navigateFallback answered /__/auth/handler (Firebase's Google sign-in page, same domain since
signInDomain) with the cached index.html. Phones that had opened the app before signing in were stuck. FIX:
vite.config workbox navigateFallbackDenylist [/^\/__\//]. NEVER remove it while authDomain = the app's own address. LIVE Oct 15 (website run 5, owner OK), with the login help/redirect fallback.
HOME-SCREEN "CHIN" (owner, Oct 16): black strip under the tab bar in iPhone home-screen mode = page shorter than the
screen. #root is now position:fixed; inset:0; overflow-y:auto (src/index.css). LIVE Oct 16 (website run 6) but DID NOT remove it: the "chin" is the tab bar's own bottom padding for the iPhone home-swipe zone (~34px; there is no address bar in home-screen mode). Fix: tab bar uses .pb-tabbar = safe area minus 18px (min 6px), Gear "Review" bar moved to match. LIVE Oct 16 (website run 7, owner OK).
UPLOADS BY NON-OWNERS FAILED (Oct 13: Farrell, arts, couldn't add a pack photo). Cause: storage.rules look up roles
in Firestore (firestore.get/exists), which needs role "Firebase Rules Firestore Service Agent"
(roles/firebaserules.firestoreServiceAgent) on service-727332101415@gcp-sa-firebasestorage.iam.gserviceaccount.com;
it only had roles/firebasestorage.serviceAgent. The owner never noticed (isOwner() is checked by email first).
FIXED Oct 14: owner granted that role in Google Cloud IAM (confirmed with "Read server logs", which shows this agent's roles). Proof photos
are now shrunk before upload and show "Not allowed"/"No signal" when one fails.
PROOF PHOTO DATES (owner decision Oct 14: stop people re-using old photos): proof photos (pack, return,
check-in, gear return) are CAMERA ONLY (ProofPhotos `cameraOnly` default true → input capture="environment",
"Opens your camera" hint; catalogue/reference photos pass cameraOnly={false}). `src/lib/photoTakenAt.ts` reads
the EXIF taken-date BEFORE shrinkPhoto (which drops it) and uploads it as Storage customMetadata {takenAt, source}.
`PhotoStamp` (under PhotoStrip + gear return photos) compares takenAt with the server's upload time
(timeCreated, can't be faked by the phone): "Taken Oct 14, 2:14 PM", red "⚠ Taken 3 days before upload" when
> 1 hour (OLD_PHOTO_MINUTES, owner choice), amber "⚠ No date on this photo". Photos from before this show nothing. LIVE Oct 14 (website run 4, owner OK).
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
- `npm test`: 391 tests in the emulator (rules, server functions incl. double-booking races and the full pick→return journey, booking/search/health logic).
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
5. ✅ Hosting deployed to live (Oct 13, run 1).
6. Later, with approval: remove the obsolete `embedding` arrays from props
   (they make every phone download extra data).
7. After hosting goes live: delete the OLD Gemini key (it was exposed in the old website code).

### Next sprint (owner's plan, Oct 13 — NOT started; plan with the owner first)
Everything Prime Capitol offers, bookable in one app:
- REBRAND the app (name/logo/colours; currently "PropTracker").
- GEAR: cameras, lights, drones, batteries… run by a DIFFERENT team (equipment, not arts), own
  queue/look; checked out in PACKAGES/kits.
- LOCATIONS: book and scout film locations.
- MAKEUP: book makeup for a video.
- CASTING: roster of actors with their look + availability; book them for shoots.
- CREW: e.g. book a camera operator.
Owner shared a real "GUIDELINE" (The Classroom): synopsis/structure/step-by-step (stays in their docs,
out of scope) + a CREW BOX = Actors (role, count, gender, ages, notes), Schedule (call times + location +
who), Locations, Make up (per role + supplies, e.g. black contacts), Props (item + qty), Equipment,
Wardrobe, Budget. Suggested to the owner (not decided): build a digital Crew Box = "Shoot sheet" as the
hub; props section = real bookings (exists); other sections start as structured requests to each
team's queue and upgrade to real booking one department at a time; AI pre-fills the sheet from an
uploaded guideline PDF and matches the props list to inventory. Proposed order: rebrand → Shoot sheet +
AI pre-fill → gear + packages → actor roster/casting → locations → makeup/crew.
OWNER DECISIONS for the sprint (Oct 13; owner answers the design questions personally):
- Order: GEAR → CASTING → MAKEUP → LOCATIONS (+ crew). Clickable mockups before building each.
- Every area = "pick from our library" OR "custom request" (same idea as prop build requests):
  existing locations or a custom location request; roster actors or a casting request; makeup/crew
  booking or a custom request.
- MAKEUP: one specific makeup person/team → needs its OWN LOGIN (new role) that can only set their
  availability and accept/decline/adjust their bookings. Same pattern may later serve crew/actors.
- GEAR (answered): mostly ready-made KITS (cases with several pieces; single extras can be added);
  booked by EXACT start/end HOURS (not whole days); a kit can go out again as soon as it's returned —
  no turnaround gap, but tell creators there's no guarantee on battery charge; out/in check = tick
  EVERY PIECE in the case; creators book with an INSTANT HOLD (gear team can decline), like props;
  run by a separate EQUIPMENT TEAM role (sees gear queue + gear inventory, not props); when a kit is
  taken show SIMILAR FREE KITS and WHEN IT'S NEXT FREE (no waitlist).
- CASTING (answered): separate CASTING TEAM role (casting only). Casting team keeps actors'
  availability (actors do NOT log in). Booking = creator REQUESTS, casting CONFIRMS (nothing final
  until confirmed). Creators can BOTH request specific actors by name AND post a ROLE (count, gender,
  ages, look, notes, call time; e.g. "x20 students 10M/10F 20-30 improv") for casting to fill.
  Hours = one block per day, CALL TIME → WRAP. Profile: photos/headshots + look, age range, gender,
  height, skills & notes (+ past shoots), rate & contact (STAFF ONLY). Creators see photos, look,
  skills, availability (not rates/contact). New people found for a role are ADDED TO THE ROSTER.
- MAKEUP (answered): ONE LEAD artist + helpers. The lead gets her own login (new MAKEUP role) to:
  set her availability, accept/decline/PROPOSE CHANGES (e.g. other call time), and see shoot details
  for her bookings only (looks, roles, location, call times). Booking = creator REQUESTS, lead
  CONFIRMS. Request includes LOOKS PER ROLE (+ reference photos) and NUMBER OF PEOPLE + TIMING
  (call time / camera-ready time). Helpers: the LEAD ADDS THEM (names) to a booking; helpers don't log in.
  Notice: no fixed rule — the lead decides per request. If the lead isn't free: creator PICKS ANOTHER
  DATE (no outside-artist custom request for makeup).
- LOCATIONS (answered): separate LOCATIONS role (location manager, own queue). Library has places
  you OWN/control and places that NEED PERMISSION (no "scouted ideas" list). Owned places = INSTANT
  hold; permission places = REQUEST the location manager arranges. Booked by EXACT HOURS (matches the
  guideline's schedule, e.g. road 12–5pm, house 5–8pm). Page shows photos + map/address, permissions
  & cost (staff only), past shoots there. CUSTOM REQUEST (place not in library): a LINK if they already
  know the place (e.g. Maps/Airbnb), description + reference photos, date, hours + crowd size.
  (Note: "locations" here = film locations; the existing `locations` collection = storage areas/rooms
  for bins — use a different name, e.g. `film_locations`, to avoid confusion.)
Suggested shape: generalise props into typed "bookable things" with departments (each with its
own queue), packages for gear, people (actors/crew/makeup) with availability, and a single
"Shoot" booking a creator fills with props + gear + location + people. Don't disturb existing
props/bookings. Calendar sync may come up with availability — ask the owner.

### SCHEDULING sprint (owner, Oct 16 — PLANNING, nothing built; "the heart of the app")
Today: shared Google Calendar; creators ask an assistant who books it. Goal: creators book their own
shoot slots in the app; props + gear (later casting/locations) hang off the booked shoot (shoot date
comes from the schedule). Owner open to smarter rules than today's. Owner answers (Oct 16):
- Two houses: 2375 Cliff Road ("Cliff 1") and 2371 Cliff Road ("Cliff 2"). No sharing: a booking takes
  the WHOLE house. Slots are usually 2 HOURS per creator; no setup/cleanup gap.
- Collabs: creators filming together shoot BACK TO BACK; app should offer booking adjacent slots together
  and find "next available slot (of a given length)".
- Approval INSTANT when within the rules (rules still to define).
- Offsite / specific-location shoots ALSO go on the schedule (props + gear depend on them), no house held.
- Cancellation/change rules: owner decides later.
- Google Calendar: bring EXISTING future bookings in. Maanik (equipment manager) runs the calendar today;
  schedule should be visible to ALL creators. Calendar also holds events, house maintenance, cleaners
  (anything affecting shooting) → need non-shoot blocks.
- COO WRITE-UP (Oct 16), current system: (1) Cliff 1: every creator GUARANTEED 4 slots/month, pre-scheduled
  manually (ChatGPT → Google Calendar) using availability + preferred partners, mixed up. (2) THURSDAY + SATURDAY =
  PRIORITY days for: Main Channel, Stromedy Studios, Jana, Aji, Kyle, Alex, DK, Ariel; every SUNDAY the unclaimed
  Thu/Sat slots of the coming week open to everyone, and booking those needs a FILMING GUIDELINE. (3) SUNDAYS open,
  first-come; crew is off (creators on their own). (4) EXTRA slots any time (mornings/evenings) if free; OFFSITE shoots
  recorded too (no guideline/resources needed) to track production. (5) Guideline ideally 96 HOURS before; no-show
  without notice → penalties / temporary loss of equipment + inventory access; same-day cancel of Thu/Sat → penalty.
  (6) Cliff 2.0: first-come for creators + Studios directors; LATER listed on Airbnb + Set Scouter, external rentals
  take priority. (7) Goal: automate monthly allocation, preferences/collabs, priority + Sunday release, guideline
  reminders, confirmations/cancellations/accountability, offsite records, real-time availability, Google Calendar sync.
- Claude proposed (Oct 16): fixed 2-h slot grid; monthly pick window with 4 Cliff 1 credits + auto-fill; priority group
  tag + automatic Sunday release (scheduled function → needs owner OK); guideline attached to the shoot with 96-h
  countdown + reminders; automatic strikes → pause props/gear (like late returns); staff "Block time" (events,
  cleaners, maintenance, external rentals); Cliff 2 external rentals as blocks (Airbnb calendar feed later);
  app = source of truth, writes ONE-WAY to the shared Google Calendar + one-time import of future events.
- OWNER DECISIONS (Oct 16, all recommended options): (a) monthly 4 Cliff 1 slots = PICK WINDOW + AUTO-FILL
  (window opens ~20th for next month, max 2 picks in the first day, collab partners can pick together, app
  auto-places non-pickers using their preferred days/partners); (b) FIXED 2-HOUR SLOT GRID (staff-editable);
  (c) AUTOMATIC STRIKES for no-shows + same-day Thu/Sat cancels → after N strikes props + gear booking pauses
  (threshold/time to set; staff can lift); (d) schedule managed by the EQUIPMENT role (Maanik) + owner.
  App = source of truth; ONE-WAY write to the shared Google Calendar + one-time import (not objected to).
- MOCKUP v1 (Oct 16): https://claude.ai/artifact/XFc1e3nJF33V1ftyXD7U2a (personas Maya creator / Jana priority /
  Maanik team; Schedule by house + day, Find a slot (2/4/6 h), Monthly picks (credits, suggestions, preferences,
  auto-fill note), My shoots (guideline countdown, strikes), Team: Did it happen? / Guidelines / Block time / Rules).
  GUESSES to confirm: slots 8 AM–10 PM (7 slots); picks open the 16th, close the 21st 6 PM (2 picks first day);
  Sunday release 9 AM; guideline reminders 2 days + 1 day before; strikes 2 in 30 days → 14-day pause; team cancels
  = no strike; cancelling ahead of time free; offsite needs no guideline; monthly slots only at Cliff 1.
- OWNER CHANGES (Oct 16) → MOCKUP v2 (same link): (1) "How it works" rules page for everyone, built from the same
  settings the team edits; (2) AUDIT that they actually filmed: creator CHECKS IN on the day (opens 15 min before,
  camera-only set photo with date stamp) and WRAPS ("what did you film?"); no check-in by slot end → flagged to
  the team (creator can explain within 24 h) → team marks "They filmed" or "No-show · strike"; team "Creators"
  view = booked vs filmed (30 days); every shoot has a History log; (3) GUIDELINE NOT REQUIRED (optional attachment);
  instead each department has a CUTOFF in open days before the shoot (guesses: props 3, gear 1, casting 7,
  location 7 for permission places, makeup = lead decides); (4) BOOK TIME FIRST, add props/gear/casting/location/
  makeup later from My shoots → shoot page, until each cutoff; (5) PARTNERS kept simple: up to 3 "usual partners";
  schedule marks free slots next to a partner's shoot with ★; booking can HOLD the next slot for one partner, who
  has 24 h to accept (else it opens to all; each uses their own slot); monthly picks "+ partner"; auto-fill places
  partners together; a priority creator can bring a partner onto a priority day.
- OWNER CHANGES (Oct 16) → MOCKUP v3 (same link): (1) monthly slots must NOT be a race → WISHLIST + FAIR DRAW:
  wishlist open 15th–20th, up to 8 ranked wishes (slot + optional partner), timing doesn't matter; on the 20th 6 PM
  the app runs 4 rounds, everyone gets one slot per round, turn order random, flips each round (snake) and rotates
  monthly; best still-free wish; partners who both wished adjacent slots are placed together; no wishes left →
  preferences (days/times); afterwards swap for any free slot. (2) NO HOLDING slots for partners (owner: messy; if
  ever, 1 hour max): booking can INVITE a partner to the next slot (notice + link), not held, first to book gets it;
  an invite from a priority creator lets the partner book that priority-day slot. (3) Remove the "copied to Google
  Calendar" tagline from creator screens (team settings only). (4) REIMAGINED CREATOR APP around THE SHOOT (designed
  as if from the start; staff keep dedicated views): creator tabs HOME (next shoot card with Check in, To do list:
  invites, "Props for <shoot>? add by…", wishlist; Coming up; Book a shoot) / BOOK (Cliff 1 | Cliff 2 | Offsite,
  day strip, slots, "Find a time" sheet) / BROWSE (Props & costumes | Gear, always "Adding to: <shoot>" bar with
  availability for that shoot's day/hours; closed after cutoff) / ME (wishlist, monthly slots, strikes, usual
  partners, past shoots, How it works). Shoot sheet = hub (check-in/wrap, needs with cutoffs → Add jumps to Browse
  with that shoot, optional guideline, history, cancel). Every prop/gear request belongs to a shoot (replaces the
  separate baskets + shoot-day picker). Team persona (Maanik): Schedule / Team (Check-ins, Creators, Block,
  Settings incl. draw + Sunday release) / How it works. Arts + equipment queues stay, each request shows its shoot.
- OWNER ANSWERS to the guesses (Oct 16, one by one):
  1. Partner invite HOLDS the next slot for the invited partner for 10 MINUTES, then it opens to everyone. (Changed to 20 MINUTES Oct 17.)
  2. Slots: 9 per day, 2 h each, first 7–9 AM, last 11 PM–1 AM (crosses midnight!).
  3. Wishlist open 15th–20th, draw 20th 6 PM.
  4. Sunday release of unclaimed Thu/Sat slots at 6 PM.
  5. Strikes: 2 in 30 days → props + gear paused 14 days (team can lift).
  6. Cutoffs (open days before the shoot, Sundays don't count): NEW props (build requests) 4, props from
     inventory 2, gear 2, casting 4, location 4; makeup = lead decides. (App today: props 3, gear 1 → change in build.)
  7. Check-in opens 15 min before the slot; missed check-in → creator has 12 HOURS to explain, then Maanik decides.
  8. Checked in but no wrap = counts as filmed (noted in history). NEW: at check-in the next creator can REPORT
     the slot before them: ran over into my time (minutes) and/or house left a mess, with camera photos.
  9. Reports go to Maanik (Team tab) who dismisses or turns them into a strike (no automatic strike).
  Defaults kept (not asked): up to 3 usual partners; cancelling before the day is free; team moves/cancels = no strike;
  offsite shoots need no guideline; monthly slots only at Cliff 1; guideline optional.
- MOCKUP v4 (same link, Oct 16): new slot grid, 10-min invite hold ("Held for X · opens at…"), cutoffs split
  (props 2 / new props 4 / gear 2 / casting 4 / location 4), 12 h to explain, Sunday 6 PM release, CHECK-IN SHEET
  (set photo + "The slot before you": ran over N min / house left a mess + photos) → REPORTS reviewed by Maanik in
  Team → Check-ins ("Reports to review": Dismiss / Strike for X); reports logged on both shoots' history.
- MOCKUP v5 (Oct 16, owner: keep browse/search + picks + find): Browse = full catalogue ANY time (search incl.
  hidden words, categories, "Similar, might work too", item sheet with upcoming bookings + Suggest an edit); a shoot
  is only needed to ADD ("Adding to <shoot>" bar, or "Just browsing"). Book header: "Find a time" + "Monthly picks".
  PARTNERS clarified: "Favourite partners" = private one-way shortcut list (★ on schedule, first in invite list);
  lists don't need to match. The draw pairs people ONLY when BOTH wished for the same back-to-back pair naming
  each other (favourites never used by the draw or auto-fill).
- EMAIL (Oct 16): owner now has alex@primecapitol.ca and wants app emails sent from it, maybe via an alias
  (e.g. bookings@). Provider = GOOGLE WORKSPACE. Plan (email.ts already supports a separate fromAddress): owner adds
  alias in admin.google.com (Users → Alex → alternate email), adds it in Gmail Settings → Accounts → "Send mail as",
  turns on 2-Step Verification and makes an APP PASSWORD (myaccount.google.com/apppasswords), stores it in Secret
  Manager as SMTP_PASSWORD (never in chat) → Claude sets SMTP_SECRET_READY = true + backend deploy (owner OK) →
  owner sets Admin → Email: Gmail/Workspace preset, login alex@primecapitol.ca, from = alias, name "Prime App",
  then "Send test email". Timed reminders (checkLateAndAtRisk) still need the Cloud Scheduler OK.
  ON HOLD (Oct 17): owner has no Workspace ADMIN access yet (can't add alias / app password). Resume when they do.
- PROPOSED BUILD STEPS (Oct 16, awaiting owner go-ahead): (1) schedule core: houses, slot grid, blocks, instant
  booking/cancel with no double-booking (transactions like props), Book screen + team Schedule/Block, How it works,
  settings; (2) Google Calendar: one-time import of future events + one-way copy of every booking/block (owner shares
  the calendar with the functions' service account; Calendar API on; free); (3) shoot-centred creator app: Home /
  Book / Browse / Me, shoot sheet, props + gear attach to a shoot, new cutoffs; old bookings keep working;
  (4) check-in/wrap, reports, missed check-in flags, strikes + automatic pause, Creators view; (5) priority days +
  Sunday release + partner invite 10-min hold (scheduled function → Cloud Scheduler, cents/month, owner OK);
  (6) monthly wishlist + fair draw (scheduled, 20th 6 PM). Notices in-app (To do) until email is set up.

- STEP 1 BUILT (Oct 17, owner said go; NOT deployed: backend needs owner OK — new rules + 6 functions + index):
  - Shared rules `functions/src/schedule.ts` (app + server): settings in app_settings/schedule (cleanScheduleSettings;
    defaults = owner answers: slots [420…1380] 2 h, 4 monthly Cliff 1 slots, priority Thu+Sat until Sunday 6 PM,
    priority group = list of {email,name}); slotState / findFree / priorityLocked / releaseStamp / checkSlot.
  - ONE DOC PER DAY `schedule_days/{YYYY-MM-DD}`: cliff1/cliff2 maps slot start ('780') → {shootId, name, kind},
    offsite[] {shootId,name,start,end,where}, blocks[] {id,house,start,end,type,note}. Booking writes it in a
    transaction → no double-booking (race tested). Slots keyed by START MINUTE, so changing the grid never breaks
    old bookings. `shoots/{id}`: creatorEmail/Name, place cliff1|cliff2|offsite, where, date, month, start/end,
    from/to stamps (last slot ends next day 1 AM), kind monthly|extra|offsite, status booked|cancelled, bookedBy,
    lateCancel (same-day priority-day cancel; strikes come in step 4), history.
  - Server `functions/src/scheduling.ts`: bookShoot (owner/arts/creator/equipment; team may book forEmail and skips
    priority lock; monthly only at Cliff 1, counted per month; offsite needs `where`), cancelShoot (own before start,
    or team any time = "by the schedule team"), addScheduleBlock (team; refuses over a booking, says whose),
    removeScheduleBlock, saveScheduleSettings, listSchedulePeople (team; equipment can't read users).
  - Rules: schedule_days read members+equipment; shoots read own or owner/equipment; app_settings/schedule readable
    by equipment too; no client writes. Index shoots creatorEmail+date. Functions added to deploy/log lists.
  - App: tab "Schedule" for everyone (creators: Props/Schedule/Gear/Bookings/Account; staff + equipment too).
    `ScheduleScreen` (/schedule): Cliff 1 | Cliff 2 | Offsite, 35-day strip (gold dot = your shoot), next-shoot card,
    notes (Sunday no crew, priority lock with release time, Cliff 2), slot rows (Free / name / You / Blocked /
    Priority only 🔒 / Past), sheets: Book (Monthly N left / Extra; team "Book for"), Your shoot (details, history,
    cancel with confirm + same-day warning), team Book-or-block (types + all day), remove block, Find a time
    (2/4/6 h, either house, 60 days). Offsite tab lists + adds offsite shoots. `ScheduleSettingsScreen`
    (/schedule/settings, owner+equipment): houses, slot chips, monthly count, priority weekdays + release time +
    priority group checklist. `ScheduleRulesScreen` (/schedule/how) = How it works from live settings.
  - Seed: jana@ (priority) + kyle@ creators, 5 shoots, a cleaners block. Tests: 296 (unit schedule + functions
    schedule + rules). Checked in a browser on the emulator (creator books/cancels, Thu locked, team books for
    Kyle, blocks, saves settings).
  - Owner must set the real PRIORITY GROUP in Schedule → Settings after deploy (names need app accounts).
- OWNER DECISIONS (Oct 17, before deploying step 1):
  - GOOGLE CALENDAR = app writes every booking/move/cancel/block to the shared calendar (one-way) + one-time import
    of future events with a REVIEW screen for Maanik (match who/house/slot; non-shoots → blocks) + a private
    per-person "Add to my calendar" subscribe link (iCal feed of their own shoots). No two-way sync.
    Owner steps later: share the calendar with the functions' service account ("Make changes to events"), Calendar API on.
  - MOVING: free with ≥ 48 HOURS notice (move = switch to a free slot atomically, monthly stays monthly). Inside
    48 h a move or cancel COUNTS AS A NO-SHOW unless it's a SWAP with another creator (request → they accept →
    both shoots switch in one step). Only swaps save it (owner chose "swap only", not "someone else books it").
    Team moves/cancels never count.
  - OFFSITE: one "Book a shoot" entry asks Cliff 1 / Cliff 2 / Somewhere else; offsite = ANY start/end time in
    half hours (not the 2-hour grid) + where (address or Maps link).
  - PROFILES: Google photo by default (initials on a colour if none), upload your own (circle crop, shrunk) +
    CHANNEL NAME/handle shown under your name. Team can remove a photo. Shown on schedule slots, next-shoot card,
    queues, People.

- STEP 1 EXTRAS BUILT (Oct 17, owner chose "add first, deploy once"; NOT deployed yet):
  - MOVE (`moveShoot`): one transaction takes the shoot out of the old day doc and into the new one (never loses
    the old slot first); creators need ≥ noticeHours (settings, default 48) before the start, team any time;
    monthly stays monthly at Cliff 1 (becomes extra at Cliff 2 or if the new month has no monthly left);
    house ↔ offsite moves refused (cancel + rebook). History 'moved' "from X to Y".
  - CANCEL inside the notice period by a creator = NO-SHOW: server refuses unless `confirmNoShow: true`, then marks
    shoot `noShow: 'late-cancel'` + `lateCancel: true` (strikes come in step 4). UNDO window: cancelling within
    10 minutes of booking is always free (`withinUndo`, UNDO_MINUTES) so mistakes don't count.
  - SWAPS (`requestSwap`, `answerSwap`): `swap_requests/{id}` {fromShootId,toShootId,from/to emails+names, from/to
    snapshots {place,date,start,end}, status pending|accepted|declined|withdrawn|expired}. One pending request per
    offered shoot; house slots only; any time before either starts (incl. inside 48 h — the only no-penalty way).
    Accept = both shoots trade place/date/start in one transaction (each keeps its owner; monthly only at Cliff 1);
    if either shoot changed since the request → 'expired'. Requester can withdraw; recipient declines/accepts.
    Rules: read by the two people + owner/equipment; server-only writes.
  - OFFSITE: any start/end in half hours, up to 18 h, may pass midnight (`offsiteHoursOk`); day doc offsite entry
    keeps start/end/where + email.
  - Day doc slot entries now include the creator's `email` (for faces + "mine"); profiles are company-visible anyway.
  - PROFILES: `profiles/{email}` {photoURL (uploaded), googlePhoto (saved automatically from Google sign-in by
    App.tsx), channel ≤60}. Rules: members + equipment read; you write your own; owner/equipment may edit anyone's.
    Storage `avatars/{email}/{file}` (own uploads, images only). `src/services/profiles.ts` (ProfilesContext in
    App, uploadProfilePhoto = centre square crop 400px JPEG), `src/components/Avatar.tsx` (photo or initials on a
    colour). Account screen: profile card (tap photo to change, "Use Google photo", channel name + Save).
  - App: Schedule has "Book a shoot" → Cliff 1 / Cliff 2 / Somewhere else (house → Find a time; else OffsiteSheet with
    day, from/until, where, team "Book for"); swap banners (incoming Accept/Decline, outgoing Withdraw); faces +
    channel on slot rows; taken slot → "Ask to swap"; Your shoot → Move (MoveSheet: free slots, house/either) /
    Swap with someone (SwapSheet) / Cancel (or "Cancel (counts as a no-show)" + amber notice inside 48 h).
    Settings: "Moving and cancelling" notice hours. How it works updated (moving/swapping/cancelling, offsite, undo).
  - Tests 308. Checked in a browser on the emulator (accept a swap, offsite any hours, move, profile photo + channel).
  - Functions added to deploy/log lists: moveshoot requestswap answerswap.

- STEP 1 + EXTRAS: backend DEPLOYED Oct 17 (run 25, green, owner OK). Preview has the app. Live website NOT updated yet (ask).
- STEP 2 (GOOGLE CALENDAR) PART 1 BUILT (Oct 17; NOT deployed — needs a backend deploy, owner OK):
  `functions/src/calendar.ts`:
  - PERSONAL FEED: `myCalendarLink` (callable, anyone; reuses one random 36-hex token in `calendar_tokens/{token}`
    {email, all (team), createdAt}, server-only; `reset: true` makes a new one and kills the old) → https URL +
    webcal URL of `shootsCalendar` (onRequest, public, ?t=token) = iCal feed (buildIcs: TZID America/Toronto,
    folded lines, REFRESH 1 h): creators get their own booked shoots ("Shoot · Cliff 1"), team gets everyone's
    ("Ana · Cliff 1"), −30…+120 days. App: Schedule → "📅 Add … to my phone's calendar" → CalendarSheet (webcal
    button for iPhone, Copy link for Google Calendar, make a new link).
  - SHARED GOOGLE CALENDAR (one-way): settings field `googleCalendarId` (Schedule settings, cleanScheduleSettings
    keeps it); triggers `syncShootToCalendar` (shoots/{id}: booked → upsert event id 's'+hex(shootId); else delete)
    and `syncBlocksToCalendar` (schedule_days/{date} blocks diff → upsert/delete 'b'+hex(date_blockId)); Calendar
    REST API with the functions' service account (google-auth-library, scope calendar.events); skipped in the
    emulator and when no ID. `testCalendarLink` (team) writes + deletes a test event, error names the service
    account to share with. Settings screen: Calendar ID input + "Test the connection".
  - OWNER STEPS before it works: Google Cloud → enable "Google Calendar API" on proptracker-9732e; in Google Calendar
    share the shared calendar with the service account shown by the test ("Make changes to events"); paste the
    calendar ID in Schedule → Settings → Save → Test.
  - IMPORT (built Oct 17): `previewCalendarImport` (team) lists future timed events (next 120 days) not made by the
    app ('s|b|t'+hex ids) and not already handled (`calendar_imports/{eventId}`), with guesses (`guessImport`: house
    from "cliff 2/2371" or "cliff/2375" else offsite; block if clean/maint/event/airbnb…; person = first name in
    the title; nearest slot). `applyCalendarImport` (team): shoot → `placeShootAsTeam` (scheduling.ts; slot must be
    free; kind extra/offsite; shoot.calendarEventId = original Google event, so the sync UPDATES it instead of making
    a copy) or block, then remembers the event. Screen `/schedule/import` (CalendarImportScreen, team) from Settings
    → "Import what's already in the calendar". Emulator returns 2 demo events. Imported shoots count as EXTRA slots.
  - Tests 312 (tests/functions/calendar.test.ts). Functions added to deploy/log lists: mycalendarlink
    testcalendarlink shootscalendar.
  - CALENDAR (feed + shared calendar + import) backend DEPLOYED Oct 17 (run 26, green, owner OK). Owner steps above still to do.
- STEP 4 BUILT (Oct 17; NOT deployed — new security rules + 6 functions → needs owner OK for a backend deploy):
  ON THE DAY + STRIKES. Settings (app_settings/schedule): checkinBefore 15, explainHours 12, strikeCount 2,
  strikeDays 30, pauseDays 14 (Schedule settings → "Check-ins and strikes"). Helpers in schedule.ts: checkinWindow,
  isMissed (booked, no check-in, no outcome, slot over), explainUntil.
  - `functions/src/attendance.ts`: checkInShoot (only the creator who booked; window opens checkinBefore min before,
    closes at slot end; ≥1 camera photo in Storage `shoot-photos/{shootId}/` (add-only; that creator + gear staff);
    optional REPORT on the slot before (same house, start − slotMinutes): overMinutes and/or mess (+ photos required)
    → `schedule_reports/{id}` status open, history on both shoots), wrapShoot ("what did you film?"; check in first),
    explainMissedCheckIn (within explainHours after the slot), decideShoot (team: 'filmed' | 'noshow' → noShow
    'missed' + strike), reviewReport (team: dismiss | uphold → strike on that person), liftPause (team).
  - `functions/src/strikes.ts`: addStrike → `strikes/{id}` {email, reason late-cancel|no-show|report, shootId, by, at}
    and `user_status/{email}` {strikes (in window, since liftedAt), pausedUntil}. strikeCount in strikeDays →
    paused pauseDays. assertNotPaused blocks CREATORS in createReservation + createGearBooking (house booking is NOT
    paused). cancelShoot inside the notice period (confirmNoShow) now adds a 'late-cancel' strike.
  - Rules: schedule_reports (gear staff or the reporter), strikes + user_status (gear staff or own), no client writes.
  - App: Your shoot sheet → `OnTheDay` (progress Booked / Checked in / Filmed; check-in with set photo + "The slot
    before you" chips Ran over (minutes) / Mess (photos); wrap; missed → explain box; team "They filmed" /
    "No-show · strike"). Schedule: pause banner + strike count, "Team" link (gear staff) → `/schedule/team`
    (ScheduleTeamScreen: Check-ins = needs a decision + yesterday/today with set photos; Reports = Dismiss / Strike
    for X; Creators = filmed of booked, missed, strikes, "Paused · Lift"). How it works: "On the day" + "Strikes".
  - Tests 318 (tests/functions/attendance.test.ts). Functions in deploy/log lists: checkinshoot wrapshoot
    explainmissedcheckin decideshoot reviewreport liftpause.
  - NOT automatic yet: nothing flags a missed check-in by itself (the team's Check-ins tab computes it on open);
    reminders need email + Cloud Scheduler.
- STEP 3 BUILT (Oct 17, owner "let's go next step"; NOT deployed — deploy together with step 4, needs owner OK):
  SHOOT-CENTRED CREATOR APP. Creators' tabs: HOME (/) / BOOK (/schedule) / BROWSE (/browse props, /gear) / ME (/account).
  Staff, arts and equipment tabs unchanged.
  - Server: `functions/src/shootLinks.ts` — createReservation + createGearBooking take optional `scheduleShootId`
    (own booked shoot, or owner); props must be for the shoot's date, gear for its date (hours free); stored as
    shootId + scheduleShootId; shoot history 'props-added' / 'gear-added'. cancelShoot then cancels the shoot's
    props (requested/preparing/packed) and held gear (returns cancelledProps/cancelledGear/stillOut). moveShoot,
    requestSwap and answerSwap REFUSE a change of DAY while the shoot has open props/gear (same-day moves OK).
    Server does NOT yet require a shoot for creators (the old live website still books without one) — the new app does.
  - CUTOFFS (owner Oct 16): props from inventory = Booking rules leadTimeDays (default now 2; the LIVE stored value
    wins — owner/arts should set it to 2 in Admin → Booking rules), NEW props/build requests = `buildLeadDays`
    (default 4, new field in Booking rules; rules allow the key), gear = GEAR_LEAD_TIME_DAYS 2 (was 1, constant).
    `lastDayToBook(shootDay, lead, closed)` in booking.ts = "add by" date shown everywhere.
  - App: `src/activeShoot.tsx` (ActiveShootProvider in App: the shoot you're "Adding to", kept on the phone; sets both
    baskets to its day + gear to its hours (trimmed to 6 AM–midnight); clears when the shoot is cancelled/over;
    useShootLabel, useCutoffs). `src/components/AddingToBar.tsx` (bar + "Which shoot?" sheet, BrowseTabs Props &
    costumes | Gear). Creators only see "free" when a shoot is picked ("Just browsing" otherwise); prop page
    (ReservePanel) "Add to this shoot"; gear shop/bundle page follow the shoot; /reserve shows the shoot (no day
    picker) and sends scheduleShootId; refuses new props inside 4 days. `src/screens/CreatorHomeScreen.tsx`: next
    shoot card (Check in button when open → /schedule?shoot=id), Book a shoot (/schedule?book=1), To do (incoming
    swaps, missed check-ins to explain, shoots in the next 21 days with no props/gear before the gear cutoff → Add),
    Coming up. `src/components/ShootNeeds.tsx` on the shoot sheet: Props & costumes / Gear with "Add by" + linked
    requests + "+ Add" (sets the shoot, opens Browse). Me = profile + strikes + My prop requests / My gear / How it works.
    How it works: "Props and gear for your shoot". ScheduleScreen opens ?shoot= / ?book=.
  - Seed: sh9 = Riley's shoot 8 days out (time to add things). Tests 324 (tests/functions/shootLinks.test.ts +
    lastDayToBook unit test; old notice tests updated). Checked in a browser on the emulator (Home → To do → Browse
    with the shoot → add chair → Your shoot → request → shows on the shoot sheet; gear shop with the shoot's hours; Me).
  - Still to do later: staff queues showing which schedule shoot a request belongs to; casting/locations/makeup sections.
- DESIGN PASS (owner, Oct 17: "UX and fun are 100% the priority"; creators are lazy and fall back to dropping requests in
  a chat → must feel fun, fresh, modern, premium, zero thinking). Mockup v1: https://claude.ai/artifact/R4Ay3EbqD17DdtajpFaCeF
  (Home hero card with Time/Props/Gear ticks + one gold action, "Just say what you need" QUICK ADD (AI matches a
  chat-style message to props/gear/builds; cutoffs only shown when they bite), streak + monthly slots tiles, phone-style
  reminder, Book = big gold free slots → 2-tap sheet → celebration (confetti) → "Add props & gear", Browse = + on every
  photo + bottom basket "Send N to the teams", shoot page = cover + 3 tiles + "More" (move/swap/cancel/history),
  shoot day = full-screen "You're up" + one camera button → timer → wrap → celebration + streak). Waiting for the
  owner's feedback before building. Backend deploy of steps 3+4 still waiting for the owner's OK.
  OWNER FEEDBACK on v1 (Oct 17): AI quick add won't be accurate enough → keep it only as an OPTIONAL helper (suggestions,
  "frequently used"); creators must be able to SEARCH and BROWSE the real catalogue with photos (to see it / get inspired);
  keep the checkout granularity: see in-progress requests and CHANGE / ADD to them; pros want to dig in (filters, detail);
  don't forget BRANDING. → MOCKUP v2 (same link): eagle splash "PRIME APP" + eagle in header/cards/notification icon;
  Home = hero shoot card + search bar with "✦ Ask AI" chip + "Your usuals" (most booked) + "✦ Suggested for Saturday"
  rows (+ quick add on each); Browse = Adding-to bar, real search (+ "Similar, might work too"), Props & costumes | Gear,
  category chips, Filters sheet (only free for my shoot, sort A–Z / most booked, condition), + on cards; ITEM PAGE =
  photos (dots), free count, next 7 days strip (gold = your shoot), how many, notes, suggest an edit; gear page = what's
  in the case + adjustable gear hours + battery note; basket "Review your shoot · N" → YOUR SHOOT review (steppers,
  remove, "We don't have it · make or find" inline with the 4-day cutoff note, gear hours, notes for the teams, Send);
  SHOOT PAGE = request cards with status track (Requested → Being picked → Packed → Picked up → Returned; gear Held →
  Picked up → Returned → Checked in), item list, CHANGE (only while Requested; after that "message the team or add
  more") + "+ Add more"; Me = My requests with statuses. BUILD NOTE: editing a sent request needs a new server function
  (e.g. editReservation/editGearBooking while 'requested'/'held', re-checking availability in the transaction).
  OWNER (Oct 17) → MOCKUP v3 (same link): app NAME = "PRIME CAPITOL" (not "Prime App"); the EAGLE is WHITE (not gold);
  AI = HELPER that turns a creator's VIDEO IDEA into props: Home card "Got an idea for a video?" + "✦ Ideas" chip on the
  search bars → "Prop ideas" sheet (describe the video, example idea chips) → suggestions GROUPED BY SCENE ("For the cop",
  "For the diner", "To film it") each with WHY it fits + free/taken + "check it ›" (opens the item page) + quick +,
  "We don't have it" builds, "Add the top picks and review". Search and browse stay the main way.
  RENAMED in the real app (Oct 17): "Prime App" → "Prime Capitol" everywhere (browser tab, home-screen label, manifest,
  login/invite/not-invited text, email sender default/test, calendar feed names). Server text goes live with the next
  backend deploy. (iPhone may shorten the home-screen label to "Prime Capi…".)
  OWNER (Oct 17): AI should also FIND OPEN FILMING TIMES from the schedule, and creators can TALK it through → mockup:
  Book tab "✦ Ask for a time" (type or MIC) → chat: "4 hours with Jana next week, evenings" → real options as cards
  (back-to-back slots "You 5–7 · Jana 7–9", Book button; partner gets the 10-min invite hold), follow-up chips
  ("Anything on the weekend?", "Only Cliff 2", "Just me, 2 hours"), priority-day/monthly notes in the answers.
  BUILD NOTE: the AI (Gemini) only turns the words into a search {dates, length, houses, partner, time of day};
  the app's own findFree() + priority/notice rules pick the slots, so it never invents a time. Voice = the phone
  keyboard's dictation or the browser's speech recognition (Safari supports it).
  OWNER (Oct 17): GROUP shoots via the assistant: "I'm filming with Kyle and Jana this week" → finds back-to-back slots
  free for ALL (same house, one slot each, e.g. You 1–3 · Kyle 3–5 · Jana 5–7) → booking books YOUR slot and auto-INVITES
  each friend to confirm their own slot (held for them; confirm with one tap; if they can't, it opens to everyone).
  Mockup shows Booked / Held 20 min / Confirmed. OWNER DECISION (Oct 17): invite HOLD = 20 MINUTES (so it doesn't block
  other creators for long); while held, the schedule shows the slot as "Held for <name> · opens at <time> if they don't
  confirm" (dashed amber) so others know to check back. Applied to partner invites too (one rule; was 10 min).
  OWNER (Oct 17): "a bunch of squares, can't tell the AI from the calendar from the other stuff" → MOCKUP v4 VISUAL RULES
  (use these in the build): (1) YOUR SHOOT = the only big gold card; (2) AI = always a VIOLET GRADIENT PILL with ✦
  (animated gradient border, round sparkle icon, "✦ Ideas" gradient chip), never a box; AI chat bubbles violet-tinted;
  (3) SCHEDULE = timeline rows with hairlines (time column with a coloured rail: gold = free + outline "Book" pill,
  dashed amber = held with "Held · 20 min" tag, grey = taken with a face), day strip = plain numbers, selected day =
  gold circle; (4) CATALOGUE = photos only (rounded photo, text under it, no card); (5) STATS + info lists = plain
  lines with dividers (stats strip, "Coming up" timeline with gold dates); shoot page: request cards stay cards, the
  rest are plain rows. More space between sections.
  → OWNER PREFERRED THE PREVIOUS LOOK (v3, the cards). v4 REVERTED (Oct 17); the visual rules above are NOT adopted.
  The real issue was "something else" — asking the owner what.
  OWNER (Oct 17): "grown to like it, LOCK IT IN" = the v3 card look (current mockup link). BUILD STARTED:
  - DESIGN BUILD A (Oct 17): `src/components/Splash.tsx` (white eagle + "PRIME CAPITOL", once per visit, tap to skip;
    keyframes in index.css), new `CreatorHomeScreen` (header eagle + PRIME CAPITOL + avatar, "Hey <name>", next-shoot gold
    card with Time/Props/Gear steps (✓ or + with "By <cutoff>"/"Too late") + Check in / Open this shoot, search bar →
    /browse?focus=1, "Your usuals" (most-booked props + gear from your own requests), Monthly slots (left this month,
    bars) + Streak (`filmedStreak`: filmed in a row; no-show/late cancel ends it), To do, Coming up, Book another shoot).
    ItemCard `onAdd` = + quick add on photos (creators with a shoot picked; tap again removes). `.no-scrollbar` helper.
  - DESIGN BUILD B (Oct 17): CHANGE A SENT REQUEST. Server `editReservation` (reservations.ts: creator who booked or
    staff, ONLY while 'requested'; new lines/quantities re-checked against availability excluding its own holds;
    additions need the props notice, new builds the build notice; removing always OK; keeps existing build ids;
    history {event:'edited'}; arts-team email) and `editGearBooking` (gearBookings.ts: owner/gear staff or creator,
    ONLY while 'held'; same day, new hours and/or lines; additions/new hours need the gear notice; holds rewritten in
    the transaction). Both in deploy/log lists. App: `src/components/ChangeRequest.tsx` on the props request page
    (steppers, remove/put back, add make-or-find, Save; "+ Add more" = Browse with that shoot) and
    `src/components/ChangeGear.tsx` on the gear page (extras steppers, remove, hours). ShootNeeds shows a progress bar
    per request + "Tap to change it…". History/activity say "Changed". Tests 327 (tests/functions/editRequests.test.ts).
    Checked in a browser on the emulator (add a make-or-find to a request; move gear hours).
  - Steps 3 + 4 + A + B backend DEPLOYED Oct 17 (run 27, green, owner OK). Owner to set "Props we have" = 2 in Booking rules.
  - AI HELPERS (C) BUILT Oct 17 (owner: "go ahead with the AI helpers"; NOT deployed yet — new functions + rules):
    - BUDGET (`functions/src/assistant.ts`): `reserveAi(email, helper)` in a transaction: refuses when this month's
      `ai_usage/{YYYY-MM}.spentUsd` + $0.02 > monthlyCapUsd (default $50) or the person's count today ≥ perPersonDaily
      (default 25) → "resting until the 1st" / "used today's AI help… search and browse still work"; settles the real
      cost after. Settings `app_settings/ai` {monthlyCapUsd, perPersonDaily}; owner screen Admin → "AI helpers" (/ai,
      `AiSettingsScreen`: spend bar, uses by helper, edit both). Rules: ai_usage owner read (people/{email}: owner or self).
      The import keeps its own cap.
    - VIDEO IDEA → PROPS (`ideaToProps`): embed the idea → nearest 60 company props (item_vectors) + all gear bundles →
      Gemini (`askJson` in gemini.ts) groups picks by scene ("For the cop", "To film it") with a short why; only ids from
      the candidate list are kept; "missing" = things to make or find. Test mode returns a simple answer.
      App: `src/components/IdeasSheet.tsx` (IdeasButton card on Home + small "✦ Ideas" chip on Home search, Browse and
      Gear): describe the idea / example chips → grouped results with photo, why, free/taken for the picked shoot,
      + to add (props cart / gear cart), "Ask for it" adds a make-or-find, "Review your shoot".
    - ASK FOR A TIME (`askForTime`): Gemini only turns the words into a TimeAsk {from,to,people,mySlots,houses,timeOfDay}
      (+ a short reply); `functions/src/timeFinder.ts` (pure, unit-tested): roughParse/roughAdjust (no-AI reading and
      follow-ups), cleanAsk, matchPeople (unique first names), findOptions = real free back-to-back slots (you first,
      then each friend, same house; slotState for YOU incl. priority days; friends not filming elsewhere then; time of
      day; ≤2 per day, ≤5). Follow-ups send `previous`. App: `src/components/TimeChat.tsx` (full screen from Schedule's
      "✦ Ask for a time" card; chat bubbles, chips, MIC via the browser's SpeechRecognition (Safari/Chrome) else the
      keyboard mic; option cards with Book).
    - FRIEND HOLDS (scheduling.ts): `bookWithFriends` books your slot(s) and HOLDS the next slot for each friend
      (day-doc entry {shootId:'', email, name, hold:{until, inviteId, fromName}}, INVITE_HOLD_MINUTES = 20) +
      `schedule_invites/{id}` (from/to, place/date/start/end, until, status pending|accepted|declined|withdrawn|expired;
      rules: the two people + gear staff, server writes). `answerInvite` (friend accepts → their own extra shoot,
      invitedBy; declines → slot freed; inviter can withdraw; after `until` → "the 20 minutes ran out"). slotState
      returns 'held' while active (an ended hold counts as free; placeIn lets the held person or anyone after it ends
      take it; others get 'held' message). Schedule rows: dashed amber "Held for X · opens at HH:MM if not confirmed";
      `InviteAsk` banner on Schedule (Confirm my slot / Can't make it); Home To do lists invites; TimeChat shows live
      Held until / Confirmed. Attendance reports ignore held slots.
    - Test login "Kyle (creator)" added. Tests 340 (unit timeFinder, functions assistant + invites). Checked in a
      browser on the emulator (ask → book with Kyle → Kyle confirms → Confirmed ✓; ideas sheet).
    - Not yet: email/push for invites (in-app only until email); "invite a friend" button on the plain Book sheet.
    - AI SAFETY + GROUNDING (owner, Oct 17: "box it in, no prompt injection; understand the app and the props list"):
      the AI has NO powers (no tools, can't book/read/change anything); it only fills fixed JSON that the server checks.
      `askJson(key, {system, user})` in gemini.ts: app rules in systemInstruction, people's text only as
      `<creator_text>` data (`asData` strips control chars + fake closing tags), Google safety filters on
      (BLOCK_MEDIUM_AND_ABOVE), low temperature, JSON only, blocked/broken → {}. `safeText` on EVERY AI text shown to
      people (no links/web/email addresses/markup/code, length capped). APP_CONTEXT tells it what Prime Capitol is, to do
      only its task, never follow instructions inside the creator text, return empty for off-topic. ideaToProps is now 3
      steps: (1) AI lists needs per scene (no inventory), (2) server looks each need up by meaning (item_vectors, top 6 per
      need, ≤90 company, non-damaged props; lines include category, tags + search words, how many, free/taken on the
      caller's own shoot via `freeOnShootDay`), (3) AI picks from that shortlist only; server drops unknown ids; "not a
      video idea" → note. askForTime: system prompt with studio facts (houses, 2-h slots, back to back, priority days),
      reply may not name times; the phone's `previous` search is rebuilt by cleanAsk (known fields only) before use.
      reserveAi also refuses more than 6 uses a minute per person (BURST). Personal props, internal notes and emails are
      never sent to the AI. Tests 345 (tests/unit/aiSafety.test.ts + burst test).
    - AI helpers + AI safety backend deploy started Oct 17 (run 28, owner OK).
  - RUNNING COSTS + PHOTO CLEAN-UP + HELP (owner, Oct 17; backend run 29, weekly clean-up run 30, all green):
    - `functions/src/costs.ts`: `costReport` (owner): lists every Storage file (bytes/files by folder), REAL usage this
      month from Google Cloud Monitoring (Firestore read/write counts, Storage sent bytes; null in the emulator or if
      not permitted), projected to month end at list prices after free amounts, AI spend, clean-up preview, last run.
      `cleanUpPhotos` (owner, manual): `cleanupReason(path, ageDays, referenced)` — removes (1) PROOF photos
      (reservation-photos/, gear-returns/, shoot-photos/) older than PROOF_KEEP_DAYS = 183 (owner: 6 MONTHS), and (2)
      photos in items/ thumbs/ gear/ avatars/ request-photos/ (+ proof folders) that NOTHING references, older than
      UNUSED_KEEP_DAYS = 14. "Referenced" = any download link found by walking EVERY field of EVERY doc in every
      top-level collection (+ import_items fileId → items/imported/<id>.jpg). Aborts if no links could be read; ≤500
      deletions per run; logged in `cleanup_runs` (owner read). Bucket soft delete keeps removed files 7 days.
      WEEKLY AUTOMATIC run (owner OK, Oct 17): `weeklyPhotoCleanup` (onSchedule 'every sunday 04:00' Toronto →
      Cloud Scheduler job, cents/month) does the same as "Clean up now" (logged by 'weekly clean-up'). Scheduled
      functions are NOT in the invoker lists (those are for callables only).
    - WEBSITE LIVE Oct 17 (website run 8, owner OK): everything through costs/clean-up/help (new creator app Home/Book/
      Browse/Me, schedule, AI helpers, Prime Capitol name) is on the live site.
    - OWNER = CREATOR LOOK + EXTRAS (owner, Oct 18: "I'm also a creator"; preview only, live needs OK): session
      `shootFlow` (role creator OR owner) drives the creator layout. Owner tabs: Home / Book / Browse / Me / TEAM
      (/admin, renamed "Team" for the owner; top entries Props queue, Add a prop, Schedule team; lights up on all
      staff screens via BottomNav longest-prefix `also`). Owner's Browse/prop page/Your shoot/gear shop use the
      AddingToBar like creators, and when NOT adding to one of their shoots still get the staff day picker (book any
      day), staff filters (Personal/Prime Capitol, archived, bins). Me → "My prop requests"/"My gear" open
      /reservations?mine=1 and /gear/bookings?mine=1 (own only, even for staff). Arts + equipment unchanged.
      Fixed a weekday-dependent test (editRequests: Ben's C-stand now overlaps Ana's hours).
      LIVE Oct 18 (website run 9, owner OK).
    - LOOK FIXES (owner, Oct 18): "top of the app is blurry" → every sticky header is now SOLID (was bg-pt-bg/90 +
      backdrop-blur) and App.tsx has a fixed solid strip behind the iPhone status bar (black-translucent status bar
      let pages show through). Book screen: gold "Book a shoot" first, then an "or let AI find a time" divider, then the
      violet Ask-for-a-time card; the phone-calendar link moved to its own card at the BOTTOM of the schedule. AI
      example names use "Alex" (owner), not Jana. LIVE Oct 18 (website run 10, owner OK).
    - FEWER WORDS (owner, Oct 18: "use visual design language, especially for less-used functions"):
      `src/components/RoundIcon.tsx` (round icon buttons: help ?, team, settings sliders, calendar; aria-label +
      tooltip). Schedule header = team / settings / ? icons (was text links; ? → /help); Home's ? uses it too.
      Phone-calendar card text shortened. GOOGLE CALENDAR SETUP in Schedule settings is now a numbered checklist
      (CalendarSetup): 1 Enable Calendar API (link to console), 2 share the calendar with the app's address (shown via
      importInfo for owner/arts, Copy button; the test also returns it), 3 paste Calendar ID, 4 "Save & test" (saves
      first; friendly errors for API off / not found / not shared), then "Bring in what's already in the calendar".
      Live Oct 18 (run 11). Next idea: a wider words-to-icons pass across screens (ask first).
    - PREMIUM VISUAL LAYER (owner, Oct 18: "Apple-grade" upgrade, styling only, no logic changed; preview only):
      tailwind tokens: shadow-hairline (0.5px inner light edge, replaces grey outline borders), shadow-card, shadow-float
      (sheets), shadow-gold / shadow-violet (primary buttons, flat colour + top highlight instead of gradients),
      ease-spring cubic-bezier(.32,.72,0,1), pt-raised, tracking-title/heading. index.css: every button/link animates
      250ms on the spring curve, presses scale to .97, gold :focus-visible halo, input focus glow, hover only on
      mouse devices, `.tap` (invisible 44px tap area for small text links), `.eyebrow`, sheet-up/fade-in/rise-in
      keyframes, reduced-motion respected. Codemod (/tmp script, one-off): 135 outline borders → hairline, 35 header
      underlines removed, dividers softened to white/6%, gradients → flat, large titles 34px, x.5 spacing → 4pt grid,
      steppers + icon buttons 44px, 38 small links got `.tap`. BottomSheet springs up (28px corners, no title line),
      ItemCard shadow-card + 44px quick-add, AddingToBar + "pick a day" no dashed outlines, back chevrons bigger,
      page sections 24px apart. Kept on purpose: dashed amber "Held" slots and dashed to-do circles (they mean something).
    - ANIMATIONS + SPEED (owner, Oct 18: yes to the animation ideas, NO vibration, "super optimized"; preview only):
      Photo tile → prop page MORPH (View Transitions: `openWithMorph` + `photoMorphName` in ItemCard.tsx, same name on
      ItemDetail's first photo; Chrome + Safari 18, others just open). Book sheet: "Booked ✓" + gold swell (650 ms)
      before the shoot opens. Tab bar: active icon bounces (.tab-bounce). Ask for a time: bubbles rise in, 3 violet
      typing dots while it thinks. Browse cards rise in 30 ms apart (first 12). All respect reduced-motion.
      SPEED: every screen except Login is React.lazy (App.tsx) with Suspense (blank black fallback; ShellLayout keeps the
      tab bar) and the main tabs + prop page are prefetched on idle after sign-in; vite manualChunks split firebase and
      react into their own long-cached files. First download 343 KB → ~222 KB gzipped, and an app update now re-downloads
      only the small changed files (~20 KB) instead of everything. 22 more <img> got loading="lazy" decoding="async";
      index.html preconnects to Firestore/Storage/sign-in servers. LESSON: never wrap the routed screen in an animated
      (opacity/transform) element: it trapped BottomSheets/TimeChat (fixed, z-50) under the tab bar.
      Not done (bigger change): load Firebase Storage (~20 KB) only when uploading.
    - LIVE Oct 18 (website run 11, owner OK): icons + Google Calendar checklist + premium visual layer + animations + speed.
    - ASK-FOR-A-TIME SLOT COUNT FIX (owner, Oct 18: "soonest 4 hour spot at Cliff 2 with Ariel" offered 4 h for him + 2 h
      Ariel). RULE: each friend always gets ONE slot; a length said with friends = the WHOLE back-to-back block
      ("4 h with Ariel" = you 2 h + Ariel 2 h); your own share changes only with an explicit "I need N hours myself" /
      "N hours each"; min 1, max 3 slots for you. The AI no longer returns mySlots: it reports totalHours / myHours
      (prompt has worked examples incl. "soonest"/"asap"), and `slotsFor()` in timeFinder.ts does the arithmetic
      (also after friend matching, and on follow-ups: "just me" after "4 h with Ariel" → 4 h for you). The reply is
      now written by the app from the actual search ("Looking at Cliff 2: you 2 h, then Ariel 2 h, back to back.
      Soonest first."), so a misunderstanding shows at once; off-topic → no options. Tests 357. Needs a BACKEND deploy.
    - ONE HOUSE SLOT A DAY (owner, Oct 18: "no one can book more than 2 hours per day unless manually allowed"; owner
      picked: exceptions = the TEAM books it for them (no allowance list); HOUSES ONLY (offsite doesn't count)).
      Setting `slotsPerDay` (app_settings/schedule, default 1, 1–9; Schedule settings → "House slots a day").
      `houseSlotsOn(day, email, now, except)` in schedule.ts counts both houses + ACTIVE invite holds for that person.
      Server (scheduling.ts `assertDayLimit`, inside the day-doc transaction, so two taps can't beat it): bookShoot,
      moveShoot (except the moving shoot), answerSwap (both people, when the days differ), bookWithFriends (mySlots ≤
      limit; each friend must have no slot that day; names the friend), answerInvite (the invitee). Team (owner/equipment)
      is never limited; placeShootAsTeam (calendar import) not limited. App: findFree + findOptions skip days you (or a
      friend) already film; askForTime caps a creator's own slots and says so; BookSheet shows an amber note and
      disables Book when you already have your slot that day; How it works + Help explain it.
      Tests 366 (tests/functions/dayLimit.test.ts + unit). LIVE Oct 18 (backend run 31 + website run 12, owner OK; incl. the slot-count fix).
    - PUSH NOTIFICATIONS (owner asked Oct 18): explained web push (FCM, free; iPhone only when added to Home Screen,
      iOS 16.4+; needs a tap to allow). Options given: 1 instant event pushes + Home Screen guide (recommended),
      2 + timed reminders (Cloud Scheduler OK), 3 wait for email. OWNER PICKED 2 (instant + timed reminders, Oct 18).
    - PUSH BUILT (Oct 18; NOT deployed — needs backend + website deploy, ask): FCM web push, free; default FCM VAPID key
      (optional VITE_FIREBASE_VAPID_KEY). `functions/src/pushMessages.ts` (pure, unit-tested: who gets what) +
      `functions/src/push.ts`: callables registerPush/unregisterPush/testPush (in deploy/log lists); tokens in
      `push_tokens/{sha256}` {token,email,platform,lastSeen} (server-only, ≤8 phones/person, dead tokens removed);
      sendPush resolves 'arts-team' (role arts) / 'gear-team' (role equipment = schedule + gear); the OWNER gets team pings
      ONLY when that team has nobody yet. Emulator: no sending, messages go to `push_log`. INSTANT (Firestore triggers,
      no booking code touched): pushOnInvite (friend invited / confirmed / can't), pushOnSwap, pushOnReservation (new →
      arts; packed / declined / cancelled-by-team → creator; returned → arts), pushOnGearBooking (new → gear team;
      declined / cancelled-by-team → creator; returned → gear team), pushOnShoot (team booked/moved/cancelled your
      shoot), pushOnReport (→ gear team), pushOnStrike (→ person). TIMED: `pushReminders` onSchedule every 10 min
      (Cloud Scheduler, owner OK; 2nd job, within the free 3): an hour before a shoot, check-in open (houses), missed
      check-in (within the explain window), last day to add props/gear (9 AM, only if nothing linked), props due back
      (8 AM on the due day) / late, gear due in 30 min / late; each sent once via `push_sent/{key}` create().
      App: public/push-sw.js (importScripts in the workbox SW: shows pushes, tap opens the url), `src/services/push.ts`
      (pushState: unsupported / needs-install (iPhone not on Home Screen) / off / on / blocked; turnOnPush from a tap;
      refreshPush on each start), `src/components/Notifications.tsx`: NotificationsCard on Me (Turn on / Send me a test /
      Turn off / blocked help), NotificationsNudge on creator Home (dismissable), InstallGuide sheet (iPhone Add to Home
      Screen, 4 steps). Tests 381 (tests/unit/pushMessages.test.ts, tests/functions/push.test.ts). Checked in a browser.
      If pushes don't arrive after deploy: check "Firebase Cloud Messaging API" is enabled on proptracker-9732e.
    - AUTO-UPDATE (owner, Oct 18: "not getting the latest on my phone"): iPhone home-screen apps wake from memory and
      rarely re-check the service worker. src/main.tsx now registers it via `virtual:pwa-register` (immediate) and calls
      reg.update() whenever the app becomes visible + every 30 min; registerType 'autoUpdate' (skipWaiting/clientsClaim)
      then reloads the page onto the new version. (Phones still on the OLD version need one more full close/reopen.)
    - PUSH + AUTO-UPDATE LIVE Oct 18 (backend run 32, website runs 13 + 14, owner OK). Owner to turn on + test on the phone.
    - TITLE SPACING (owner, Oct 19: iPhone's fade under the clock touched page titles like "Team" at rest): `.pt-safe`
      (index.css, every page header) = safe area + 12px. Preview only; live needs OK.
    - BOOKING IS HOUSE-AGNOSTIC (owner, Oct 19: people want Cliff 1 but settle for Cliff 2; "show times based on soonness"):
      "Book a shoot" (and ?book=1, Find a time, taken slot) opens FindSheet titled "Book a shoot" straight away (the
      "Where are you shooting?" question is gone): 2/4/6 h chips, the next 6 days with free times, 3 times per day (+ "N more
      times this day"), ONE row per time with a gold button per FREE HOUSE (owner Oct 19: no Cliff 1 default, people choose). Small
      "Any house / Only Cliff 1 / Only Cliff 2" filter at the bottom, then "Shooting somewhere else?" → offsite sheet.
      Day view tabs (Cliff 1 | Cliff 2 | Offsite) unchanged. Preview only; live needs OK.
    - NOTIFICATIONS NUDGE FIX (owner, Oct 19: "Turn on" stayed after turning on; "Not now" off-centre): Home nudge now shows
      "Turning on…" and the error if it fails (it was hidden before), getToken times out after 20 s with a clear message,
      refreshPush also finishes sign-up for phones that allowed notifications but have no saved token; "Not now" centred.
      Owner: turning on WORKED but the prompt stayed → pushState trusts the saved token unless permission is 'denied'
      (iPhone home-screen apps can report 'default' after a relaunch); Home prompt + Me card sync via PUSH_CHANGED event +
      visibilitychange; once on, the Home prompt is dismissed for good.
    - LIVE Oct 19 (website run 15, owner OK): title spacing + house-agnostic booking (pick the house per time) + notification prompt fixes.
    - WHO'S FILMING (owner, Oct 19: replace the 2/4/6 h chips with "yourself / with a friend / two friends"): FindSheet
      segmented "Just me / + 1 friend / + 2 friends" (count = 1 + friends, one 2-h slot each, back to back). With friends:
      SEARCH-ONLY picker (owner: partners change; nothing listed until you type a name or channel, top 6) from NEW callable `listFilmingFriends` (anyone; active creators + owner, names only; in deploy/log
      lists) with avatar + channel; days where a picked friend already films are skipped; tapping a house opens
      GroupBookSheet ("Book back to back": You Booked / friend Held 20 min, monthly/extra for your slot) → bookWithFriends
      (holds + invite push). Not picked → books only your slot (friends book the next slot themselves). Test in
      invites.test.ts. LIVE Oct 19 (backend run 33 + website run 16, owner OK).
    - SHEETS + DATES (owner, Oct 19): every BottomSheet now SWIPES DOWN TO CLOSE (drag the handle/title, or pull down when the
      content is scrolled to the top; >110 px closes, else springs back; sideways swipes ignored; uses CSS `translate` so it
      doesn't fight the slide-up animation). Book a shoot: DAY STRIP ("Soonest" + next 35 days, greyed when nothing free) →
      picked day shows all its times first, then later days; day headings bigger (19px white).
    - MONTHLY vs EXTRA HIDDEN (owner, Oct 19, option A: "it's just a counter that protects nothing" until the draw exists):
      `MONTHLY_SLOTS_ON = false` in src/services/schedule.ts hides the Monthly/Extra choice (book + back-to-back sheets send
      'extra'), the slot/shoot labels, the Home "Monthly slots" tile (now "This month: N shoots booked"), How it works +
      Help monthly text. Server unchanged (monthlySlots setting kept). Turn it back on when the wishlist + fair draw is built
      (draw-placed shoots = 'monthly').
    - LIVE Oct 19 (website run 17, owner OK): swipe-to-close sheets, day strip, bigger dates, monthly/extra hidden.
    - IDEAS "SEE MORE" (owner, Oct 19): IdeasSheet "✦ See more ideas" → ideaToProps again with `exclude` (ids already shown)
      + `searched` (needs already looked up, returned by each call as `searched`, + missing names). Server: step 1 asks for
      DIFFERENT, less obvious items; shortlist 10 per need (was 6) minus excluded ids/gear; missing drops repeats. New picks
      join their scene group (or a new one); "That's everything that fits" when a round adds nothing. Each press = 1 AI use
      (counts in the budget/daily limit). Test in assistant.test.ts.
    - IDEAS → SHOOT (owner, Oct 19): suggestions are TICKED (props, gear, "Ask for it" builds; violet ticks; ✓ = already in
      the basket) → "Add N to a shoot" → "Add to which shoot?" (upcoming shoots, "Too late for props/gear" warnings) or
      "+ Book a new shoot for these": picks saved on the phone (`savePendingAdds`, 1 h), Book a shoot shows a violet note and
      STARTS on the first day the picks can still be added (`useEarliestDayFor`); after booking (`booked()` in ScheduleScreen)
      `takePendingAdds` + `useAddToShoot` put them in the new shoot and open /reserve. activeShoot waits 30 s before
      dropping a just-booked shoot that hasn't reached the phone's list yet. cart.addBuild keys now unique.
    - ARTS DON'T BOOK (owner, Oct 19: arts handle props; only the gear/equipment team runs the calendar): server
      bookShoot/moveShoot/requestSwap/bookWithFriends = BOOKERS (owner, creator, equipment); createReservation +
      createGearBooking = owner + creator. Session `canBook` (creator/owner) hides ReservePanel add buttons, the basket
      bar, "+ New request", "make or find" link; routes /schedule → /calendar and /reserve, /gear → / for arts; Admin
      "Book gear" owner only. Arts tab "Calendar" (/calendar, `RequestsCalendarScreen`): day strip (7 days back, 6 weeks
      ahead, request counts), props requests for the day with creator, house + time from schedule_days (via
      scheduleShootId), status, items; tap → request page. Tests updated (owner instead of arts) + new arts test.
    - GEAR LOOKS LIKE PROPS (owner, Oct 19): gear Browse = same header (eagle + Browse + Ideas), search box (name, category,
      description, piece names), category chips (bundles + extras) under it, count line, then Adding-to bar; bundle tiles
      = ItemCard look (rounded-20 shadow-card, status badge Available/Free/Taken/Piece missing, "N pcs" corner, + quick add
      when a shoot is picked); same "Your shoot · N props · M gear  Review →" bar. Gear page = prop page header (white
      ‹ Back) + full-width photo; titles 28px on both. "My gear" header link removed (Me → My gear). Bundles/extras
      sections, hours picker, timeline, battery note kept.
    - PROP BRAINSTORM CHAT (owner, Oct 19: "help me build a good prop list… like the booking chat"; "something for a séance"
      → candles): IdeasSheet is now a FULL-SCREEN chat (like TimeChat: bubbles, typing dots, chips, mic, composer). Each
      message → ideaToProps with `history` (earlier creator messages, ≤6) + `exclude` (everything already shown); the AI
      acts as a creative producer, focuses on the NEWEST message in the context of the earlier ones, and also returns
      `reply` (one creative tip, safeText 220) + `chips` (3 follow-up asks). "✦ More like these" chip = second look on the
      last ask (`more: true` + `searched`). Follow-ups may be short (≥2 chars when there's history; first idea ≥8).
      Each turn's picks render under the bot bubble with ticks → "Add N to a shoot" (same picker / new-shoot flow).
      Test in assistant.test.ts. Tests 385.
    - LIVE Oct 19 (backend run 34 + website run 18, owner "go live"): see more ideas, ideas → shoot, arts don't book + calendar, gear
      looks like props, brainstorm chat.
    - ADMIN ROLE (owner, Oct 19; NOT deployed — security rules + server → needs owner OK): role 'admin' = everything a
      creator, the arts department and the equipment team can do, NOTHING owner-only. Owner answers: invites CREATORS
      only (like arts); owner-only for admins: money + AI budget (costs, /ai, ai_usage reads, Health AI card), personal
      props, bulk tools (Drive import, undo, rebuild search, search words, photo clean-up), SCHEDULE SETTINGS + any
      connections (Google Calendar test/import, email); STAFF LAYOUT. Server: auth.ts requireRole lets admin pass wherever
      creator/arts/equipment may (`ADMIN_COVERS`), `{ noAdmin: true }` on saveScheduleSettings, testCalendarLink,
      previewCalendarImport, applyCalendarImport; TEAM/GEAR_STAFF lists include admin; owner-only checks unchanged
      (personal props stay hidden). Rules: isStaff/isMember/isGearStaff include admin, users.role may be 'admin' (only the
      owner can set it), ai_usage read = owner + arts. App: session `isAdmin` (isStaff + isGearStaff + canBook, shootFlow
      false); tabs Queue / Gear (/gear/bookings) / Schedule / Props / Admin; home → /reservations; ScheduleSettingsOnly
      route guard (owner + equipment) on /schedule/settings + /schedule/import; settings icon hidden; Admin menu adds Add a
      prop, Book gear, Gear bundles & pieces, Schedule team, Requests calendar, hides Import; People can pick "Admin"
      (owner only); View as Admin. Seed admin@example.com "Sam (Admin)" + test login. FUTURE ROLES: add them to
      ADMIN_COVERS + the rules helpers so admins see them too. Tests 387 (tests/functions/admin.test.ts).
    - CALENDAR: NEVER CHANGE THE OLD CALENDAR (owner, Oct 19: app not launched yet; "we shouldn't change anything that's
      already on there ever"; old overlapping events: "import both anyway and mark it as a clash for these old events
      only"). NOT deployed (backend + website, ask). Settings `calendarWrite` (default FALSE = read-only: the app never
      adds/changes/deletes anything in Google Calendar; Schedule settings switch "Copy app bookings to this calendar",
      confirm, turn on at LAUNCH). syncShootToCalendar / syncBlocksToCalendar use `writeCalendarId()` (needs calendarWrite)
      and SKIP imported shoots (importedFrom/calendarEventId) and imported blocks (`imported: true`) forever.
      testCalendarLink while off = read-only check (lists 1 event; sharing "See all event details" is enough).
      IMPORT keeps the REAL hours: `importShootAsTeam` (scheduling.ts): house shoot fills EVERY grid slot it touches
      (2:30–5 PM → 1–3 and 3–5 slots, entry.time = real hours, shown "Really 2:30–5 PM" on the schedule), ignores blocks;
      a slot already taken → still imported, `day.clashes[]` {house, slot, shootId, name, start, end} + shoot.clash/
      clashWith + history "CLASH with X"; schedule row red "Clash · also X". Blocks keep exact minutes. takeOut now
      removes every slot of a shoot + its clash listing. Import screen: no slot picker (real hours), red "⚠ Clash" preview
      between selected events, "Imported · Clash" result. Tests 388 (calendar.test.ts).
      → REPLACED the read-only switch (owner, Oct 19, same day): "the app is allowed to add to the calendar and read and
      even change, but ONLY MANUALLY — no automated moving without discrete approval; I want to move/change/delete stuff
      added by the app but not stuff from the old import". `calendarWrite` setting REMOVED. Triggers syncShootToCalendar /
      syncBlocksToCalendar now only QUEUE a change in `calendar_outbox/{eventId}` (kind shoot|block, label, change
      add|update|remove; one per event, latest wins; skipped for imported shoots/blocks; only when a calendar ID is set;
      shoot changes that don't affect the event, e.g. check-in, are ignored). Callables (owner + equipment, not admins;
      in deploy/log lists): `calendarPending` (pending + `calendar_sent` = what the app put in the calendar) and
      `applyCalendarChanges({ids, action: send|discard|remove})` (re-reads the CURRENT booking; only app event ids
      's…'/'b…' are ever written). Screen /schedule/calendar `CalendarSyncScreen` ("Calendar changes": tick → Send N /
      Don't send; "In the calendar from the app" → Remove), linked from Schedule settings and a blue "N calendar changes
      to approve" banner on Schedule (owner/equipment). testCalendarLink = write+delete a test event (a tap). Sharing =
      "Make changes to events". Tests 389. NOT deployed (backend + website, ask).
      → CORRECTED (owner, same day): "bookings don't queue for approval, they're instantly approved; I just mean the app
      doesn't auto-move stuff without human involvement". So: every change a PERSON makes (book, move, cancel, block) goes
      to the calendar RIGHT AWAY (`sendNow` → `pushEvent` re-reads the current booking/block; `calendar_sent` records
      it); if Google refuses (not shared, API off) it waits in `calendar_outbox` with the error and the team retries/drops
      it on the screen (now titled "Google Calendar": "Couldn't send" + "In the calendar from the app" with Remove). The
      Schedule banner only shows failed ones. Imported events are still never touched; the app has no automatic moving.
    - RE-IMPORT (owner, Oct 19: "while we test, the admin team will add stuff straight in Google Calendar; import every
      time but don't change them; the app only changes stuff made by the app"): `calendar_imports/{eventId}` now keeps a
      SNAPSHOT (date, startMin, endMin, title, location) + shootId/blockId/email/house. previewCalendarImport returns
      kind 'new' (never seen), 'changed' (time/title/place differs from the snapshot; skipped ones stay skipped) with
      `was`, and 'removed' (imported, future, no longer in Google) → actions remove (take the app copy off: shoot
      cancelled "removed from Google Calendar", block removed) | keep. Changed shoots MOVE the same shoot
      (importShootAsTeam(..., existingId): takes out the old slots, places at the new real hours, history "changed in
      Google Calendar"); changed blocks are replaced (block id g+event id). Google Calendar itself is never written by
      the import. Emulator: `test_calendar/events` {items} stands in for the calendar in tests. Button: "Import from the
      calendar (new + changed)". Test in calendar.test.ts. Tests 390.
    - AUTOMATIC CALENDAR CHECK (owner, Oct 19): `calendarCheck` onSchedule every 15 min (Cloud Scheduler, 3rd job, free)
      + owner/equipment callable `checkCalendarNow` (in deploy/log lists) = `runCalendarCheck()`: scanCalendar (reads only)
      → events CHANGED or DELETED in Google that were imported are applied automatically (applyImports by 'calendar
      check'); NEW events wait for a person; result in `app_settings/calendarCheck` {at, newEvents, changed, removed,
      failed, error} (rules: readable by gear staff too) → Schedule banner "N new events in Google Calendar to sort" and
      "Checked automatically every 15 minutes · last … · Check now" on the import screen. Never writes to Google.
    - App: Admin → "Running costs" (`CostsScreen`, owner only, /costs). Proof photos that were cleaned up show
      "Photo removed after 6 months" (PhotoStrip StripPhoto onError).
    - HELP (`src/screens/HelpScreen.tsx`, /help, everyone): searchable FAQ by topic (getting started + sign-in trouble,
      booking, filming with friends, props/gear incl. cutoffs/changes/returns/✦ Ideas, on the day, moving/swapping/
      cancelling, strikes, who to ask); numbers from live settings. Links: "?" button on creator Home, Me → Help.
    - Tests 351 (tests/unit/cleanup.test.ts, tests/functions/costs.test.ts). Checked in a browser on the emulator.
  AI SPEND (owner): don't spend over ~$50/MONTH on AI, limits shouldn't feel restrictive. PLAN (proposed): one monthly AI
  budget $50 (owner can change) covering ALL AI (helpers, import, search words), reserved per call in a transaction like
  the import cap, resets on the 1st; per-person daily limit (~25 helper uses/day); owner notice at 80%; when reached, AI
  helpers pause with "search and browse still work" (booking/search never blocked). Estimates at PRICE_PER_M (0.30 in /
  2.50 out): time ask ≈ $0.0015, video idea → props ≈ $0.004 (smart search narrows to ~60 candidates first) → $50 ≈
  10,000+ uses/month. Owner can also add a Google Cloud budget alert (free).

### Next
- Oct 13 (owner): owner QAs the PREVIEW internally; beta testers are onboarded ONLY on the LIVE site
  (told the owner preview + live share ONE database; roles/rules are what protect data). Before inviting:
  go live (hosting) + DATABASE BACKUPS (ask OK). GEAR SPRINT STARTED: clickable mockup published at
  https://claude.ai/artifact/2ByduqvsYrCNLd59rTz332 (creator: hours picker, kit cards with free/taken,
  kit page with pieces, day timeline, next-free + similar kits, extras with counts, one "My shoot" basket
  with props + gear; equipment team: queue by time, tick-every-piece hand-over/check-in with "missing",
  Out tab with late, inventory).
  GEAR DECISIONS (owner, Oct 13; mockup v2 at the same link): all 8 guesses accepted (1 open day notice;
  closed days like props; late = 30 min after booked end, late creators blocked; missing piece → bundle
  stays bookable with a warning; props + gear in ONE request, each team sees its part; no hand-over
  photo; staff-only value) EXCEPT: staff keep an inventory of EVERY PIECE of gear and BUILD BUNDLES from
  it; creators can ONLY book whole bundles (no single pieces, no extras, a bundle can't be split); a
  RETURN PHOTO is REQUIRED (everything in the case + batteries plugged in to charge).
  Open bundle questions (guesses in the mockup): a piece in only one bundle at a time; counts per item
  (serial numbers only for cameras/drones); creator takes the return photo at drop-off, then the team
  ticks every piece; bundles editable when not booked/out; loose pieces staff-only with a "not in a bundle" count.
  Owner (Oct 13): bundle guesses all OK. PLUS: the team may not check gear in between uses, so the
  CREATOR PICKING UP ticks every piece and reports missing ones AT THEIR PICKUP TIME (window opens 30 min
  before start), before signing; after signing it's theirs. Missing-at-pickup → alert to the equipment
  team + recorded on the previous holder's history (records only). Mockup v3 shows this.
  GEAR BUILD, in steps: (1) equipment role + All gear + bundles  (2) creators book whole bundles by the hour
  (3) pickup check / return photo / check-in / late / gear queue  (4) one shoot request with props + gear.
  STEP 1 BUILT AND DEPLOYED (Oct 13, run 21):
  - Role 'equipment' (gear only; no props: rules isMember excludes it). Only the owner can invite it.
    App: `isGearStaff` in session; equipment home → /gear/bundles; tabs Bundles / All gear / Account;
    owner reaches gear from Admin → "Gear (equipment team)". View as includes Equipment team.
  - `gear_items/{id}` {name, category, have, serial (→ have 1), value (staff only), notes, photos, archived}
    and `gear_bundles/{id}` {name, category, description, photos, pieces[{itemId, qty}], archived}.
    Rules: items readable by owner+equipment, bundles by members+equipment; NO client writes.
    Server (`functions/src/gear.ts`): saveGearItem, saveGearBundle, setGearBundleArchived (owner+equipment),
    transactions enforce `functions/src/gearStock.ts` (shared with app): a piece in ONE bundle at a time,
    can't lower `have`/archive below what bundles use, archiving a bundle frees its pieces, bringing it back
    re-checks. Storage `gear/**` (members+equipment read, owner+equipment upload).
  - Screens: `GearItemsScreen` (/gear/items: by type, have, in bundles, "N loose", add/edit sheet),
    `GearBundlesScreen` (/gear/bundles), `GearBundleEditScreen` (/gear/bundles/new|:id, steppers capped at free).
  - Seed: gear@example.com (Equipment team test login), 7 gear items, 1 bundle.
  - saveGearBundle has a marker for step 2: refuse edits while the bundle is booked or out.
  - ADD-ON EXTRAS (owner, Oct 13): creators see ONLY what the team offers: bundles (booked whole) and
    add-on extras (`gear_bundles.kind: 'extra'`, exactly ONE kind of piece; pieces[0].qty = how many are
    offered; creators will pick how many). Loose pieces are never visible to creators (gear_items is staff-only).
    Extras use the same stock (a piece is in one bundle OR one extra). A bundle can't turn into an extra.
  STEP 2 BUILT (Oct 13, NOT deployed; changes security rules → needs owner OK): creators book whole
  bundles + add-on extras BY THE HOUR with an INSTANT HOLD.
  - Shared rules `functions/src/gearBooking.ts` (server + app): times = minutes after midnight, 30-min
    steps, 6 AM–midnight; `holdWindow` (open day = booked hours; CLOSED-day shoot = pick up last open day
    at the start time, back next open day 10 AM); holds stored as 'YYYY-MM-DDTHH:MM' text (sorts in time
    order); `freeQty` (bundle = 1, extra = offered count), no gap between bookings; `nextFreeStart`;
    `checkGearTimes` (creators 1 open day notice via pickup day; staff/arts/owner skip); `pruneHolds` (>7 days old).
  - Server `functions/src/gearBookings.ts`: createGearBooking (owner/arts/creator; equipment can't book),
    cancelGearBooking (own creator or owner/equipment, only while 'held'), declineGearBooking (owner/equipment,
    reason required). Transactions over `gear_holds/{offerId}.entries[]` (no names; members can read) →
    no double-booking (race tested). `gear_bookings/{id}`: title, notes, creator, date/start/end, from/to,
    pickupDay, closedDay, lines[{offerId, kind, name, qty, photo, pieces[{itemId, qty, name}]}] (snapshot for
    the step-3 pickup check), offerIds, status held|cancelled|declined, history. Rules: own creator or
    owner/equipment read; no client writes. Index: gear_bookings creatorEmail + date desc.
  - gear.ts: bundles store each piece's NAME (creators can't read gear_items); renaming a piece updates
    bundles; a bundle's pieces can't change and it can't be archived while it has holds that haven't ended
    (name/photo/description still editable).
  - App: `src/gearCart.tsx` (gear basket on the phone: day, hours, offerId→qty), `src/components/GearUi.tsx`
    (useGearWhen, GearWhenPicker, GearArt placeholder art, Pill, DayTimeline), screens GearShopScreen (/gear:
    bundles grid with Free/Taken, category chips, extras with steppers capped at free, "Review & hold"),
    GearOfferScreen (/gear/b/:id: what's in the case, battery note, timeline, next free + "Use those hours",
    similar free bundles), GearReviewScreen (/gear/review: shoot name, notes, pickup/return text, Hold),
    GearBookingsScreen (/gear/bookings: own or all; Upcoming / Past & cancelled), GearBookingScreen
    (/gear/bookings/:id: pickup/back-by/where, lines with pieces, cancel with confirm, decline with reason,
    history). Creator tabs: Props / Gear / Bookings / Account. Equipment tabs: Bookings / Bundles / All gear /
    Account (home = /gear/bookings). Admin: "Book gear", owner "Gear bookings".
  - Seed: 2 bundles (FX3 camera, 600d light) + C-stand extra (4) with piece names.
  Props category "Gear" (id 'gear') → "Tech props" (owner, Oct 13): default label changed in src/config.ts and
  ensureDefaultCategories renames the live doc once if its label is still exactly "Gear" (runs when staff open the app).
  Step 2 backend DEPLOYED Oct 13 (run 22, green).
  STEP 3 BUILT AND DEPLOYED (Oct 13, run 23, green, owner OK):
  - Statuses: held → out (picked up) → returned (photo) → checked_in (team). Cancel/decline only while held.
  - Shared helpers in gearBooking.ts: nowStamp (Toronto), addMinutes, pickupWindow ('early'|'open'|'over';
    opens 30 min before `from`, closes at `to`), isGearLate (out and now ≥ to + 30 min), wasGearReturnedLate,
    checkLines (one line per unit: key 'offerId|itemId|unit'; extras = qty units), countMissing.
  - Server (gearBookings.ts): pickUpGear (creator who booked, or owner/equipment; must sign; only in the
    window; missing → booking.pickup.missing + alerts, bundle.missing[] warning, and a 'missing_after' problem
    on the PREVIOUS holder's booking = latest returned/checked_in booking of that offer ending before this one),
    returnGear (≥1 photo URL; releases holds immediately so the next booking can go; returnedAt stamp +
    returnedLate), checkInGear (owner/equipment, status returned; missing → 'missing_at_checkin' problem on
    this booking + bundle warning; optional note), markGearFound (owner/equipment; removes bundle.missing[i]).
    createGearBooking refuses CREATORS with late gear (problem 'late').
  - Storage `gear-returns/{bookingId}/{file}`: add-only (resource == null), creator who booked + gear staff.
  - App: GearBookingScreen shows progress (Held / Picked up / Returned / Checked in), pickup checklist
    (PieceChecklist in GearUi; "Missing?"/"Found"; sign), return steps + required photo (ProofPhotos),
    team check-in checklist + note, return photo thumbnails (zoom), Problems box, Late banner.
    GearBookingsScreen = team "Gear queue" tabs Today (pickups today + due back today) / Out (late first,
    red ring) / To check in / Upcoming / Past, "⚠ Missing reported" pill; creators Upcoming / Past.
    Missing warnings on shop cards, bundle page, and team Bundles list with "Found it". Late banner on /gear.
  STEP 4 BUILT AND DEPLOYED (Oct 13, run 23, green). GEAR BUILD COMPLETE; owner to test on the preview.
  ONE SHOOT REQUEST with props + gear.
  - Props and gear share ONE shoot day (`ShootDaySync` in gearCart.tsx keeps both baskets on the same day).
  - `/reserve` (ReserveScreen) = "Your shoot": one shoot day picker, a Props section (arts department) and
    a Gear section (equipment team: hours picker `GearWhenPicker hoursOnly`, lines with availability and the
    pickup text). Button: "Book props + gear" / "Hold this gear" / "Reserve these props".
    GearReviewScreen was REMOVED (/gear/review redirects to /reserve); "Review your shoot" bars on Search + Gear.
  - Submit: when BOTH are in the basket the app makes a `shootId`. Gear is held first (createGearBooking),
    then props (createReservation). If props fail, the gear hold is cancelled (cancelGearBooking) and the
    creator sees "Nothing was booked; your gear is still in the basket."
  - Server: both createReservation and createGearBooking store an optional `shootId` (`shootIdOf` in
    reservations.ts validates it). Each team still sees only its own part in its own queue.
  - `src/components/ShootLink.tsx`: "Also in this shoot: gear/props (n) Open ›" on both booking pages.
- INVITES (owner report Oct 13: "only lets me invite creators"): the owner's picker had all roles in tests,
  so likely cause was "View as" preview (or another Google account / the old live site). People screen now:
  blue notice + "Exit preview" while previewing; one-line description per role (owner choice in amber);
  button "Invite as <role>"; success sheet "Invited ✓" with a ready-to-send message (share sheet, else copy)
  linking to LIVE_APP_URL (src/config.ts, https://proptracker-9732e.web.app); "already on the list" →
  "Open their access settings". Arts still invite creators only (rules unchanged). Checked in a browser:
  owner → equipment invite → that person lands on the gear queue; arts → creator invite.
- FAST PHOTOS (owner Oct 13: "pictures are loading too slow"; lists showed full photos, up to several MB
  from phones). `functions/src/thumbs.ts`: trigger `makeItemThumbs` (items/{id} written → any photo without a
  thumbnail gets a ≤480px JPEG in Storage `thumbs/<hash>-<token>.jpg`, cached 1 year; saved on the prop as
  `thumbs: {photoUrl: thumbUrl}`, only for current photos; broken photos skipped) + owner callable
  `makeMissingThumbs` (Health → "Speed up photos", 25 props/call, free, no AI). App: `thumbOf(item, url)` in
  src/services/itemShape.ts used by search cards, Your shoot, Health, Find duplicates, import review; prop page
  keeps full photos. New prop photos are shrunk on the phone to 1600px JPEG before upload (`src/lib/shrinkPhoto.ts`).
  Phone photo cache 500 → 4000 entries (vite.config). Backend DEPLOYED Oct 13 (run 24, owner OK); owner to tap
  "Speed up photos" on the preview, then live website deploy (with the sign-in fix) after OK.
- REBRAND STARTED (Oct 13): Attic Studios removed. Prime Capitol eagle (no words) traced to a vector:
  `src/components/BrandMark.tsx` (EAGLE_PATH, takes text colour); new app icons in public/icons (white eagle
  on #0E0E10). Login shows the eagle + "Welcome / Props and gear for Prime Capitol shoots".
  Owner wants an Apple-like, polished, consistent look across the full buildout. Look mockup with 3 directions
  (1 Black & Gold [recommended, + 3 automatically in light mode], 2 Monochrome, 3 Light & Gold) at
  https://claude.ai/artifact/1KaXE8dXb7pcXpnLbYpsJS . Shared rules proposed: iPhone system font (drop Passion
  One), large titles, one accent colour for "tap this", grouped cards, frosted tab bar, folding filters, sheets.
  OWNER PICKED "Black & Gold" (Oct 13), dark only for now (auto light mode = optional later). APPLIED:
  tailwind pt-* tokens (#000 bg, #1C1C1E surface, #2C2C2E border, #8E8E93 muted, #F5F5F7 text, #C9A961
  gold accent), iPhone system font for sans + display (Passion One removed; .font-display = 700, -0.02em),
  page titles white (not gold), frosted tab bar, theme colour #000, Search title = eagle + "Props".
  Gear step 1 + add-on extras backend DEPLOYED Oct 13 (run 21, green) with the owner's OK.
  APP NAME (owner, Oct 13): "Prime App" (renamed "Prime Capitol" Oct 17) — browser tab, home-screen label (manifest name/short_name,
  apple-mobile-web-app-title), not-invited screen, email sender name/subject/body text. Email server text
  changes go live with the next backend deploy.
  Tokens live in tailwind.config (pt-*), so the restyle is mostly there + font + shared components.
- STATUS Oct 13 evening: owner running the full import, then cleaning up with Find duplicates.
  Remaining, in suggested order: (1) owner tests preview as each role + invites team on People,
  then GO LIVE (deploy hosting; needs OK), then delete the OLD exposed Gemini key and (with OK)
  remove legacy `embedding` arrays; (2) DATABASE BACKUPS — owner picked option A (Oct 13): Google's built-in Firestore backups,
  button GitHub → Actions → "Set up backups" (`.github/workflows/backups.yml`, safe to re-run): daily
  (kept 14 days) + weekly Sundays (kept 14 weeks) + point-in-time recovery (7-day undo) + photo bucket
  soft delete 7 days. Few cents/month. If the deploy account lacks permission → add role
  "Cloud Datastore Owner" to github-deploy in IAM. RUN Oct 13 (run 1, green, owner OK): both schedules
  created, PITR on, photo soft delete was already on (7 days). Restoring = ask Claude (gcloud firestore
  databases restore to a NEW database, or PITR read; never overwrite live data without the owner);
  (3) email (on hold, see below); (4) optional: "Room" wording + move many bins at once;
  tune SIMILAR_MIN_SCORE with real props.
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
- Phase 6 (batch import) BUILT AND DEPLOYED Oct 13 (incl. retry fix). Owner decisions: photos are in Google Drive
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
    fingerprints (≥0.86, top 1000, skips health/dismissed pairs shared with Health); `comparePropPhotos`
    = optional Gemini photo check (~$0.001, counted in the import cap); `mergeProps` (owner + arts) keeps one,
    adds photos (+ quantity for copies), deletes the other if imported & never booked else archives it
    (`mergedInto`), re-points import_items so re-imports don't resurrect it. Refuses props in a current booking.
  - Owner's full import started failing after 64 photos. CAUSE: Gemini key was on Google's FREE
    tier ("429 You exceeded your current quota"). Owner turned on paid billing for the key's AI
    Studio project (Oct 13). Earlier note ( failure reasons are on each
    import_items doc `error` and now also logged). Fix: "too many requests"/quota/busy errors
    (`functions/src/limits.ts` isRateLimit) put the photo back in the queue (`lastError`) and return
    `slowDown`; the Import screen waits 30 s and continues, stopping after 6 stalls in a row.
    PER_CALL lowered 8 → 4. Failed photos can be re-queued with "Try failed again".
  - SUGGEST AN EDIT (owner request, Oct 13): creators tap "Something wrong? Suggest an edit" on a prop
    (message + optional proposed name/quantity/condition/description + photos in request-photos/{email}).
    `suggestions/{id}` written by the app under rules (own name, status 'open', only props they can
    see; staff may only set status applied/dismissed + reply). Staff see open ones on the prop page and
    in Admin → Suggested edits (`SuggestionsScreen`); "Apply changes" edits the prop (normal
    updateItem → Activity log) then marks it applied. Creators see their suggestion's status.
  - Oct 13 (DEPLOYED Oct 13):
    creators get a "Wrong name?" link under the prop name (name-only suggestion); ARTS can now merge
    duplicates (`mergeProps` owner+arts; deleting a single imported prop stays owner-only); Find duplicates
    shows each photo's file name. BINS: `functions/src/binNames.ts` (shared with the app) — `binKey`
    ignores punctuation/spaces/"Bin"/leading zeros, so "B.31", "B:31", "B: 31", "B031" are one bin;
    Bins screen shows "Look-alike bins" → `mergeBins` (owner+arts) moves props into the kept bin and
    deletes the extra bins (their old QR stickers stop working).
  - SUPPLIES (owner decision Oct 13): consumables (tape, 3M adhesive squares, batteries…) stay as
    props with a "supplies" tag; the AI prompts (add-prop + import) now put "supplies" first for them.
    No re-analysis of already-imported photos (owner: not worth it). ARTS can now delete imported,
    never-booked props too (`deleteImportedProp` owner+arts) so the prop department can clear them.
  - BETTER SEARCH (owner request Oct 13: "president" should find the Abraham Lincoln mask), DEPLOYED Oct 13 (owner ran the top-up):
    hidden item field `searchWords` (AI-written associations: who/what it depicts, roles, themes,
    occasions, eras, synonyms; staff can edit "Extra search words" on add/edit; never shown on the prop
    page). Written by analyzePropPhoto + import (SEARCH_WORDS_RULE in gemini.ts); tags now 6–10 incl.
    "who/what it depicts". Used by text search (`src/lib/search.ts`, which also treats plurals as
    singulars) and by the smart-search fingerprint (searchTextFor in index.ts → re-embedded automatically).
    Existing props: owner button Health → AI usage → "Improve search words" (`improveSearchWords` in
    `functions/src/searchWords.ts`, 12 props/call, photo + details, ~$0.002/prop ≈ $3 for 1,500, counted
    in the import cap; marks `searchWordsAt`; keeps old words). ASK THE OWNER before running it.
  - DUPLICATES IN DIFFERENT BINS (owner decision Oct 13: NO multi-bin props; the team moves copies onto
    one shelf). Find duplicates flags pairs whose bins differ (amber box + "In different bins (N)" filter);
    staff tap the bin they're in now, and `mergeProps` takes optional `binId` (must be one of the two
    props' bins) → kept prop gets that bin + its storage area. DEPLOYED Oct 13 (run 20).
  - Find duplicates (Oct 13, final shape after owner feedback): look-alike pairs are JOINED INTO GROUPS
    (`groupPairs` in `src/lib/duplicates.ts`, any size/chains). In a group staff TAP PHOTOS TO TICK the
    ones that are the same prop (🔍 = full-screen zoom; "Keep this one" picks the kept one), then:
    merge them (Copies / Same one; if spread over bins, tap the bin they're in now) or "📦 Flag N to
    gather into one bin" → saved in `health/gather` {groups: {id: {ids, at}}} (staff, shared) and shown
    in the "To gather" tab: readable list (photo, name, "1 in A1 (room)" lines) + "Send this list to the team" (phone share sheet, else copy; text from `shelfList`); merging there removes
    the flag. The UNTICKED ones are RELEASED: only their pairs with the ticked ones are dismissed
    (`crossKeys`), so they stay candidates with each other and with any other prop (owner requirement).
    Tabs: To check / To gather / Later ("Decide later" = `health/later` {duplicatePairs}). No backend
    deploy needed for this (app + existing staff rules on `health/*`). findDuplicates returns top 1000
    pairs; if one merge in a group fails (e.g. booked), the ones already merged stay merged. Checked in a
    real browser against the emulator (flag 3 of 5 → other 2 stay grouped; gather → merge ×3 into chosen bin).
  - Search screen header FOLDS while scrolling down (owner request Oct 13): `src/hooks/useHideOnScroll.ts`
    (finds the scrolling <main>, sets overflow-anchor:none + 300 ms quiet time, or the browser's scroll
    nudge makes it flicker); title, collection switch, chips, status, shoot day fold away, the search box
    stays; a one-line "📅 day · filter · Show filters" appears when something is filtered. Not while the
    date picker is open.
  - Rooms: bins already belong to "storage areas" (= rooms); imported bins go to "Imported – needs
    sorting". Owner may later want "Room" wording and moving many bins at once.
