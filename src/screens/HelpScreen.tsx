// Help for creators: short answers to "how do I…?", searchable. Numbers come from the live settings,
// so the answers stay right when the team changes the rules.
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBookingSettings } from '../hooks/useBookings'
import { useScheduleSettings, fmtSlot, INVITE_HOLD_MINUTES, UNDO_MINUTES, MONTHLY_SLOTS_ON } from '../services/schedule'
import { GEAR_LEAD_TIME_DAYS, GEAR_LATE_MINUTES, PICKUP_OPENS_MINUTES } from '../../functions/src/gearBooking'
import { IconText, type IconName } from '../components/Icon'

interface Q { q: string; a: ReactNode; words?: string; go?: [string, string] }
interface Topic { title: string; icon: IconName; items: Q[] }

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

export default function HelpScreen() {
  const navigate = useNavigate()
  const s = useScheduleSettings()
  const b = useBookingSettings()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const c1 = s.houses.cliff1.name, c2 = s.houses.cliff2.name
  const prio = s.priorityWeekdays.map(d => WEEKDAYS[d]).join(' and ')
  const slots = s.slots.length ? `${fmtSlot(s.slots[0], s.slotMinutes).split('–')[0]} to ${fmtSlot(s.slots[s.slots.length - 1], s.slotMinutes).split('–')[1]}` : ''

  const topics: Topic[] = [
    { title: 'Getting started', icon: 'hand', items: [
      { q: 'How do I put the app on my home screen?', words: 'install icon iphone android', a: <>On iPhone, open the app in <b>Safari</b>, tap the <b>Share</b> button (square with an arrow), then <b>Add to Home Screen</b>. On Android, open it in Chrome and tap <b>⋮ → Add to Home screen</b>. It then opens like a normal app.</> },
      { q: "I can't sign in / nothing happens when I tap Sign in with Google", words: 'login google blank error', a: <>Open the link in <b>Safari or Chrome</b>, not inside Instagram, Messenger or Gmail (Google blocks sign-in there). Turn off ad blockers or Private Browsing for this page. On the sign-in screen, "Trouble signing in? Sign in another way" also helps. Still stuck? Ask the team to check you've been invited with the right email.</> },
      { q: 'Can I practise first?', words: 'tour tutorial practice demo learn walkthrough', go: ['/tour', 'App tour'], a: <>Yes. <b>Me → App tour</b> walks you through booking a pretend shoot, adding real props and gear, sending it, picking it up, checking in and returning it. Nothing in the tour is real: nothing is booked or sent.</> },
      { q: 'How is the app laid out?', words: 'tabs home book browse me', a: <><b>Home</b>: your next shoot and what it still needs. <b>Book</b>: the house schedule. <b>Browse</b>: every prop, costume and piece of gear. <b>Me</b>: your profile, requests and these help pages.</> },
    ] },
    { title: 'Booking a shoot', icon: 'calendar', items: [
      { q: 'How do I book filming time?', words: 'reserve slot house', go: ['/schedule?book=1', 'Book a shoot'], a: <>Go to <b>Book</b> → <b>Book a shoot</b>, say who's filming (just you, or with 1 or 2 friends): the soonest free times show first, with a button for each house that's free then ({c1} or {c2}). Tap the one you want. Filming elsewhere? Tap "Shooting somewhere else?". Houses are booked in {s.slotMinutes / 60}-hour slots from {slots}. It's confirmed instantly. A booking takes the whole house.</> },
      { q: 'Can I book more than one slot a day?', words: 'two slots 4 hours long day limit extra', a: <>Each creator can book <b>{s.slotsPerDay === 1 ? 'one' : s.slotsPerDay} {s.slotMinutes / 60}-hour house slot{s.slotsPerDay === 1 ? '' : 's'} a day</b> ({c1} and {c2} together). Filming with friends? Each of you books your own slot, back to back. Need longer? Ask the schedule team; they can add it for you.</> },
      ...!MONTHLY_SLOTS_ON ? [] : [{ q: 'What are monthly slots?', words: 'guaranteed four 4 cliff', a: <>Everyone gets {s.monthlySlots} monthly slots at {c1}. Your Home screen shows how many you have left this month. Anything else you book is an extra slot, if it's free.</> }],
      { q: `Why are some ${prio} slots locked?`, words: 'priority locked lock sunday release', a: <>{prio} at {c1} are priority days for the priority group. Slots nobody claimed open to everyone on the Sunday before. The lock shows when it opens.</> },
      { q: 'How do I find a free time quickly?', words: 'find a time search earliest', a: <>On <b>Book</b>, tap <b>Find a time</b> for the next free slots, or <b>✦ Ask for a time</b> and just say what you need ("4 hours next week, evenings").</> },
      { q: "Can I add it to my phone's calendar?", words: 'calendar ical google apple', a: <>Yes: on <b>Book</b>, tap "Add my shoots to my phone's calendar". Your shoots then show up in your calendar app and stay up to date.</> },
    ] },
    { title: 'Filming with friends', icon: 'people', items: [
      { q: 'How do I book back to back with friends?', words: 'collab together partner invite', a: <>Tap <b>✦ Ask for a time</b> and say who you're filming with ("with Alex and Kyle this week"). Pick an option and tap Book: your slot is booked, and each friend gets the slot right after yours, held for them for <b>{INVITE_HOLD_MINUTES} minutes</b> to confirm.</> },
      { q: 'Someone invited me. What do I do?', words: 'invite confirm held', a: <>You'll see the invite on Home and on Book. Tap <b>Confirm my slot</b> within {INVITE_HOLD_MINUTES} minutes and it's yours. If you can't make it, tap "Can't make it" so the slot opens up.</> },
      { q: 'A slot says "Held for…". Can I book it?', words: 'held amber dashed', a: <>Not yet: it's held for someone's collab for up to {INVITE_HOLD_MINUTES} minutes. If they don't confirm, it opens to everyone at the time shown. Check back then.</> },
    ] },
    { title: 'Props, costumes and gear', icon: 'mask', items: [
      { q: 'How do I get props for my shoot?', words: 'reserve request borrow add', go: ['/browse', 'Browse'], a: <>Book your time first. Then go to <b>Browse</b>, pick your shoot at the top ("Adding to…"), and tap <b>+</b> on anything you want (or open it to pick how many). Tap <b>Review your shoot</b>, give it a name and send it. The arts department gets it straight away.</> },
      { q: 'Where do I see just my shoots?', words: 'my shoots list upcoming when am i filming next coming up prep', go: ['/shoots', 'My shoots'], a: <>Tap <b>All my shoots</b> on Home (next to "Coming up"), or on Book under "Your shoots", or <b>Me → My shoots</b>. Your shoots are listed soonest first (Today, This week, Later), each with what it still needs: props and gear show a gold ✓ with where they are, or a <b>+</b> with the last day to add them. On the day, <b>Check in</b> is right there. Past shoots are on the second tab.</> },
      { q: 'Where do I see what I asked for?', words: 'track status requests my gear my props where packed', go: ['/requests', 'My requests'], a: <>Tap the <b>My requests</b> button: on Home, and next to the ✦ AI button on Book and Browse. Each shoot is one card with its props and its gear underneath, and a bar showing where each one is (requested, being picked, packed, picked up, returned). Tap one to change it or see the details, or tap <b>+ Add props or gear</b> before the cutoff.</> },
      { q: 'How far ahead do I need to ask?', words: 'notice cutoff deadline late too', a: <>Counted in open days before your shoot{b.closedWeekdays.includes(0) ? ' (Sundays don\'t count)' : ''}: props we have <b>{b.leadTimeDays}</b>, new props to make or find <b>{b.buildLeadDays}</b>, gear <b>{GEAR_LEAD_TIME_DAYS}</b>. Your shoot page and the Browse bar show the "add by" date.</> },
      { q: "What if we don't have what I need?", words: 'build make find custom missing', a: <>In <b>Your shoot</b>, tap "Request something we don't have" and describe it (a reference photo helps). The arts department will make or find it; this needs {b.buildLeadDays} open days' notice.</> },
      { q: 'Can I change a request after sending it?', words: 'edit change remove add more', a: <>Yes, until the arts department starts picking: open the request and tap <b>Change</b> to change how many, take things out or add something to make or find. Gear can be changed until you pick it up. After that, tap <b>+ Add more</b> to add to the same shoot.</> },
      { q: 'How do pickup and returns work?', words: 'pickup return photo late', a: <>Props: when they're packed, sign for them on your phone at pickup, and bring them back with a quick photo. Gear: from {PICKUP_OPENS_MINUTES} minutes before your time, tick every piece in the case, sign, and at the end take a photo of everything back in the case with batteries charging. Gear is late {GEAR_LATE_MINUTES} minutes after your end time; late props or gear stop you booking more until they're back.</> },
      { q: 'What does ✦ Ideas do?', words: 'ai idea suggest video', a: <>Describe your video idea and the AI suggests props and gear from our inventory, grouped by scene, with why each one fits. Always check each suggestion before adding it. Search and browse are always there too.</> },
    ] },
    { title: 'On the day', icon: 'clapper', items: [
      { q: 'How do I check in?', words: 'check in photo set arrive', a: <>Check-in opens <b>{s.checkinBefore} minutes</b> before your slot. Open your shoot (Home → your next shoot) and take a photo of the set. That's it.</> },
      { q: 'The people before me ran over or left a mess', words: 'report mess late previous', a: <>When you check in, tap "Ran over into my time" and/or "House left a mess" (with a photo), and write a line about what happened. The schedule team reviews every report.</> },
      { q: 'I forgot to check in', words: 'missed forgot no show explain', a: <>Open the shoot and tell us what happened within <b>{s.explainHours} hours</b>. The schedule team then decides whether it counts as filmed.</> },
    ] },
    { title: 'Moving, swapping, cancelling', icon: 'swap', items: [
      { q: 'Can I move or cancel my shoot?', words: 'move cancel change time', a: <>Yes, free with at least <b>{s.noticeHours} hours'</b> notice: open the shoot and tap Move or Cancel. Changed your mind right after booking? Cancelling within {UNDO_MINUTES} minutes is always free. Cancelling a shoot also cancels its props and gear requests.</> },
      { q: `It's less than ${s.noticeHours} hours before. What now?`, words: 'late cancel swap no show', a: <>You can still <b>swap</b> with another creator (they accept, and both shoots switch). Cancelling or moving now counts as a no-show.</> },
    ] },
    { title: 'Strikes', icon: 'stop', items: [
      { q: 'What gets me a strike?', words: 'strike penalty pause blocked', a: <>Not showing up, cancelling inside {s.noticeHours} hours, a report the team upholds, or a strike an admin gives you (always with the reason, which you can see). <b>{s.strikeCount} strikes in {s.strikeDays} days</b> pauses your prop and gear requests for {s.pauseDays} days (you can still book house time). Your strikes are on the Me tab.</> },
    ] },
    { title: 'Still stuck?', icon: 'chat', items: [
      { q: 'Who do I ask?', words: 'contact help team support', a: <>Bookings and the schedule: the schedule team (Maanik). Props and costumes: the arts department. Gear: the equipment team. Strikes, pauses or a new person to invite: an admin. Something broken in the app: tell the owner, with a screenshot if you can.</> },
    ] },
  ]

  const q = query.trim().toLowerCase()
  const shown = useMemo(() => topics.map(t => ({ ...t, items: t.items.filter(i => !q || `${i.q} ${i.words ?? ''} ${t.title}`.toLowerCase().includes(q)) })).filter(t => t.items.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, s, b])

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <div className="flex items-end gap-2 py-2">
          <button onClick={() => navigate(-1)} className="tap w-8 -ml-2 text-pt-accent text-[34px] font-light leading-none pb-1" aria-label="Back">‹</button>
          <h1 className="font-display text-[34px] text-pt-text">Help</h1>
        </div>
        <label htmlFor="helpSearch" className="sr-only">Search help</label>
        <input id="helpSearch" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search: cancel, props, check in…"
          className="w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text text-base focus:outline-none focus:border-pt-accent" />
      </div>
      <div className="px-4 pt-4 pb-8 space-y-6">
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
        <button onClick={() => navigate('/schedule/how')} className="w-full bg-pt-surface rounded-2xl py-4 text-pt-text font-medium">All the house rules ›</button>
      </div>
    </div>
  )
}
