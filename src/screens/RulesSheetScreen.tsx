// Settings sheet (owner, Oct 20: "a sheet that tells them about the assumptions of what the settings are, so they can
// address changes that need to be made"). Every rule the app runs on, with its live value, what it means, and who can
// change it. Read only: admins change the booking rules on their own screen; everything else is the owner's.
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { useBookingSettings } from '../hooks/useBookings'
import { useCategories } from '../hooks/useCategories'
import { useScheduleSettings, INVITE_HOLD_MINUTES, UNDO_MINUTES } from '../services/schedule'
import { RETURN_DEADLINE_HOUR } from '../../functions/src/booking'
import { GEAR_LEAD_TIME_DAYS, GEAR_LATE_MINUTES, PICKUP_OPENS_MINUTES, fmtTime } from '../../functions/src/gearBooking'
import { OLD_PHOTO_MINUTES } from '../lib/photoTakenAt'
import { LATE_FEE_PERCENT } from '../../functions/src/gearStock'
import { LATE_START_MIN, KIND, THEMES } from '../lib/analytics'
import { LOW_SHOW_UP, OUTPUT, ATTENTION_MEANS } from '../lib/insights'
import { formatDay } from '../lib/dates'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const list = (xs: string[]) => xs.length ? xs.join(', ') : 'None'

export default function RulesSheetScreen() {
  const navigate = useNavigate()
  const { canManagePeople, isOwner } = useSession()
  const b = useBookingSettings()
  const s = useScheduleSettings()
  const cats = useCategories().filter(c => c.active && c.turnaroundDays !== undefined && c.turnaroundDays !== null)
  const you = canManagePeople ? 'You (admins) and the owner' : 'Admins and the owner'
  const owner = 'The owner'
  const sections: { title: string; edit?: { label: string; to: string }; rows: [string, string, string, string][] }[] = [
    { title: 'Props', edit: canManagePeople ? { label: 'Change booking rules', to: '/booking-rules' } : undefined, rows: [
      ['Props we have: notice', `${b.leadTimeDays} open days`, 'How far before the shoot a creator must ask for props from the closet.', you],
      ['New props (make or find): notice', `${b.buildLeadDays} open days`, 'How far ahead creators must ask for something the arts department has to make or buy.', you],
      ['Turnaround', `${b.bufferDays} open day${b.bufferDays === 1 ? '' : 's'}`, 'Days after a shoot before the same prop can go out again (checking, cleaning).', you],
      ...cats.map(c => [`Turnaround: ${c.label}`, `${c.turnaroundDays} open days`, 'Its own turnaround (e.g. washing costumes).', you] as [string, string, string, string]),
      ['Closed days', list(b.closedWeekdays.map(d => DAYS[d])), 'The prop room is closed: props are picked up the open day before; deadlines skip these days.', you],
      ['Holidays', list(b.closedDates.filter(d => d >= new Date().toISOString().slice(0, 10)).map(d => formatDay(d))), 'Extra closed dates coming up.', you],
      ['Props are late', `${RETURN_DEADLINE_HOUR} AM, next open day`, 'After this, the creator is flagged "late props" and can\'t book more props until they\'re back.', owner],
    ] },
    { title: 'Gear', rows: [
      ['Gear: notice', `${GEAR_LEAD_TIME_DAYS} open days`, 'How far before the shoot a creator must book gear.', owner],
      ['Pickup opens', `${PICKUP_OPENS_MINUTES} min before`, 'When the creator can do the pickup check (tick every piece).', owner],
      ['Gear is late', `${GEAR_LATE_MINUTES} min after the booked end`, 'After this the creator is flagged "late gear" and can\'t book more gear until it\'s back.', owner],
      ['Late return fee', `${LATE_FEE_PERCENT}% of the gear's value`, 'Company rule (Oct 27). Goes on whoever had the gear last. The app keeps the record (Analytics → Late returns: how late, the value, who); nobody is charged automatically, and admins can excuse one as an exception. Props late are logged with no fee for now.', owner],
    ] },
    { title: 'Schedule and houses', edit: isOwner ? { label: 'Schedule settings', to: '/schedule/settings' } : undefined, rows: [
      ['Slots', `${s.slots.length} a day, ${s.slotMinutes / 60} h each (${fmtTime(s.slots[0])} to ${fmtTime((s.slots[s.slots.length - 1] + s.slotMinutes) % 1440)})`, 'The fixed grid creators book at the houses.', owner],
      ['House slots a day', `${s.slotsPerDay} per creator`, 'How many house slots one creator can book on the same day (the team can book more for them).', owner],
      ['Moving or cancelling for free', `${s.noticeHours} h before`, 'Inside this, a creator cancel counts as a no-show (a strike); only a swap avoids it.', owner],
      ['Undo after booking', `${UNDO_MINUTES} min`, 'Cancelling within this many minutes of booking is always free.', owner],
      ['Friend invite hold', `${INVITE_HOLD_MINUTES} min`, 'How long a slot is held for an invited friend. If they let it run out, they get a "Didn\'t confirm" flag.', owner],
      ['Priority days', list(s.priorityWeekdays.map(d => DAYS[d])), `Only the priority group can book these; unclaimed slots open to everyone on Sunday at ${fmtTime(s.releaseMinute)}.`, owner],
      ['Priority group', `${s.priority.length} ${s.priority.length === 1 ? 'person' : 'people'}`, list(s.priority.map(p => p.name)), owner],
    ] },
    { title: 'Comparing creators (Dashboard and Analytics)', rows: [
      ['Minimum shoots', 'none', 'There is no minimum. Creators are compared with each other.', owner],
      ['Typical creator', 'the middle value', 'Half of the creators filmed more than this in the date range, half filmed less.', owner],
      ['Posting more', 'a quarter above typical', OUTPUT.more.means, owner],
      ['Posting less', 'a quarter below typical', OUTPUT.less.means, owner],
      ['Needs attention', 'behaviour, not output', ATTENTION_MEANS, owner],
      ['Low show-up', `under ${Math.round(LOW_SHOW_UP * 100)}%`, 'Filmed out of booked, once they have 2 or more shoots in the range.', owner],
    ] },
    { title: 'On the day, strikes and pauses', rows: [
      ['Check-in opens', `${s.checkinBefore} min before`, 'Creators check in with a set photo (camera only) from this time until the slot ends.', owner],
      ['Started late', `more than ${LATE_START_MIN} min`, 'Checking in this long after the slot began shows a "Started late" flag in Analytics.', owner],
      ['Time to explain a missed check-in', `${s.explainHours} h`, 'After that, the team decides: they filmed, or a no-show (strike).', owner],
      ['Automatic pause', `${s.strikeCount} strikes in ${s.strikeDays} days`, `Pauses prop and gear bookings for ${s.pauseDays} days (house time still OK). Admins can give, remove and lift.`, owner],
      ['Old photos', `taken more than ${OLD_PHOTO_MINUTES} min before upload`, 'Proof photos show a red warning, so people can\'t reuse old pictures.', owner],
    ] },
  ]
  return (
    <div className="min-h-full bg-pt-bg pb-12">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <button onClick={() => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/')} className="text-pt-accent text-[17px] py-1">‹ Back</button>
        <h1 className="font-display text-[34px] text-pt-text py-1">Settings sheet</h1>
        <p className="text-pt-muted text-sm">Every rule the app runs on right now. Something should change? Admins edit the booking rules; for anything else, tell the owner.</p>
      </div>
      <div className="px-4 space-y-6">
        {sections.map(sec => (
          <section key={sec.title} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-pt-text text-[20px] font-semibold tracking-tight">{sec.title}</h2>
              {sec.edit && <button onClick={() => navigate(sec.edit!.to)} className="text-pt-accent text-sm tap">{sec.edit.label} ›</button>}
            </div>
            <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
              {sec.rows.map(([name, value, means, who]) => (
                <div key={name} className="px-4 py-3 space-y-1">
                  <div className="flex items-baseline justify-between gap-3"><span className="text-pt-text text-[15px]">{name}</span><span className="text-pt-accent text-[15px] font-semibold text-right">{value}</span></div>
                  <p className="text-pt-muted text-sm">{means}</p>
                  <p className="text-pt-muted text-xs">Changed by: {who}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
        <section className="space-y-2">
          <h2 className="text-pt-text text-[20px] font-semibold tracking-tight">What each flag means</h2>
          <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
            {THEMES.map(t => (
              <div key={t.key} className="px-4 py-3 space-y-1">
                <p className="text-pt-text font-medium">{t.label}</p>
                {t.kinds.map(k => <p key={k} className="text-pt-muted text-sm"><span className="text-pt-text">{KIND[k].label}:</span> {KIND[k].means}</p>)}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
