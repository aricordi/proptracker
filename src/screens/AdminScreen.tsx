import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'

export default function AdminScreen() {
  const navigate = useNavigate()
  const { isOwner } = useSession()

  const entries = [
    { to: '/import',     title: 'Import props',      detail: 'Bring the photo library in from Google Drive; review AI suggestions' },
    { to: '/duplicates', title: 'Find duplicates',   detail: 'After an import: look-alike props side by side, merge or mark as different' },
    { to: '/activity',   title: 'Activity',          detail: 'Everything that happened: bookings and prop changes, with who and when' },
    { to: '/health',     title: 'Health',            detail: 'Fix-it list, duplicates, inventory counts, AI usage, export' },
    { to: '/users',      title: isOwner ? 'People & access' : 'Invite creators', detail: isOwner ? 'Invite people, change roles, turn access off' : 'Add creators or turn their access off' },
    { to: '/categories', title: 'Categories',        detail: 'Add, rename, reorder or hide categories' },
    { to: '/booking-rules', title: 'Booking rules',  detail: 'How far ahead props must be booked; turnaround days' },
    ...(isOwner ? [{ to: '/email', title: 'Email', detail: 'Turn emails on, choose the sending service, send a test' }] : []),
    { to: '/bins',       title: 'Bins & storage',    detail: 'Storage areas, bins and their QR codes' },
    { to: '/checkout',   title: 'Quick checkout (old)', detail: 'The original simple checkout, kept until everything moves to the Queue' },
    { to: '/account',    title: isOwner ? 'My account & View as' : 'My account', detail: isOwner ? 'Preview the app as Arts or Creator; sign out' : 'Who you are signed in as; sign out' },
  ]

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <h1 className="font-display text-2xl text-pt-accent py-2">Admin</h1>
      </div>
      <div className="p-4">
        <div className="bg-pt-surface border border-pt-border rounded-2xl divide-y divide-pt-border overflow-hidden">
          {entries.map(e => (
            <button key={e.to} onClick={() => navigate(e.to)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-pt-bg">
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
