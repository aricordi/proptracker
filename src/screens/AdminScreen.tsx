import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'

export default function AdminScreen() {
  const navigate = useNavigate()
  const { isOwner, isAdmin, shootFlow } = useSession()

  const entries = [
    // The owner uses the creator tabs, so the staff tabs (Queue, Add) live here.
    ...(shootFlow ? [
      { to: '/reservations', title: 'Props queue', detail: 'Every props request: to prepare, ready, out, returns' },
      { to: '/add', title: 'Add a prop', detail: 'Photo → AI fills the details → you check and save' },
      { to: '/schedule/team', title: 'Schedule team', detail: 'Check-ins, reports to review, creators booked vs filmed' },
    ] : []),
    { to: '/suggestions', title: 'Suggested edits',  detail: "Creators' corrections to props: apply in one tap or dismiss" },
    ...(!isAdmin ? [{ to: '/import', title: 'Import props', detail: 'Bring the photo library in from Google Drive; review AI suggestions' }] : []),
    { to: '/duplicates', title: 'Find duplicates',   detail: 'After an import: look-alike props side by side, merge or mark as different' },
    { to: '/activity',   title: 'Activity',          detail: 'Everything that happened: bookings and prop changes, with who and when' },
    { to: '/health',     title: 'Health',            detail: 'Fix-it list, duplicates, inventory counts, AI usage, export' },
    { to: '/users',      title: isOwner ? 'People & access' : 'Invite creators', detail: isOwner ? 'Invite people, change roles, turn access off' : 'Add creators or turn their access off' },
    { to: '/categories', title: 'Categories',        detail: 'Add, rename, reorder or hide categories' },
    { to: '/booking-rules', title: 'Booking rules',  detail: 'How far ahead props must be booked; turnaround days' },
    ...(isOwner ? [{ to: '/email', title: 'Email', detail: 'Turn emails on, choose the sending service, send a test' }] : []),
    ...(isOwner ? [{ to: '/costs', title: 'Running costs', detail: 'What the app costs this month, storage, photo clean-up' }] : []),
    ...(isOwner ? [{ to: '/ai', title: 'AI helpers', detail: 'Monthly AI budget, daily limit per person, what it has cost' }] : []),
    { to: '/bins',       title: 'Bins & storage',    detail: 'Storage areas, bins and their QR codes' },
    ...(isOwner || isAdmin ? [{ to: '/gear', title: 'Book gear', detail: 'Hold camera, light and sound bundles for a shoot, by the hour' }] : []),
    ...(isAdmin ? [{ to: '/add', title: 'Add a prop', detail: 'Photo → AI fills the details → you check and save' },
      { to: '/gear/bundles', title: 'Gear bundles & pieces', detail: 'Every piece of gear, and the bundles and extras creators can book' },
      { to: '/schedule/team', title: 'Schedule team', detail: 'Check-ins, reports to review, creators booked vs filmed' }] : []),
    ...(!isOwner ? [{ to: '/calendar', title: 'Requests calendar', detail: 'Every props request by shoot day' }] : []),
    ...(isOwner ? [
      { to: '/gear/bookings', title: 'Gear bookings', detail: "Everyone's gear bookings; decline if something's wrong" },
      { to: '/gear/bundles', title: 'Gear (equipment team)', detail: 'Every piece of gear, and the bundles and extras creators can book' },
    ] : []),
    { to: '/checkout',   title: 'Quick checkout (old)', detail: 'The original simple checkout, kept until everything moves to the Queue' },
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
