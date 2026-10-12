import { NavLink } from 'react-router-dom'
import { useSession } from '../auth'

const searchIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
)

const checkoutIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
    <path d="M20.2 6 3 11l9 2 2 9 2.6-9.2Z" />
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

const staffNav = [
  { to: '/',         label: 'Search',   icon: searchIcon },
  { to: '/checkout', label: 'Checkout', icon: checkoutIcon },
  { to: '/add',      label: 'Add',      icon: addIcon },
  { to: '/admin',    label: 'Admin',    icon: adminIcon },
]

const creatorNav = [
  { to: '/',        label: 'Search',  icon: searchIcon },
  { to: '/account', label: 'Account', icon: accountIcon },
]

export default function BottomNav() {
  const { isStaff } = useSession()
  const nav = isStaff ? staffNav : creatorNav
  return (
    <nav className="flex bg-pt-surface border-t border-pt-border pb-safe">
      {nav.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center gap-0.5 pt-2 pb-0 text-xs transition-colors ${
              isActive ? 'text-pt-accent' : 'text-pt-muted'
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
