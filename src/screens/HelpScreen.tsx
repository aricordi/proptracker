// Help for creators: short answers to "how do I…?", searchable. Numbers come from the live settings,
// so the answers stay right when the team changes the rules.
import { ReportProblemRow } from '../components/BugReport'
import { APP_VERSION } from '../lib/version'
import { LATE_FEE_PERCENT } from '../../functions/src/gearStock'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { useBookingSettings } from '../hooks/useBookings'
import { useScheduleSettings, houseOpen, houseClose, INVITE_HOLD_MINUTES, UNDO_MINUTES, MONTHLY_SLOTS_ON } from '../services/schedule'
import { GEAR_LATE_MINUTES, fmtTime } from '../../functions/src/gearBooking'
import { IconText, type IconName } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'

interface Q { q: string; a: ReactNode; words?: string; go?: [string, string] }
interface Topic { title: string; icon: IconName; items: Q[] }

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

export default function HelpScreen() {
  const navigate = useNavigate()
  const { demo, role } = useSession()
  // The tab with your profile is called More for creators on the full app, Me for the owner and Props-only creators.
  const ME = role === 'creator' && !demo ? 'More' : 'Me'
  const s = useScheduleSettings()
  const b = useBookingSettings()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const c1 = s.houses.cliff1.name, c2 = s.houses.cliff2.name
  const prio = s.priorityWeekdays.map(d => WEEKDAYS[d]).join(' and ')
  const slots = s.slots.length ? `${fmtTime(houseOpen(s))} to ${fmtTime(houseClose(s) % 1440)}` : ''

  const all: Topic[] = [
    { title: 'Getting started', icon: 'hand', items: [
      { q: 'How do I put the app on my home screen?', words: 'install icon iphone android', a: <>On iPhone, open the app in <b>Safari</b>, tap the <b>Share</b> button (square with an arrow), then <b>Add to Home Screen</b>. On Android, open it in Chrome and tap <b>⋮ → Add to Home screen</b>. It then opens like a normal app.</> },
      { q: 'Something broke, looks wrong, or is missing in the app', words: 'bug report problem error crash glitch broken wrong missing screenshot not working issue', a: <>Tap <b>Report a problem</b> (top of this page, in More / Me, in the team menus, or type "the app is broken" in the chat). Go to the screen where it happened and tap <b>Report this screen</b>: the app takes a screenshot, and you say what happened. It also sends the page, the last pages you opened, your phone and app version and recent errors, so you don't have to explain the technical side. Shortcut: hold <b>two fingers</b> on any screen for a moment. Broken gear or props go to the team instead: tell the chat "the tripod is broken".</> },
      { q: 'I signed in with the wrong Google account', words: 'wrong account email switch change google login other account', a: <>Google now asks <b>which account</b> to use every time you sign in. If you already got in with the wrong one and see "You're not on the list yet", tap <b>Use a different Google account</b> and pick (or add) the email you were invited with. From inside the app: More → <b>Sign out</b>, then sign in again and choose the right account.</> },
      { q: "I can't sign in / nothing happens when I tap Sign in with Google", words: 'login google blank error', a: <>Open the link in <b>Safari or Chrome</b>, not inside Instagram, Messenger or Gmail (Google blocks sign-in there). Turn off ad blockers or Private Browsing for this page. On the sign-in screen, "Trouble signing in? Sign in another way" also helps. Still stuck? Ask the team to check you've been invited with the right email.</> },
      { q: 'How do I use the app?', words: 'tour tutorial practice demo learn walkthrough start chat', go: ['/', 'Chat'], a: <>Open the <b>Chat</b> tab and type what you need, like a text: "Thursday Cliff 1 at 5pm", "props for a séance video", "cancel my next shoot", "how do I return my gear?". Your shoots and anything to do (bring things back, invites, swaps) show at the top of the chat. Say it however you like; the chat works out what you mean and shows you the right button. Nothing happens until you tap it.</> },
      { q: 'Can I ask for a time and props in one message?', words: 'say it once time and props together one message chatgpt claude', a: <>Yes, in <b>ChatGPT or Claude</b> with Prime Capitol added (tap <b>✦ AI</b>): "Thursday 5pm at Cliff 1 with Kyle, I need a cop costume". It finds the time, the props, and requests them after you say yes. The app's Chat hands those asks over with your message already typed.</> },
      { q: 'What is the "Did you film?" card?', words: 'did you film filmed show up attendance after shoot yes no wrap', a: <>After each shoot the chat asks <b>Did you film?</b> One tap on <b>Yes, we filmed</b> (add what you filmed if you like), or <b>No, we didn't</b> with a few words. It tells the team who filmed, since there's no check-in. You can also just tell ChatGPT or Claude "we filmed".</> },
      { q: 'Is the chat a person? What can it do?', words: 'ai bot who am i talking to robot assistant chatgpt claude', a: <>It's the app's own helper, not a person. It answers <b>how do I…</b> questions, tells you where your shoots and requests are at, and does returns, problem reports and pick-ups right in the chat. For <b>props ideas, finding times and planning a shoot</b>, tap <b>✦ AI</b>: it opens your ChatGPT or Claude with Prime Capitol added, which is much smarter (it reads the whole closet, shows photos and books with your OK). The first time it shows the 2-minute setup.</> },
      { q: 'Can I send the chat a photo? Can it talk back?', words: 'camera picture photo screenshot find props like this read aloud speaker voice talk mic mute', a: <>A photo of a prop you want goes to <b>ChatGPT or Claude</b> (the chat opens it for you): attach it there and it finds the closest props in the closet. You can also search Props with the camera button. To talk instead of typing, tap the <b>mic</b>; ChatGPT's voice mode works with Prime Capitol too.</> },
      { q: 'Does the chat remember what I said?', words: 'remember earlier history forget welcome back new chat clear old messages', go: ['/', 'Chat'], a: <>Yes, on this phone. Your last messages come back under <b>Earlier</b> next time you open the Chat, so you can pick up where you left off (old times and prop ideas show as plain text: ask again for what's free now). It also knows your last few video names and who you usually film with. Tap <b>New chat</b> to forget it; it forgets by itself after 7 days. Photos are never kept.</> },
      { q: 'How is the app laid out?', words: 'tabs home book browse me chat calendar props more', a: <><b>Chat</b>: type what you need; your next shoots and anything to do are at the top. <b>Calendar</b>: the month of free spots at the houses. <b>Props</b>: every prop and costume. <b>More</b>: your profile, shoots, requests and these help pages.</> },
    ] },
    { title: 'Booking a shoot', icon: 'calendar', items: [
      { q: `How do I get my guaranteed ${c1} slots?`, words: 'monthly four 4 guaranteed slots', a: <>Everyone gets {s.monthlySlots} {c1} slots a month. The equipment team schedules them for you and they show up on your calendar and in My shoots. Need more? Book extra slots any time they're free.</> },
      { q: 'Can the app remember my birthday?', words: 'birthday celebrate party', go: ['/account', ME], a: <>Yes: <b>{ME}</b> → your profile → <b>Birthday</b> (just the month and day, no year) → Save. On the day, the app throws you a little party, and your team gets a pop-up so they can wish you a happy birthday. Remove it there any time.</> },
      { q: 'How do I book filming time?', words: 'reserve slot house free time start end', go: ['/schedule', 'Calendar'], a: <>Go to <b>Calendar</b>. The month shows how many free hours each day has: tap a day, tap a gold <b>free</b> stretch ({c1} or {c2}), then pick your <b>start and end</b> (any quarter hour, e.g. 1:15–3:15) and <b>who's filming</b>. Each person gets up to {s.slotMinutes / 60} hours, so 4 hours = you + one collaborator on the same booking. Or just type it in the <b>Chat</b> ("Thursday {c1} 1:15 to 3:15"). Filming elsewhere? Tap a day, then <b>Offsite</b> next to the date. The day starts at 9 AM; if there's free time earlier it says so, and <b>Show all times</b> shows every hour. Blocked time (cleaners, events) is purple. The houses are open {slots}. It's a <b>request</b>: the time is held for you (dashed amber) and the equipment team approves it; you get a notification. If nobody decides before it starts, it's dropped. A booking takes the whole house. You can book up to <b>{s.bookAheadDays} days</b> ahead.</> },
      { q: 'Why does my shoot say "Waiting for approval"?', words: 'request approve approval pending denied not approved', a: <>Every booking is checked by the equipment team (or an admin) so nobody overbooks. While you wait, the time is held for you and you can already add props and gear. Approved → it's on the official schedule. Not approved → you get the reason and the time frees up. Moving an approved shoot is a request too: you keep the old time until the new one is approved. Withdrawing a request is always free.</> },
      { q: 'Can I book longer than 2 hours?', words: 'two slots 4 hours long day limit extra collaborator', a: <>Each person on a booking gets up to <b>{s.slotMinutes / 60} hours</b>. For longer, add the people filming with you to the <b>same booking</b>: 4 hours = you + 1 collaborator, 6 hours = you + 2. They don't have to confirm; it shows on their schedule too. You can have <b>{s.slotsPerDay === 1 ? 'one' : s.slotsPerDay} house booking{s.slotsPerDay === 1 ? '' : 's'} a day</b> ({c1} and {c2} together, and being someone's collaborator counts). Need more? Ask the schedule team (some people, like Stromedy Studios, can book long times by themselves).</> },
      { q: 'Can I book both houses at once?', words: 'both houses cliff 1 cliff 2 together same time one hour', a: <>Yes, for one hour. Tap a free time, then the small link <b>Need both houses at once? (1 hour)</b> under the button, and pick the first or second hour. It takes that time in both houses, so the equipment team always approves it first. It counts as your one booking that day.</> },
      ...!MONTHLY_SLOTS_ON ? [] : [{ q: 'What are monthly slots?', words: 'guaranteed four 4 cliff', a: <>Everyone gets {s.monthlySlots} monthly slots at {c1}. Your Home screen shows how many you have left this month. Anything else you book is an extra slot, if it's free.</> }],
      { q: `Why are some ${prio} slots locked?`, words: 'priority locked lock sunday release', a: <>{prio} at {c1} are priority days for the priority group. Slots nobody claimed open to everyone on the Sunday before. The lock shows when it opens.</> },
      { q: 'The time I want is taken. Can I wait for it?', words: 'waitlist notify me opens taken full booked wait list bell cancel', a: <>Yes. Tap a day on the <b>Calendar</b> and tap the <b>bell</b> next to the taken time (or ask the chat for an exact time and tap "Tell me if 5 PM opens"). If it opens up, it's <b>held for you for {INVITE_HOLD_MINUTES} minutes</b> and you get a notification: confirm it in the Chat with one tap, or it goes to the next person on the list. The gold bell shows your place in line; tap it again to leave the list. No bell? That time has started, you already film that day, or it needs a guideline. You can wait for up to 5 times at once.</> },
      { q: 'How do I find a free time quickly?', words: 'find a time search earliest', a: <>Type it in the <b>Chat</b>, or on <b>Calendar</b> tap <b>Or ask AI to find a time</b>, and just say what you need ("4 hours next week, evenings"). The soonest free times show first.</> },
      { q: "Can I add it to my phone's calendar?", words: 'calendar ical google apple', a: <>Yes: at the bottom of <b>Calendar</b>, tap "My shoots in my phone's calendar". Your shoots then show up in your calendar app and stay up to date.</> },
    ] },
    { title: 'Filming with friends', icon: 'people', items: [
      { q: 'How do I book back to back with friends?', words: 'collab together partner invite', a: <>On <b>Calendar</b>, tap a day, then a gold time, and pick how long: one slot per person (6 hours for three of you). Then tap each slot and pick who films in it (search a name, or type a name for someone not on the app). You can move yourself to any slot. Or say it in the <b>Chat</b> ("with Alex and Kyle this week"). All the slots go in together as one request: they <b>don't need to confirm</b>, so only book friends who will really be there. Friend not on the app yet? Type their name and tap <b>Add</b>; their slot is booked under their name. You can cancel the slots you booked for them.</> },
      { q: 'Why does it suggest someone to film with?', words: 'usual partner usually films with suggest friend chip', a: <>If you've filmed back to back with someone at least twice in the last 3 months, they show as <b>Usually films with</b> when you add a friend to a booking, and the chat may offer <b>With their name?</b> after a time search. It's only a shortcut: tap it to add them, or ignore it. Nobody is ever added for you.</> },
      { q: "How do I invite people into my video?", words: 'invite friend collaborator cast appear in video be in my video who is in', go: ['/videos', "Videos you're in"], a: <>Open your shoot and tap <b>Invite</b> under <b>Who's in this video?</b>, then pick the people who'll be on camera. They get a notification to say <b>I'm in</b> or <b>Can't make it</b>; you see who said yes. Once they're in, your shoot shows in their app (<b>In your video</b>, at your start time) with a reminder the night before and an hour before, so they know to come early for yours even if they film later that day. Booking back to back with friends? The tick <b>In each other's videos</b> (on by default) does it for you.</> },
      { q: "Someone invited me into their video. Where do I see it?", words: 'invited appear video reminder when do I need to be there', go: ['/videos', "Videos you're in"], a: <>Say yes on the card in the <b>Chat</b> (or on <b>Browse</b> if you're on Props only), or in <b>{ME} → Videos you're in</b>. After that it shows in your Coming up list, on your calendar (a blue edge on that day) and in your phone calendar link, with reminders the night before and an hour before. If you also film that day, your own shoot shows a blue line like <b>In Ariel's video at 1 PM first</b> (amber if the times clash), and an invite tells you what else you have that day before you answer. You can also just ask the chat: <b>am I in any videos?</b> Being in someone's video doesn't mean strikes for you; it's just so you know where to be. Can't go any more? Tap <b>Can't go</b> next to it.</> },
      { q: 'A friend booked me a slot. What do I do?', words: 'invite confirm friend booked me', a: <>Nothing: it's already yours (you get a notification and it shows in your shoots). Can't make it? Open the shoot and cancel it yourself (the friend who booked it can't cancel it for you).</> },
      { q: 'A slot says "Held for…". Can I book it?', words: 'held amber dashed', a: <>Not yet: it's held for someone on the waitlist for up to {INVITE_HOLD_MINUTES} minutes. If they don't confirm, it opens to everyone at the time shown. Check back then.</> },
    ] },
    { title: 'Props, costumes and gear', icon: 'mask', items: [
      { q: 'How do I get props for my shoot?', words: 'reserve request borrow add', go: ['/browse', 'Props'], a: <>Book your time first. Then go to <b>Props</b>, pick your shoot at the top ("Adding to…"), and tap <b>+</b> on anything you want (or open it to pick how many). Tap <b>Review your shoot</b>, give it a name and send it. The arts department gets it straight away.</> },
      { q: 'Where do I see just my shoots?', words: 'my shoots list upcoming when am i filming next coming up prep', go: ['/shoots', 'My shoots'], a: <>Your next 3 shoots are at the top of the <b>Chat</b>. For all of them: <b>More → My shoots</b> (or "All my shoots" on the Calendar). Your shoots are listed soonest first (Today, This week, Later), each with what it still needs: props show a gold ✓ with where they are, or a <b>+</b> with the last day to add them. On the day, <b>Check in</b> is right there. Past shoots are on the second tab.</> },
      { q: 'Where do I see what I asked for?', words: 'track status requests my gear my props where packed', go: ['/requests', 'My requests'], a: <>Tap <b>More → My requests</b>, or the My requests button next to ✦ AI on the Calendar and Props tabs. Each shoot is one card with its props underneath (and any gear you took on the day), with a bar showing where each one is (requested, being picked, packed, picked up, returned). Tap one to change it or see the details, or tap <b>+ Add props</b> before the cutoff.</> },
      { q: 'How far ahead do I need to ask?', words: 'notice cutoff deadline late too', a: <>Props we have: <b>{b.leadTimeHours} hours</b> before your shoot starts (clock hours, Sundays count). Custom props to make or find: at least <b>{b.buildLeadDays}</b> open days{b.closedWeekdays.includes(0) ? ' (Sundays don\'t count)' : ''}, with no guaranteed date. {s.gearReserve ? <>Gear is grab-and-go: reserve it from <b>{s.gearReserveHours} hours</b> before your shoot, or take what's free on the day.</> : <>Gear isn't booked ahead: take what's free on your shoot day.</>} Your shoot page and the bar on Props show the exact cutoff.</> },
      { q: 'How do I get gear?', words: 'gear camera kit take reserve grab go pick up', a: <>Gear is first come, first served. On your shoot day (from an hour before), tap <b>Take gear</b> above the typing box in the Chat, tap + on what you're taking, then <b>Take it</b>: tick every piece (tap Missing? if something isn't there) and take one photo. It's yours until the shoot ends; bring it back with a return photo. Same on <b>Sundays</b>: nobody's at the gear room, so you don't need anyone's OK, just do the pieces and the photos. {s.gearReserve ? <>Want to be sure you get a kit? Reserve it from <b>{s.gearReserveHours} hours</b> before your shoot.</> : <>Gear can't be booked ahead.</>}</> },
      { q: 'When is gear due back?', words: 'due back late return time end of day offsite', a: <>At the houses, <b>when your shoot ends</b> (the next person may need it). Offsite shoots: by <b>{s.gearOffsiteBackBy >= 1440 ? 'the end of the day' : fmtTime(s.gearOffsiteBackBy)}</b>. It counts as late 30 minutes after that. Some kits stay at the houses and can't go offsite.</> },
      { q: 'Do I need to check in on the day?', words: 'check in selfie arrive photo wrap', a: <>No. Just turn up at your time and film. The schedule team can mark a no-show if a booked shoot doesn't happen, which counts as a strike. Can't make it? Cancel or swap it so someone else can use the time.</> },
      { q: 'The people before me ran over or left a mess', words: 'report mess late previous', a: <>Tell the equipment team (Maanik) right away, ideally with a photo. They can give a strike if it keeps happening.</> },
      { q: 'Something broke or is missing. What do I do?', words: 'broken damaged missing lost report problem crack', a: <>Tell the chat, like "the tripod is broken" or "a battery is missing". Pick the piece and say what happened; the team gets it right away. When you return things, the chat asks again ("anything broken or missing?"), and at a props pickup you can tap anything that isn't there before you sign. Reporting it protects you.</> },
      { q: 'Do I need a guideline to book?', words: 'guideline pdf thursday saturday priority cliff 1', a: <>Only for <b>Cliff 1 on Thursdays and Saturdays</b> if you're not in the priority group: attach your filming guideline (PDF) when you ask for the slot. Everything else doesn't need one.</> },
      { q: "What if we don't have what I need?", words: 'build make find custom missing', a: <>In <b>Your shoot</b>, tap "Request something we don't have" and describe it (a reference photo helps). The arts department will try to make or find it. It needs at least {b.buildLeadDays} open days' notice and there's <b>no guaranteed date</b>: after you send it, message the arts department on Slack to sort out the details and when it can be ready.</> },
      { q: 'Can I change a request after sending it?', words: 'edit change remove add more', a: <>Yes, until the arts department starts picking: open the request and tap <b>Change</b> to change how many, take things out or add something to make or find. After that, tap <b>+ Add more</b> to add to the same shoot.</> },
      { q: 'How do pickup and returns work?', words: 'pickup return photo late', a: <>Props: when they're packed, sign for them on your phone at pickup, and bring them back with a quick photo. Gear: on your shoot day (from an hour before) you take what's free: tick every piece, one photo. At the end, bring it back with a photo of everything in the case with batteries charging. Gear is late {GEAR_LATE_MINUTES} minutes after it's due; late props or gear have to come back before you take more.</> },
      { q: 'Is there a fee for returning gear late?', words: 'late fee penalty charge cost money value 10 percent fine', a: <>Yes, it's a company rule: gear returned late carries a fee of <b>{LATE_FEE_PERCENT}% of its value</b>. You see what a kit is worth on its page, when you send your request and on your gear booking. Gear is late {GEAR_LATE_MINUTES} minutes after your end time, and the fee goes on whoever had it last. Every late return is recorded. Running late? Tell the equipment team right away.</> },
      { q: 'Can I search with a photo?', words: 'photo picture camera screenshot image snap reference look like', go: ['/browse', 'Props'], a: <>Yes. In <b>Props</b>, tap the <b>camera</b> in the search box. Take a photo, or pick one from your photos (a screenshot or a reference picture works too). The AI says what it sees, and the props that look most like it show at the top under <b>Looks like your photo</b>. Tap <b>Clear</b> to go back. Nothing found? Type what you're looking for instead.</> },
      { q: 'How do I find props like this one?', words: 'similar like this booked together recommendations also goes with', a: <>Open a prop and scroll down: <b>Booked together with this</b> shows what other creators asked for with it (no names), and <b>Similar props</b> shows props that are alike or go with it. Each one says Free or Booked for the shoot you're adding to. Tap one to open it.</> },
      { q: "The prop I want is booked for my shoot", words: 'booked taken not available unavailable sold out want more copies', a: <>It says <b>Not available on this day</b> when every one we have is already booked. Scroll down to <b>Similar props</b> for something that could work instead. The app also quietly lets the arts department know you wanted it, so they can see what to buy more of. Nothing for you to do.</> },
      { q: 'Can the AI suggest props for my idea?', words: 'ai idea ideas suggest video chatgpt claude', a: <>Yes: tap <b>✦ AI</b> to open ChatGPT or Claude with Prime Capitol added and describe the video. It reads the whole closet, shows photos, offers stand-ins and sends the request for your shoot when you say so. Things we don't have become custom requests (it can even make a picture of what you want).</> },
    ] },
    { title: 'On the day', icon: 'clapper', items: [
    ] },
    { title: 'Moving, swapping, cancelling', icon: 'swap', items: [
      { q: 'Can I move or cancel my shoot?', words: 'move cancel change time', a: <>Yes, free with at least <b>{s.noticeHours} hours'</b> notice: open the shoot and tap Move or Cancel. Changed your mind right after booking? Cancelling within {UNDO_MINUTES} minutes is always free. Cancelling a shoot also cancels its props requests.</> },
      { q: `It's less than ${s.noticeHours} hours before. What now?`, words: 'late cancel swap no show', a: <>If another creator agrees to trade times with you (talk to them first), send the <b>swap</b>: they accept and both shoots switch, no penalty. Cancelling or moving now counts as a no-show, unless you booked it less than 24 hours before it starts: then cancelling is free. If the schedule team moved your shoot (for example for a priority booking), you can still move it, and cancelling it is free.</> },
    ] },
    { title: 'Strikes', icon: 'stop', items: [
      { q: 'What gets me a strike?', words: 'strike penalty pause blocked', a: <>Not showing up, cancelling inside {s.noticeHours} hours, a report the team upholds, or a strike an admin gives you (always with the reason, which you can see). <b>{s.strikeCount} strikes in {s.strikeDays} days</b> pauses your prop requests for {s.pauseDays} days (you can still book house time and take gear). Your strikes are in More (Me for the owner).</> },
    ] },
    { title: 'Still stuck?', icon: 'chat', items: [
      { q: 'Can I ask the AI about the analytics?', words: 'ai ask analytics question stats who filmed most', a: <>Yes (owner and admins). Tap the violet <b>✦ Ask</b> at the top of Analytics, or <b>Ask AI about your creators</b> on the dashboard, and type a question like "Who filmed the most this month?" or "Who keeps returning things late?". It answers from the same numbers as Analytics (the last 6 months) and offers <b>See the details</b> to open the right page. It only reads; it can't change anything.</> },
      { q: 'Is there a bigger view for my computer?', words: 'laptop desktop computer wide sidebar keyboard shortcuts', a: <>Yes, for the owner, the equipment team and admins. On a laptop-size screen the app shows a sidebar instead of the tab bar; Requests becomes a week board of both houses with the waiting list on the right (keys: A approve, D deny, J/K next, W/M week or month, arrows change week), and Analytics opens a creator's report card beside the list. "Use the phone layout" at the bottom of the sidebar turns it off; My account → Laptop layout turns it back on (Me for the owner, the Admin or Dashboard menu for the team).</> },
      { q: 'Who do I ask?', words: 'contact help team support', a: <>Bookings and the schedule: the schedule team (Maanik). Props and costumes: the arts department. Gear: the equipment team. Strikes, pauses or a new person to invite: an admin. Something broken in the app: tell the owner, with a screenshot if you can.</> },
    ] },
  ]

  // Props only (demo): only what they can use today (search, prop pages, ✦ AI ideas). Booking answers and links
  // would bounce them back to Props (audit, Nov 7).
  const pick = (...qs: string[]) => all.flatMap(t => t.items).filter(i => qs.some(x => i.q.startsWith(x))).map(i => ({ ...i, go: undefined }))
  const topics: Topic[] = !demo ? all : [
    { title: 'Getting started', icon: 'hand', items: [
      { q: 'What can I do right now?', words: 'props only sneak peek book booking later what can i do', a: <>Search the whole closet on <b>Props</b>, open any prop to see its photos and details, tap <b>Something wrong? Suggest an edit</b> if a prop looks wrong, and ask <b>✦ AI</b> which props fit a video idea. Booking filming time and asking for props open later: the owner will switch you on.</> },
      ...pick('How do I put the app', 'Something broke', 'I signed in with the wrong', "I can't sign in"),
    ] },
    { title: 'Props and costumes', icon: 'mask', items: pick('How do I find props like this one', 'Can the AI suggest props') },
    { title: 'Still stuck?', icon: 'chat', items: pick('Who do I ask') },
  ]

  const q = query.trim().toLowerCase()
  const shown = useMemo(() => topics.map(t => ({ ...t, items: t.items.filter(i => !q || `${i.q} ${i.words ?? ''} ${t.title}`.toLowerCase().includes(q)) })).filter(t => t.items.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, s, b, demo])

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <PageHeader title="Help" action={<span className="text-pt-muted text-xs">Version {APP_VERSION}</span>}>
        <label htmlFor="helpSearch" className="sr-only">Search help</label>
        <input id="helpSearch" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search: cancel, props, gear…"
          className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text text-base focus:outline-none focus:border-pt-accent" />
      </PageHeader>
      <div className="px-4 pt-4 pb-8 space-y-6">
        <ReportProblemRow />
        {shown.length === 0 && <p className="text-pt-muted text-sm text-center py-6">Nothing found. Try another word, or see "Still stuck?" below.</p>}
        {shown.map(t => (
          <section key={t.title} className="space-y-2">
            <h2 className="text-pt-text text-lg font-semibold"><IconText name={t.icon} className="gap-2">{t.title}</IconText></h2>
            <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
              {t.items.map(i => {
                const isOpen = open === i.q || !!q
                return (
                  <div key={i.q}>
                    <button onClick={() => setOpen(open === i.q ? null : i.q)} className="w-full flex items-center justify-between gap-3 px-4 py-4 text-left">
                      <span className="text-pt-text text-[15px] font-medium">{i.q}</span>
                      <span className={`text-pt-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 -mt-1 space-y-3">
                        <p className="text-[#D8D8DC] text-[15px] leading-relaxed">{i.a}</p>
                        {i.go && <button onClick={() => navigate(i.go![0])} className="text-pt-accent text-sm font-semibold tap">{i.go[1]} ›</button>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
        {!demo && <button onClick={() => navigate('/schedule/how')} className="w-full bg-pt-surface rounded-2xl py-4 text-pt-text font-medium">All the house rules ›</button>}
      </div>
    </div>
  )
}
