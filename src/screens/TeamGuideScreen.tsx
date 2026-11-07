// The team's one-page guide (owner, Nov 2: "drop the long tours… staff get a one-page guide"). One short page per role,
// with the live numbers from the settings. New team members see it once (instead of a practice tour); it stays in the
// team menu ("Team guide"). When a team rule or screen changes, change it here too.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { useScheduleSettings } from '../services/schedule'
import { useBookingSettings } from '../hooks/useBookings'
import { GEAR_LATE_MINUTES } from '../../functions/src/gearBooking'
import { LATE_FEE_PERCENT } from '../../functions/src/gearStock'

type Who = 'equipment' | 'admin' | 'arts'
const NAMES: Record<Who, string> = { equipment: 'Equipment team', admin: 'Admins', arts: 'Arts department' }

export default function TeamGuideScreen({ onDone }: { onDone?: () => void }) {
  const navigate = useNavigate()
  const { realRole } = useSession()
  const s = useScheduleSettings()
  const b = useBookingSettings()
  const [who, setWho] = useState<Who>(realRole === 'admin' || realRole === 'arts' ? realRole : 'equipment')
  const kyle = s.instantBookers[0]?.name.split(' ')[0] || 'Kyle'
  const P = ({ n, t, children }: { n: number; t: string; children: React.ReactNode }) => (
    <section className="flex gap-3">
      <span className="w-8 h-8 rounded-full bg-pt-accent text-stone-900 font-bold grid place-items-center shrink-0">{n}</span>
      <div className="min-w-0 space-y-1"><h2 className="text-pt-text font-semibold text-[16px]">{t}</h2><div className="text-pt-muted text-[15px] leading-snug space-y-1">{children}</div></div>
    </section>
  )
  const B = ({ children }: { children: React.ReactNode }) => <b className="text-pt-text">{children}</b>

  const pages: Record<Who, React.ReactNode> = {
    equipment: <>
      <P n={1} t="Approve every booking"><p>Creators' bookings are <B>requests</B>. Open <B>Requests</B>: each card shows how much they film, strikes, and who's around. <B>Approve</B> or <B>Deny</B> with a reason. Waiting over 12 h → you get a reminder; still waiting at the start time → dropped.</p></P>
      <P n={2} t="Priority bookings"><p>{kyle}'s bookings are approved at once. If {kyle} needs a slot someone else has, tap <B>Priority booking…</B> (or tap the name in a day): move them to another free time that day, or cancel their shoot. They get a neutral "schedule change" notice and their next request is first in line. A red box lists calendar events that landed on a booked slot.</p></P>
      <P n={3} t="Gear is grab-and-go"><p>Creators take gear on their shoot day: they tick every piece and take one photo. {s.gearReserve ? <>They can also reserve a kit from <B>{s.gearReserveHours} h</B> before their shoot.</> : <>Gear isn't booked ahead: first come, first served.</>} Sundays too: nobody needs to be there, the photos are the record. You see it all in the <B>Queue</B>: Today, Out (late in red), To check in.</p></P>
      <P n={4} t="Check it back in"><p>Back = a return photo from the creator. Open it in <B>To check in</B>, tick every piece, write a note if something's damaged, <B>Checked in</B>. Late = {GEAR_LATE_MINUTES} min after the end; the late fee is {LATE_FEE_PERCENT}% of the value (the app only records it).</p></P>
      <P n={5} t="On the day"><p>Creators check in with a set photo and say if the house was clean and the slot before finished on time. <B>Admin → Schedule team</B>: missed check-ins (They filmed / No-show) and reports (Dismiss / Strike).</p></P>
      <P n={6} t="Block time + guaranteed slots"><p>Cleaners, events, maintenance: tap a free time on the <B>Schedule</B> day view → Block. Monthly Cliff 1 slots: put them in Google Calendar with the creator's name; the app brings them in every 15 minutes.</p></P>
      <P n={7} t="On a laptop"><p>Open the app on a computer: a week board of both houses. Keys: <B>A</B> approve, <B>D</B> deny, <B>J/K</B> next/previous.</p></P>
    </>,
    admin: <>
      <P n={1} t="Your home is the scoreboard"><p><B>Dashboard</B>: who's filming more or less this month and who needs attention. <B>Analytics</B> goes deeper (tap any number or flag).</p></P>
      <P n={2} t="Approve bookings too"><p>Like the equipment team, you can <B>Approve / Deny</B> requests on <B>Requests</B>, and make a <B>Priority booking</B> when {kyle} needs a slot.</p></P>
      <P n={3} t="Act on flags"><p>Every no-show, late return or mess is a flag. Open it: see the evidence, then <B>Send a note</B>, <B>Excuse it</B>, <B>Give a strike</B> or <B>Mark as handled</B>. {s.strikeCount} strikes in {s.strikeDays} days pause props for {s.pauseDays} days.</p></P>
      <P n={4} t="Creators' records"><p><B>Creators</B> → a person: their report card, strikes (Remove with a reason), <B>Pause bookings</B> or Lift.</p></P>
      <P n={5} t="Invite creators"><p><B>Invite creators</B>: they start on <B>Props only</B>; the owner switches them to the full app.</p></P>
      <P n={6} t="Booking rules"><p>Props notice: {b.leadTimeDays} open days (new props to make or find: {b.buildLeadDays}). Change it in <B>Booking rules</B>. Every rule is on the <B>Settings sheet</B>.</p></P>
    </>,
    arts: <>
      <P n={1} t="Start with Today"><p>The <B>Props queue</B> opens on <B>Today</B>: pickups due and props coming back. <B>To prepare</B> is everything still to pick.</p></P>
      <P n={2} t="Pick and pack"><p>Open a request: tick props as you pick them (grouped by room and bin). Can't find one? <B>Can't find it</B> with a reason, the rest still goes. Take the <B>pack photo</B>, then <B>Packed</B>. The creator signs at pickup.</p></P>
      <P n={3} t="Check returns in"><p><B>Returns</B>: the creator sends a photo. Check each prop: fine, <B>damaged</B> or <B>missing</B>. Built props can become new props here.</p></P>
      <P n={4} t="Clean up the imported props"><p><B>Admin → Clean up props</B> (the gold card) lists the jobs in order, with what's left: <B>Combine doubles</B> (two photos: same thing? one tap; exact copies all at once), <B>Put props in their bin</B>, <B>Quick approve</B> (30 at a time), then <B>Work bin by bin</B> (a whole bin on one screen, <B>Everything here looks right</B>). Remove never deletes: <B>Removed props</B> has Put back.</p></P>
      <P n={5} t="Fix props as you go"><p>Spotted a double or a wrong name while you're on a prop? Tap <B>⋯</B> at the top of its page: <B>Find duplicates</B> (the app shows what may be the same thing; tick, then combine), <B>Merge with another prop</B>, <B>Mark as checked</B>, or <B>Remove</B> (Put back is always there).</p></P>
      <P n={6} t="Keep the closet tidy"><p><B>Prop insights</B> (Admin → Every day) shows what's booked most, what runs out (buy another?), what creators ask for that we don't have, grab-and-go candidates, and who damages or loses props. <B>Requests calendar</B>, <B>Bins</B>, <B>Health</B> and <B>Suggested edits</B> keep the inventory right.</p></P>
    </>,
  }

  return (
    <div className="min-h-full bg-pt-bg pb-32">
      <div className="pt-safe px-4 pb-3">
        {!onDone && <button onClick={() => navigate(-1)} className="text-pt-accent text-[17px] min-h-[44px]">‹ Back</button>}
        <h1 className="font-display text-[30px] leading-tight text-pt-text">Team guide</h1>
        <p className="text-pt-muted text-sm">Everything you need, on one page. About 2 minutes.</p>
        {realRole === 'owner' && (
          <div className="flex gap-2 mt-3">{(Object.keys(NAMES) as Who[]).map(w => (
            <button key={w} onClick={() => setWho(w)} className={`px-3 min-h-[36px] rounded-full text-[13px] ${who === w ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-surface text-pt-muted'}`}>{NAMES[w]}</button>))}</div>
        )}
      </div>
      <div className="px-4 space-y-5">
        {pages[who]}
        <p className="text-pt-muted text-[13px]">Stuck? Tap <b className="text-pt-text">✦ AI</b> and ask "how do I…". Every rule is on the Settings sheet.</p>
      </div>
      {onDone && (
        <div className="fixed left-0 right-0 bottom-0 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] bg-pt-bg z-20">
          <button onClick={onDone} className="w-full rounded-2xl py-4 font-bold bg-pt-accent text-stone-900 shadow-gold">Got it</button>
        </div>
      )}
    </div>
  )
}
