# Prime App (was Prop Tracker) — notes for Claude

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
screen. #root is now position:fixed; inset:0; overflow-y:auto (src/index.css). On the preview; live after owner OK.
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
- `npm test`: 272 tests in the emulator (rules, server functions incl. double-booking races and the full pick→return journey, booking/search/health logic).
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
  APP NAME (owner, Oct 13): "Prime App" — browser tab, home-screen label (manifest name/short_name,
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
