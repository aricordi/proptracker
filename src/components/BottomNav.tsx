import { NavLink, useLocation } from 'react-router-dom'
import { useSession } from '../auth'

const searchIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
)

const reservationsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18M8 15l2.5 2.5L16 12" />
  </svg>
)

const addIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v8M8 12h8" />
  </svg>
)

const adminIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
)

const accountIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
)

const cameraIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <rect x="2.5" y="7" width="13" height="10" rx="2" />
    <path d="M15.5 10.5 21 8v8l-5.5-2.5" />
  </svg>
)

const scheduleIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <path d="M3 10.5 12 4l9 6.5" />
    <path d="M5 9v11h14V9" />
    <path d="M12 12.5v3.5l2 1.5" />
  </svg>
)

const staffNav = [
  { to: '/',         label: 'Search',   icon: searchIcon },
  { to: '/schedule', label: 'Schedule', icon: scheduleIcon },
  { to: '/reservations', label: 'Queue', icon: reservationsIcon },
  { to: '/add',      label: 'Add',      icon: addIcon },
  { to: '/admin',    label: 'Admin',    icon: adminIcon },
]

const homeIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
  </svg>
)

// Creators: everything revolves around the shoot (Home → Book a time → Browse props + gear → Me).
const creatorNav = [
  { to: '/',         label: 'Home',   icon: homeIcon },
  { to: '/schedule', label: 'Book',   icon: scheduleIcon },
  { to: '/browse',   label: 'Browse', icon: searchIcon, also: ['/gear', '/item'] },
  { to: '/account',  label: 'Me',     icon: accountIcon, also: ['/reservations', '/gear/bookings'] },
]

const gearIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
    <path d="M3 8l9 5 9-5M12 13v8" />
  </svg>
)


// Equipment team: gear only (the gear queue arrives with gear bookings).
const equipmentNav = [
  { to: '/schedule',      label: 'Schedule', icon: scheduleIcon },
  { to: '/gear/bookings', label: 'Bookings', icon: reservationsIcon },
  { to: '/gear/bundles', label: 'Bundles',  icon: gearIcon },
  { to: '/gear/items',   label: 'All gear', icon: cameraIcon },
  { to: '/account',      label: 'Account',  icon: accountIcon },
]

export default function BottomNav() {
  const { isStaff, role } = useSession()
  const nav: { to: string; label: string; icon: JSX.Element; also?: string[] }[] = role === 'equipment' ? equipmentNav : isStaff ? staffNav : creatorNav
  const path = useLocation().pathname
  // Gear bookings belong to "Me" for creators; the gear shop to "Browse".
  const alsoActive = (also?: string[]) => !!also?.some(p => path.startsWith(p)) && !(path.startsWith('/gear/bookings') && !also?.includes('/gear/bookings'))
  return (
    <nav className="flex bg-black/80 backdrop-blur-xl backdrop-saturate-150 border-t border-pt-border pb-tabbar">
      {nav.map(({ to, label, icon, also }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center gap-0.5 pt-2 pb-0 text-xs transition-colors ${
              isActive || alsoActive(also) ? 'text-pt-accent' : 'text-pt-muted'
            }`
          }
        >
          {icon}
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
