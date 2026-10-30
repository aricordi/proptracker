// THE APP GUIDE: what the AI knows about how Prime Capitol works, screen by screen (owner, Oct 28: "people will use the
// AI for everything… it must understand how the app works and the design of each screen, and stay updated without me
// asking"). The "how do I…?" helper (askApp in assistant.ts) answers ONLY from these entries, and only from the ones
// the asker's role can use, so a creator never learns about staff screens.
//
// KEEP IT CURRENT: any change to a screen, button, tab, rule or role updates the matching entry IN THE SAME CHANGE.
// tests/unit/appGuide.test.ts fails if a route in src/App.tsx has no entry here. Numbers that live in settings
// (notice days, hold minutes, strikes…) are NOT written here: askApp adds the live values to every answer.
export type GuideRole = 'owner' | 'admin' | 'arts' | 'equipment' | 'creator' | 'demo'
export interface GuideEntry {
  id: string
  title: string
  path?: string            // a screen people can be sent to (":x" = needs a specific item, so no button)
  who: GuideRole[]
  about: string            // what it is, where it is, and how to use it, in plain words
  words?: string           // extra words people might use to ask about it
}

const ALL: GuideRole[] = ['owner', 'admin', 'arts', 'equipment', 'creator', 'demo']
const MEMBERS: GuideRole[] = ['owner', 'admin', 'arts', 'equipment', 'creator']
const FILMERS: GuideRole[] = ['owner', 'creator']           // people who book shoots, props and gear
const OWNER: GuideRole[] = ['owner']

export const TABS: Record<GuideRole, string> = {
  creator: 'Bottom tabs: Home, Book, Browse, Me. The purple ✦ AI button sits at the top of Home, Book, Browse and Me.',
  owner: 'Bottom tabs: Home, Book, Browse, Me, Team (the Team tab has every staff and settings tool, in folding groups).',
  admin: 'Bottom tabs: Dashboard, Queue (props), Gear (gear queue), Schedule, Props (browse).',
  arts: 'Bottom tabs: Queue, Props, Calendar, Add, Admin.',
  equipment: 'Bottom tabs: Queue (gear), Schedule, Bundles, All gear, Admin.',
  demo: 'Bottom tabs: Props and Me. Booking is not open yet for this account ("Props only"); the owner switches people to the full app.',
}

export const GUIDE: GuideEntry[] = [
  // ── Everyone ──
  { id: 'browse', path: '/browse', title: 'Browse / Props', who: ALL, words: 'search find catalogue closet costume filter category',
    about: 'The whole props and costumes closet with photos. Type in the search box (it also finds related words, like "president" for a Lincoln mask), tap a category chip, or Status to filter. Tap a photo to open the prop page. Creators with a shoot picked see Free/Taken for that shoot and a + on each photo to add it.' },
  { id: 'item', path: '/item/:id', title: 'Prop page', who: ALL, words: 'details photos quantity wrong name suggest edit',
    about: 'Photos, how many we have, condition and notes. "Add to this shoot" (people who book) adds it to the shoot you are adding to. "Something wrong? Suggest an edit" sends a fix to the arts team.' },
  { id: 'account', path: '/account', title: 'Me / Account', who: ALL, words: 'profile photo channel name sign out notifications birthday',
    about: 'Your profile (tap the photo to change it, add your channel name, and your birthday: month + day, no year; on the day the app throws you a little party and tells the team), notifications on/off with a test, Help, the practice tour, and Sign out.' },
  { id: 'help', path: '/help', title: 'Help', who: ALL, words: 'faq questions',
    about: 'Searchable answers to common questions, by topic. Open it from Me → Help or the ? button.' },
  { id: 'notifications', title: 'Notifications', who: ALL, words: 'push ping alert not getting notifications iphone home screen',
    about: 'Me → Notifications → Turn on, then "Send me a test". On iPhone they only work once the app is added to the Home Screen (Share → Add to Home Screen) and opened from that icon. Nothing showing? Try "Test with the app closed", check Settings → Notifications → Prime Capitol, and turn Focus off.' },
  { id: 'signin', title: 'Signing in', who: ALL, words: 'login log in google blank popup invite',
    about: 'Sign in with Google using the exact email you were invited with. If an Instagram/Messenger/Gmail link opened it, open the page in Safari or Chrome instead. Blank Google page: turn off content blockers / private browsing, or tap "Sign in another way".' },
  { id: 'demo', title: 'Props only (sneak peek)', who: ['demo'], words: 'cant book booking not open full app access',
    about: 'This account can search the props and ask the AI for prop ideas. Booking shoots, props and gear opens when the owner switches you to the full app; nothing to do on your side.' },
  { id: 'ai', title: 'The ✦ AI helper', who: ALL, words: 'ai chat assistant ideas',
    about: 'Describe a video idea and it finds props we have, grouped by scene ("✦ More like these" for more; "Often used with these" are props creators usually request together). People who book can also ask for filming times ("2 hours with Kyle next week") and tap Book, or tap "Plan my shoot" to go time → props → gear → review. It can also explain how to use the app. It never books or sends anything by itself: every Book/Add/Send is your tap.' },

  // ── Creators and the owner (people who film) ──
  { id: 'home', path: '/', title: 'Home', who: FILMERS, words: 'next shoot to do streak usuals',
    about: 'Your next shoot card (Time / Props / Gear with each cutoff, and Check in when it opens), the search bar, your usual props, To do (invites, swaps, missed check-ins, shoots that still need props), Coming up, and Book a shoot.' },
  { id: 'book', path: '/schedule', title: 'Book (schedule)', who: [...FILMERS, 'equipment', 'admin'], words: 'book a shoot slot house cliff time friend back to back priority',
    about: 'Tap "Book a shoot": choose Just me / + 1 friend / + 2 friends, pick a day in the strip, then tap a gold house button on a free time. With friends, your slot is booked and each friend\'s next slot is held for them to confirm. The top switch "At the houses | Somewhere else" picks the place: Somewhere else books an offsite shoot with any hours and an address. The day view shows Cliff 1 | Cliff 2 | Offsite with who is in each slot. Priority days at Cliff 1 are locked for the priority group until the Sunday release.' },
  { id: 'shootsheet', title: 'Your shoot (shoot page)', who: FILMERS, words: 'move swap cancel check in wrap history shoot details',
    about: 'Tap your shoot on Book, Home or My shoots. It shows the time and place, Props & costumes and Gear for that shoot with the last day to add each, On the day (check in with a set photo, then wrap), and More: Move, Swap with someone, Cancel, History.' },
  { id: 'shoots', path: '/shoots', title: 'My shoots', who: FILMERS, words: 'my shoots upcoming past prep',
    about: 'All your shoots: Coming up (Today / This week / Later) with what is still missing (+ Props by…, + Gear by…) and Past (filmed, no-show, not checked in). Also from Book → "All my shoots".' },
  { id: 'gear', path: '/gear', title: 'Browse → Gear', who: FILMERS, words: 'camera light drone kit bundle single item rent',
    about: 'Browse → Gear tab. Grab-and-go kits first, then single items (pick how many). With a shoot picked, gear uses that shoot\'s hours and shows Free/Taken; tap + to add. Tap a kit to see every piece in the case.' },
  { id: 'gearitem', path: '/gear/b/:id', title: 'Gear kit page', who: [...FILMERS, 'equipment', 'admin'], words: 'pieces in the case battery next free',
    about: 'What is in the case, when it is next free, similar free kits, the battery note (charge is not guaranteed) and the late return fee.' },
  { id: 'reserve', path: '/reserve', title: 'Your shoot (review & send)', who: FILMERS, words: 'basket cart send request review checkout make or find',
    about: 'Everything you added for one shoot: props and gear with amounts. Type the video name, add "Request something we don\'t have" (the arts team makes or finds it, needs more notice), then Send. Until you send, it is only on your phone.' },
  { id: 'requests', path: '/requests', title: 'My requests', who: FILMERS, words: 'status where is my request packed ready change track',
    about: 'Every props request and gear booking, grouped by shoot, with a progress bar (Requested → Being picked → Packed → Picked up → Returned; gear Held → Picked up → Returned → Checked in). Open one to change it (while still Requested/Held), see details, or "Return everything". Button with a box icon next to ✦ AI.' },
  { id: 'propsrequest', path: '/reservations/:id', title: 'A props request', who: [...FILMERS, 'arts', 'admin'], words: 'change request add more pickup sign return photo',
    about: 'Progress, the list of props, Change (steppers, remove, search the closet to add, Save) while Requested, pickup sign-off when Packed, and the return form (one camera photo of everything coming back).' },
  { id: 'gearbooking', path: '/gear/bookings/:id', title: 'A gear booking', who: [...FILMERS, 'equipment', 'admin'], words: 'pickup tick pieces missing return hand over shared gear late fee',
    about: 'Pickup opens 30 minutes before: tick every piece, mark anything Missing?, then sign. Return: a photo of everything in the case with batteries charging, tick who used it if shared. "Someone else needs it now? Hand it over" passes it to another creator. Late gear carries the late return fee.' },
  { id: 'return', path: '/return', title: 'Return everything', who: FILMERS, words: 'bring back return all one photo',
    about: 'From My requests: tick what is coming back (props and gear together), take ONE photo, and send. Untick anything you keep for later.' },
  { id: 'cutoffs', title: 'Last day to add props and gear', who: FILMERS, words: 'cutoff notice deadline too late add by',
    about: 'Each shoot shows "Props by", "New props by" (things to make or find) and "Gear by" dates, counted in open days before the shoot (closed days don\'t count). After that the + buttons disappear for that shoot.' },
  { id: 'onday', title: 'Shoot day: check in and wrap', who: FILMERS, words: 'check in set photo wrap report ran over mess no show',
    about: 'Check in opens shortly before your slot: open the shoot, take a set photo, and you can report the slot before you (ran over, left a mess) with photos and a note. After filming tap Wrap and say what you filmed. Missed the check-in? You have a few hours to explain on the shoot page.' },
  { id: 'moving', title: 'Moving, swapping, cancelling', who: FILMERS, words: 'reschedule move cancel swap late cancel strike',
    about: 'Shoot page → More. Moving or cancelling is free with enough notice; closer than that only a swap with another creator avoids counting as a no-show. Cancelling within a few minutes of booking is always free.' },
  { id: 'strikes', title: 'Strikes and pauses', who: [...FILMERS, 'admin', 'equipment'], words: 'strike pause penalty no show blocked',
    about: 'No-shows, late cancels and upheld reports give a strike. Too many in the window pauses props and gear booking for a while (house booking still works). The team can lift a pause.' },
  { id: 'latefee', title: 'Late return fee', who: [...FILMERS, 'admin', 'equipment'], words: 'late fee penalty 10 percent value late gear',
    about: 'Company rule: gear brought back late (from 30 minutes after the booked end) carries a fee of 10% of its value, on the last person who had it. The app logs it; admins can excuse exceptions. Props late from 10 AM the next open day are logged, no fee.' },
  { id: 'calendarfeed', title: 'Shoots in your phone\'s calendar', who: [...FILMERS, 'equipment', 'admin'], words: 'add to my calendar ical subscribe phone calendar',
    about: 'Book → the calendar card at the bottom → "Add to my phone\'s calendar": iPhone button, or Copy link for Google Calendar. It updates by itself.' },
  { id: 'tour', path: '/tour', title: 'Practice tour', who: ['creator', 'owner'], words: 'tutorial practice learn walkthrough',
    about: 'Me → App tour: a pretend shoot from booking to returning, with nothing real sent. Gear team: Account → Gear team tour. Admins: Admin → Admin tour.' },

  // ── Arts department (props team) ──
  { id: 'queue', path: '/reservations', title: 'Props queue', who: ['owner', 'arts', 'admin'], words: 'queue to prepare pick pack ready out returns late',
    about: 'Tabs: Today, To prepare, Ready, Out, Returns, Done. Open a request to pick (ticks grouped by storage area and bin), mark "Can\'t find it" with a reason, add the pack photo, then Packed. After the creator returns it, check each prop in (damaged / missing). Admins can look but not change.' },
  { id: 'add', path: '/add', title: 'Add a prop', who: ['owner', 'arts'], words: 'new prop photo ai tag',
    about: 'Take a photo; the AI fills the name, category, tags and description (marked ✦ AI). Check them, set the bin and quantity, Save.' },
  { id: 'editprop', path: '/item/:id/edit', title: 'Edit a prop', who: ['owner', 'arts'], words: 'edit change archive bin quantity',
    about: 'From the prop page → Edit: photos, name, quantity, condition, bin, extra search words, notes. Props are archived, never deleted.' },
  { id: 'reqcalendar', path: '/calendar', title: 'Requests calendar', who: ['owner', 'arts', 'admin'], words: 'calendar by day which shoot',
    about: 'Every props request by shoot day, with the creator, house and time.' },
  { id: 'bins', path: '/bins', title: 'Bins and bin check', who: ['owner', 'arts'], words: 'bin storage shelf qr check',
    about: 'Bins in number order with how many props each holds and the bin check progress. Scan a bin\'s QR (or open it) → Check this bin: Here / Not here for each prop, move props in, then Done → it goes to the next bin.' },
  { id: 'bin', path: '/bin/:qrSlug', title: 'One bin', who: ['owner', 'arts'], words: 'qr code sticker',
    about: 'The props in that bin and the bin check (see Bins).' },
  { id: 'locations', path: '/locations', title: 'Storage areas', who: ['owner', 'arts'], words: 'rooms areas storage',
    about: 'The rooms/areas that hold the bins.' },
  { id: 'duplicates', path: '/duplicates', title: 'Find duplicates', who: ['owner', 'arts'], words: 'duplicate merge same prop twice',
    about: 'Look-alike props in groups: tick the ones that are the same, then merge them, or flag them to gather into one bin.' },
  { id: 'health', path: '/health', title: 'Health', who: ['owner', 'arts'], words: 'fix it missing photo tags inventory export csv',
    about: 'Props that need fixing (no photo, no bin…), inventory counts, look-alike tags, empty bins and a CSV export.' },
  { id: 'suggestions', path: '/suggestions', title: 'Suggested edits', who: ['owner', 'arts', 'admin'], words: 'suggestion fix from creators',
    about: 'Fixes creators suggested on prop pages: Apply changes or Dismiss.' },
  { id: 'activity', path: '/activity', title: 'Activity', who: ['owner', 'arts', 'admin'], words: 'log history who changed',
    about: 'Everything that happened to props and requests, who and when.' },

  // ── Equipment team (gear + schedule) ──
  { id: 'gearqueue', path: '/gear/bookings', title: 'Gear queue', who: ['owner', 'equipment', 'admin'], words: 'gear queue today out check in late',
    about: 'Tabs: Today, Out (late first), To check in, Upcoming, Past. Open a booking to decline (reason needed), watch the pickup, and check it in (tick every piece, note damage).' },
  { id: 'bundles', path: '/gear/bundles', title: 'Bundles & single items', who: ['owner', 'equipment'], words: 'kit bundle build case found it',
    about: '"+ Bundle" builds a kit from loose pieces (a piece is in one kit at a time). Single items creators can book are switched on in All gear. Missing piece warnings have "Found it".' },
  { id: 'bundleedit', path: '/gear/bundles/:id', title: 'Edit a bundle', who: ['owner', 'equipment'], words: 'kit pieces',
    about: 'Name, photo, category and the pieces in the case (steppers only allow what is still free). Pieces can\'t change while it is booked.' },
  { id: 'allgear', path: '/gear/items', title: 'All gear', who: ['owner', 'equipment'], words: 'inventory piece serial value public internal',
    about: 'Every piece you own: + Add gear (name, type, serial or how many, replacement value), "Creators can book" vs "Internal only", and how many are loose.' },
  { id: 'scheduleteam', path: '/schedule/team', title: 'Schedule team', who: ['owner', 'equipment', 'admin'], words: 'check ins reports creators they filmed no show lift pause',
    about: 'Check-ins (decide They filmed / No-show · strike for missed ones), Reports from the next creator (Dismiss or Strike), Creators (filmed of booked, strikes, Lift a pause).' },
  { id: 'block', title: 'Block time / book for someone', who: ['owner', 'equipment'], words: 'block cleaners maintenance event book for',
    about: 'On Book, tap a free slot → "Book this slot…" for a creator, or Block it (cleaners, maintenance, event…) with a note.' },

  // ── Admins and the owner (people + rules) ──
  { id: 'dashboard', path: '/admin', title: 'Dashboard / Team menu', who: ['owner', 'admin', 'arts', 'equipment'], words: 'admin menu team page tools',
    about: 'Admins: the creator scoreboard (who is posting more or less, needs attention) and the admin tools. Owner: four daily buttons, the scoreboard (Show/Hide) and every tool in folding groups. Arts and equipment: their tools.' },
  { id: 'analytics', path: '/analytics', title: 'Analytics', who: ['owner', 'admin'], words: 'stats flags late returns teams trends report card',
    about: 'Tabs: Creators (compared with each other), Flags (tap a card for the list; each flag has Excuse, Send a note, Give a strike…), Late returns (the fee log, Download), Teams, Trends. The date pill changes the range; the table icon opens the Advanced view.' },
  { id: 'creators', path: '/creators', title: 'Creators', who: ['owner', 'admin'], words: 'creator list flags filmed',
    about: 'Each creator\'s filmed-of-booked and flags; tap one for their record.' },
  { id: 'person', path: '/people/:email', title: 'A person\'s record', who: ['owner', 'admin', 'arts'], words: 'record strikes give strike pause test notification',
    about: 'Their bookings, late returns, damage, flags and strikes, with Give a strike / Pause bookings (reasons required) and "Send a test notification".' },
  { id: 'users', path: '/users', title: 'People & access', who: ['owner', 'admin'], words: 'invite people role access props only full app turn off change email',
    about: 'Invite (owner: any role; admins: creators). Tap a person: Role, App access (Props only | Full app, owner only), Turn off access, and "Change their email…" (owner; merges into an existing account and removes the old one).' },
  { id: 'rules', path: '/booking-rules', title: 'Booking rules', who: ['owner', 'admin'], words: 'notice lead days closed days holidays turnaround washing',
    about: 'Props notice, new-props notice, turnaround (per category too, e.g. costume washing) and closed days / holidays.' },
  { id: 'rulessheet', path: '/rules-sheet', title: 'Settings sheet', who: ['owner', 'admin'], words: 'all rules at a glance',
    about: 'Every live rule in one list, what it means and who changed it.' },

  // ── Owner only ──
  { id: 'schedulesettings', path: '/schedule/settings', title: 'Schedule settings', who: OWNER, words: 'slots priority group release strikes notice houses',
    about: 'Houses, slot times, house slots a day, moving notice, check-in and strike numbers, priority days, Sunday release time and the priority group. Save at the bottom.' },
  { id: 'connections', path: '/connections', title: 'Calendar & email', who: OWNER, words: 'google calendar email connect account share calendar id client secret gocspx access',
    about: 'Three steps: 1 connect the Prime Capitol Google account (one-time Google Cloud setup inside), 2 the APP CALENDAR (a new calendar, e.g. "Prime Capitol Shoots", owned by whoever should own it and shared with the account with "Make changes to events"): paste its ID → Save & test; every booking, move, cancel and block goes there, one colour per place, with the shoot props and gear; then add the OLD calendars (up to 6, read only, "See all event details" is enough): name, ID and whether it is all Cliff 1, all Cliff 2 or mixed → Save & check, 3 Turn on emails → test. The client secret starts with GOCSPX- and Google shows it in full only once (else open the client → Add secret). "You need additional access" in Google Cloud = signed in with the wrong Google account: switch to the one that owns the project.' },
  { id: 'calimport', path: '/schedule/import', title: 'Import from Google Calendar', who: OWNER, words: 'import existing events clash old calendars stromedy all day',
    about: 'Reads every calendar on Calendar & email (never changes them). Each event shows its calendar, with chips to look at one calendar at a time; choose a shoot (who, which house), blocked time, or skip; Import only acts on what is showing. All-day events count as the whole day. The house comes from the address or name in the event (2375 Cliff = Cliff 1, 2371 Cliff = Cliff 2), else the usual house of that calendar. Events about someone being away and birthdays are hidden and never brought in (Show hidden lists them). Real hours are kept; old events that overlap are imported as a clash, and blocked time landing on a shoot already booked in the app keeps the shoot, marks it Clash and notifies the schedule team and the owner. Checked every 15 minutes: changes and deletions are followed by themselves, new events wait for a person.' },
  { id: 'calsync', path: '/schedule/calendar', title: 'What the app added to the calendar', who: OWNER, words: 'calendar events remove retry',
    about: 'Events the app put in Google Calendar (Remove) and anything Google refused (try again).' },
  { id: 'email', path: '/email', title: 'Email (advanced)', who: OWNER, words: 'recent emails smtp service',
    about: 'Recent emails sent and other email services. Turning emails on is simpler on Calendar & email.' },
  { id: 'ai settings', path: '/ai', title: 'AI helpers budget', who: OWNER, words: 'ai budget cost limit',
    about: 'This month\'s AI spend, the monthly budget, uses per person per day, and the separate slice for Props only creators.' },
  { id: 'costs', path: '/costs', title: 'Running costs', who: OWNER, words: 'cost money storage photos clean up',
    about: 'What the app costs this month and the photo clean-up.' },
  { id: 'categories', path: '/categories', title: 'Categories', who: OWNER, words: 'category add rename',
    about: 'Add or rename prop categories.' },
  { id: 'import', path: '/import', title: 'Import props from Drive', who: OWNER, words: 'batch import drive photos',
    about: 'Import prop photos from Google Drive folders, then review them (merge look-alikes, approve, skip).' },
  { id: 'importreview', path: '/import/:jobId', title: 'Import review', who: OWNER, words: 'approve skip merge',
    about: 'Approve, skip or merge the imported props of one import.' },
  { id: 'howitworks', path: '/schedule/how', title: 'How it works (schedule rules)', who: MEMBERS, words: 'rules schedule how it works',
    about: 'The booking rules for everyone, written from the live settings.' },
  { id: 'gearteamtour', path: '/tour/gear', title: 'Gear team tour', who: ['owner', 'equipment'], words: 'practice',
    about: 'The equipment team\'s practice tour.' },
  { id: 'admintour', path: '/tour/admin', title: 'Admin tour', who: ['owner', 'admin'], words: 'practice',
    about: 'The admins\' practice tour.' },
]

// Routes that are only redirects or aliases (no guide entry needed). Keep this short.
export const NOT_SCREENS = ['*', '/checkout', '/gear/review', '/google', '/gear/bundles/new']

export function guideFor(role: GuideRole): GuideEntry[] { return GUIDE.filter(e => e.who.includes(role)) }

// Without the AI: the entries whose words best match the question (used when the AI is busy, and to shortlist).
export function searchGuide(question: string, entries: GuideEntry[], max = 4): GuideEntry[] {
  const q = question.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/s$/, ''))
  if (!q.length) return []
  return entries.map(e => {
    const hay = `${e.title} ${e.words ?? ''} ${e.about}`.toLowerCase()
    const head = `${e.title} ${e.words ?? ''}`.toLowerCase()
    return { e, score: q.reduce((n, w) => n + (head.includes(w) ? 3 : hay.includes(w) ? 1 : 0), 0) }
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, max).map(x => x.e)
}
const STOP = new Set(['how', 'the', 'and', 'can', 'what', 'where', 'when', 'does', 'this', 'that', 'with', 'for', 'you', 'your', 'are', 'there', 'want', 'need', 'use', 'get', 'app', 'how', 'way', 'have', 'from', 'into', 'its', 'not', 'any', 'why'])
