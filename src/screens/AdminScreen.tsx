import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'

export default function AdminScreen() {
  const navigate = useNavigate()
  const { isOwner, isAdmin, shootFlow, role } = useSession()

  // Equipment team (owner, Oct 20): the same kind of menu the arts department has, for gear and the schedule.
  const gearEntries = [
    { to: '/gear/bookings', title: 'Gear queue', detail: "Today's pickups and returns, what's out, what to check in" },
    { to: '/gear/bundles', title: 'Bundles & add-on extras', detail: 'What creators can book; build a new kit' },
    { to: '/gear/items', title: 'All gear', detail: 'Every piece you own: add gear, serial numbers, values, archive' },
    { to: '/schedule/team', title: 'Schedule team', detail: 'Check-ins, reports to review, creators booked vs filmed, pauses' },
    { to: '/tour/gear', title: 'Gear team tour', detail: 'Practise the gear room again, step by step' },
    { to: '/help', title: 'Help', detail: 'How do I…? Gear, check-ins, the schedule, sign-in' },
    { to: '/account', title: 'My account', detail: 'Your photo, notifications; sign out' },
  ]
  // Admin (owner, Oct 20): a viewer. Looks at everything, invites creators, sets the booking rules, books their own shoots.
  const adminEntries = [
    { to: '/creators', title: 'Creators', detail: 'How much each creator films, every flag, and strikes and pauses' },
    { to: '/reservations', title: 'Props queue', detail: 'Every props request and where it is (view only)' },
    { to: '/gear/bookings', title: 'Gear queue', detail: "Everyone's gear: pickups, what's out, returns (view only)" },
    { to: '/calendar', title: 'Requests calendar', detail: 'Every props request by shoot day' },
    { to: '/schedule/team', title: 'Schedule team', detail: 'Missed check-ins and reports to decide, creators booked vs filmed' },
    { to: '/activity', title: 'Activity', detail: 'Everything that happened: bookings and prop changes, with who and when' },
    { to: '/users', title: 'Invite creators', detail: 'Add creators or turn their access off' },
    { to: '/booking-rules', title: 'Booking rules', detail: 'How far ahead props must be booked; closed days; turnaround days' },
    { to: '/gear', title: 'Book gear', detail: 'Hold camera, light and sound bundles for a shoot, by the hour' },
    { to: '/help', title: 'Help', detail: 'How do I…? Booking, props, gear, check-in, sign-in' },
    { to: '/account', title: 'My account', detail: 'Your photo and channel name; sign out' },
  ]
  const entries = role === 'equipment' ? gearEntries : isAdmin ? adminEntries : [
    // The owner uses the creator tabs, so the staff tabs (Queue, Add) live here.
    ...(isOwner ? [
      { to: '/reservations', title: 'Props queue', detail: 'Every props request: to prepare, ready, out, returns' },
      { to: '/add', title: 'Add a prop', detail: 'Photo → AI fills the details → you check and save' },
      { to: '/creators', title: 'Creators', detail: 'How much each creator films, and every flag on their record' },
      { to: '/schedule/team', title: 'Schedule team', detail: 'Check-ins, reports to review, creators booked vs filmed' },
      { to: '/schedule/settings', title: 'Schedule settings', detail: 'Houses, slots, priority days, strikes, Google Calendar' },
    ] : []),
    { to: '/suggestions', title: 'Suggested edits',  detail: "Creators' corrections to props: apply in one tap or dismiss" },
    ...(isOwner ? [{ to: '/import', title: 'Import props', detail: 'Bring the photo library in from Google Drive; review AI suggestions' }] : []),
    { to: '/duplicates', title: 'Find duplicates',   detail: 'After an import: look-alike props side by side, merge or mark as different' },
    { to: '/activity',   title: 'Activity',          detail: 'Everything that happened: bookings and prop changes, with who and when' },
    { to: '/health',     title: 'Health',            detail: isOwner ? 'Fix-it list, duplicates, inventory counts, AI usage, export' : 'Fix-it list, duplicates, inventory counts, export' },
    ...(isOwner ? [{ to: '/users', title: 'People & access', detail: 'Invite people, change roles, turn access off' }] : []),
    ...(isOwner ? [{ to: '/categories', title: 'Categories', detail: 'Add, rename, reorder or hide categories' }] : []),
    ...(isOwner ? [{ to: '/booking-rules', title: 'Booking rules', detail: 'How far ahead props must be booked; turnaround days' }] : []),
    ...(isOwner ? [{ to: '/email', title: 'Email', detail: 'Turn emails on, choose the sending service, send a test' }] : []),
    ...(isOwner ? [{ to: '/costs', title: 'Running costs', detail: 'What the app costs this month, storage, photo clean-up' }] : []),
    ...(isOwner ? [{ to: '/ai', title: 'AI helpers', detail: 'Monthly AI budget, daily limit per person, what it has cost' }] : []),
    { to: '/bins',       title: 'Bins & storage',    detail: 'Storage areas, bins and their QR codes' },
    ...(isOwner ? [{ to: '/gear', title: 'Book gear', detail: 'Hold camera, light and sound bundles for a shoot, by the hour' }] : []),
    ...(!isOwner ? [{ to: '/calendar', title: 'Requests calendar', detail: 'Every props request by shoot day' }] : []),
    ...(isOwner ? [
      { to: '/gear/bookings', title: 'Gear bookings', detail: "Everyone's gear bookings; decline if something's wrong" },
      { to: '/gear/bundles', title: 'Gear (equipment team)', detail: 'Every piece of gear, and the bundles and extras creators can book' },
      { to: '/tour/gear', title: 'Gear team tour', detail: 'The practice tour the equipment team does on their first open' },
    ] : []),
    { to: '/account',    title: isOwner ? 'My account & View as' : 'My account', detail: isOwner ? 'Your photo and channel name; preview the app as another role; sign out' : 'Your photo and channel name; sign out' },
  ]

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <h1 className="font-display text-[34px] text-pt-text py-2">{shootFlow ? 'Team' : 'Admin'}</h1>
      </div>
      <div className="p-4">
        <div className="bg-pt-surface shadow-hairline rounded-2xl divide-y divide-white/[0.06] overflow-hidden">
          {entries.map(e => (
            <button key={e.to} onClick={() => navigate(e.to)}
              className="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-pt-bg">
              <div className="flex-1 min-w-0">
                <p className="text-pt-text font-medium">{e.title}</p>
                <p className="text-pt-muted text-xs mt-0.5">{e.detail}</p>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-pt-muted shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
