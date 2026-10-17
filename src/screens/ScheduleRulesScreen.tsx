import { useNavigate } from 'react-router-dom'
import { fmtTime, GEAR_LEAD_TIME_DAYS } from '../../functions/src/gearBooking'
import { useBookingSettings } from '../hooks/useBookings'
import { useScheduleSettings, fmtSlot, BOOK_AHEAD_DAYS } from '../services/schedule'

const WEEKDAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

// The house rules, in plain words. Every number comes from the live settings.
export default function ScheduleRulesScreen() {
  const navigate = useNavigate()
  const s = useScheduleSettings()
  const b = useBookingSettings()
  const c1 = s.houses.cliff1.name, c2 = s.houses.cliff2.name
  const prioDays = list(s.priorityWeekdays.map(d => WEEKDAY_NAMES[d]))
  const H = ({ children }: { children: React.ReactNode }) => <h2 className="text-pt-text font-semibold text-lg pt-4">{children}</h2>
  const Li = ({ children }: { children: React.ReactNode }) => <li className="text-[15px] text-[#D8D8DC] leading-relaxed">{children}</li>
  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg/90 backdrop-blur-xl pt-safe z-10 px-4 py-2 border-b border-pt-border flex items-end gap-2">
        <button onClick={() => navigate('/schedule')} className="text-pt-accent text-[17px] pb-1">‹</button>
        <h1 className="font-display text-3xl text-pt-text">How it works</h1>
      </div>
      <div className="px-4 max-w-prose">
        <p className="text-pt-muted text-sm pt-3">The house rules for filming at {c1} ({s.houses.cliff1.address}) and {c2} ({s.houses.cliff2.address}).</p>

        <H>Booking a house</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li>Houses are booked in <b>{s.slotMinutes / 60}-hour slots</b>: {s.slots.map(t => fmtSlot(t, s.slotMinutes)).join(', ')}.</Li>
          <Li>A booking takes the <b>whole house</b>. Nobody else films there during your slot.</Li>
          <Li>Bookings are <b>confirmed instantly</b> when the slot is free and these rules allow it, up to {BOOK_AHEAD_DAYS} days ahead.</Li>
          <Li>Filming with someone? Book back-to-back slots. "Find a time" looks for 4 or 6 free hours in a row.</Li>
        </ul>

        <H>Your {s.monthlySlots} monthly slots ({c1})</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li>Every creator is guaranteed <b>{s.monthlySlots} {c1} slots a month</b>. Choose "Monthly slot" when you book.</Li>
          <Li>Anything beyond that is an <b>extra slot</b>, booked the same way whenever it's free.</Li>
        </ul>

        {s.priorityWeekdays.length > 0 && <>
          <H>{prioDays}</H>
          <ul className="list-disc pl-5 space-y-1.5">
            <Li>At {c1} these are <b>priority days</b> for {s.priority.length ? list(s.priority.map(p => p.name)) : 'the priority group'}.</Li>
            <Li>Every <b>Sunday at {fmtTime(s.releaseMinute)}</b>, unclaimed {prioDays.toLowerCase()} slots for the coming week open to everyone.</Li>
          </ul>
        </>}

        <H>Sundays</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li>Open to everyone, first come, first served.</Li>
          <Li>The crew is off, so you run the shoot yourself.</Li>
        </ul>

        <H>{c2} and offsite shoots</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li>{c2} is first come, first served. External rentals come first.</Li>
          <Li>Shooting somewhere else? Tap <b>Book a shoot</b> → <b>Somewhere else</b>: pick any start and end time and say where (an address or a Maps link). It goes on the schedule so props, gear and the team know, and it counts toward production.</Li>
        </ul>

        <H>Props and gear for your shoot</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li><b>Book your time first.</b> Then add props, costumes and gear to that shoot from Browse (or from the shoot itself). Browsing is open any time.</Li>
          <Li>Each team needs notice, counted in open days before the shoot{b.closedWeekdays.includes(0) ? ' (Sundays don\'t count)' : ''}: props we have <b>{b.leadTimeDays}</b>, new props to make or find <b>{b.buildLeadDays}</b>, gear <b>{GEAR_LEAD_TIME_DAYS}</b>.</Li>
          <Li>Cancelling a shoot cancels its props and gear requests too. A shoot with props or gear can move to another time the same day; to change the day, cancel those first.</Li>
        </ul>

        <H>On the day</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li>Check-in opens <b>{s.checkinBefore} minutes before</b> your shoot: open your shoot, take a photo of the set, tap <b>Check in</b>.</Li>
          <Li>When you're done, tap <b>Wrap</b> and name what you filmed.</Li>
          <Li>Finish on time and leave the house clean. When the next creator checks in, they can report an overrun or a mess (with photos). The team reviews every report.</Li>
          <Li>No check-in by the end of your slot? You have <b>{s.explainHours} hours</b> to explain on your shoot; then the team decides.</Li>
        </ul>

        <H>Strikes</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li>A strike is added for a <b>no-show</b>, a <b>cancel inside {s.noticeHours} hours</b>, or a <b>report the team upholds</b>.</Li>
          <Li><b>{s.strikeCount} strikes within {s.strikeDays} days</b> pause your prop and gear bookings for <b>{s.pauseDays} days</b>. You can still book house slots. The team can lift a pause.</Li>
        </ul>

        <H>Moving, swapping and cancelling</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li>More than <b>{s.noticeHours} hours</b> before your shoot, you can <b>move</b> it to any free slot or <b>cancel</b> it for free. A move happens in one step: you keep your slot until the new one is yours.</Li>
          <Li>Closer than {s.noticeHours} hours, you can only <b>swap</b> with another creator. Cancelling then <b>counts as a no-show</b>.</Li>
          <Li>To swap, open your shoot → <b>Swap with someone</b>, or tap someone's slot → <b>Ask to swap</b>. When they accept, both shoots switch instantly. A swap never counts against anyone.</Li>
          <Li>Booked something by mistake? You can cancel it for free within 10 minutes of booking.</Li>
          <Li>If the team moves or cancels your shoot (for example, for a repair), it never counts against you.</Li>
        </ul>
      </div>
    </div>
  )
}
