// Laptop layout (owner, Nov 2: "Maanik does everything on his desktop… a more power-user interface"; then "a desktop view for
// the admin analytics page as well"). On a laptop-size screen (≥ 1100 px wide) the owner, the equipment team and admins get a
// sidebar instead of the phone tab bar, and the pages built for it (Requests & schedule, Analytics) use the full width.
// Every other page stays phone-width in the middle. Phones and tablets are unchanged. "Use the phone layout" turns it off.
import { useCalendarQueue } from '../services/schedule'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useSession } from '../auth'
import Avatar from '../components/Avatar'
import BrandMark from '../components/BrandMark'
import { Icon, type IconName } from '../components/Icon'
import { todayInStudio } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'

export const DESK_MIN_WIDTH = 1100
const OFF_KEY = 'pc.deskOff'
const DESK_ROLES = ['owner', 'equipment', 'admin']

const mq = () => typeof window !== 'undefined' ? window.matchMedia(`(min-width: ${DESK_MIN_WIDTH}px)`) : null
function useWide() {
  return useSyncExternalStore(cb => { const m = mq(); m?.addEventListener('change', cb); return () => m?.removeEventListener('change', cb) },
    () => !!mq()?.matches, () => false)
}
const readOff = () => { try { return localStorage.getItem(OFF_KEY) === '1' } catch { return false } }
const listeners = new Set<() => void>()
export function setDeskOff(off: boolean) {
  try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY) } catch { /* private mode */ }
  listeners.forEach(f => f())
}
function useOff() {
  const [off, setOff] = useState(readOff)
  useEffect(() => { const f = () => setOff(readOff()); listeners.add(f); return () => { listeners.delete(f) } }, [])
  return off
}

/** { on: laptop layout showing now, can: this person on this screen could have it (for the switch on Account) } */
export function useDesk() {
  const { role, demo } = useSession()
  const wide = useWide(), off = useOff()
  const can = wide && !demo && DESK_ROLES.includes(role)
  return { on: can && !off, can, off }
}

/** Pages designed for the full width. Everything else sits phone-width in the middle. */
export const FULL_WIDTH = ['/approvals', '/analytics']
// Pages with their own laptop layout (owner, Nov 3: admins + the equipment team live on the laptop): only the page
// itself (sub-pages like /schedule/settings stay phone width in the middle).
export const FULL_EXACT = ['/admin', '/schedule', '/creators']   // + '/' for admins (their Dashboard)

/** Requests waiting (new bookings + moves of approved shoots), live, for the sidebar badge. */
export function useWaitingCount(enabled: boolean) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!enabled) return
    return onSnapshot(query(collection(db, 'shoots'), where('date', '>=', todayInStudio())), snap => {
      const now = nowStamp()
      setN(snap.docs.filter(d => { const x = d.data(); return (x.status === 'requested' && x.from > now) || (x.status === 'booked' && x.moveRequest && x.moveRequest.from > now) }).length)
    }, () => setN(0))
  }, [enabled])
  return n
}

type Item = { to: string; label: string; icon: IconName; badge?: boolean; also?: string[] }
const NAV: Record<string, (Item | '-')[]> = {
  equipment: [
    { to: '/approvals', label: 'Requests', icon: 'calendar', badge: true },
    { to: '/gear/bookings', label: 'Gear log', icon: 'list' },
    { to: '/schedule/team', label: 'Check-ins', icon: 'clock' },
    { to: '/schedule', label: 'Schedule', icon: 'calendar' },
    '-',
    { to: '/gear/items', label: 'All gear', icon: 'camera' },
    { to: '/gear/bundles', label: 'Kits', icon: 'box' },
    { to: '/admin', label: 'More', icon: 'grid', also: ['/account', '/help'] },
  ],
  admin: [
    { to: '/', label: 'Dashboard', icon: 'grid' },
    { to: '/analytics', label: 'Analytics', icon: 'chart', also: ['/rules-sheet'] },
    { to: '/approvals', label: 'Requests', icon: 'calendar', badge: true },
    { to: '/creators', label: 'Creators', icon: 'people', also: ['/people'] },
    '-',
    { to: '/reservations', label: 'Props queue', icon: 'list' },
    { to: '/gear/bookings', label: 'Gear log', icon: 'box' },
    { to: '/schedule', label: 'Schedule', icon: 'calendar' },
    { to: '/admin', label: 'More', icon: 'grid', also: ['/account', '/help', '/users'] },
  ],
  owner: [
    { to: '/approvals', label: 'Requests', icon: 'calendar', badge: true },
    { to: '/analytics', label: 'Analytics', icon: 'chart', also: ['/rules-sheet'] },
    { to: '/creators', label: 'Creators', icon: 'people', also: ['/people'] },
    { to: '/reservations', label: 'Props queue', icon: 'list' },
    { to: '/gear/bookings', label: 'Gear log', icon: 'box' },
    '-',
    { to: '/', label: 'Chat', icon: 'chat' },
    { to: '/schedule', label: 'Book a shoot', icon: 'pin', also: ['/shoots'] },
    { to: '/browse', label: 'Props', icon: 'search', also: ['/item'] },
    { to: '/admin', label: 'Team', icon: 'grid', also: ['/users', '/health', '/bins', '/categories', '/connections', '/ai', '/costs'] },
  ],
}

export function DeskSidebar() {
  const { role, profile, isGearStaff } = useSession()
  // Booking requests + Google Calendar events to check (Requests → Google Calendar tab).
  const waiting = useWaitingCount(true) + (useCalendarQueue(isGearStaff)?.length ?? 0)
  const path = useLocation().pathname
  const items = NAV[role] ?? []
  const on = (it: Item) => it.to === '/' ? path === '/' : path === it.to || path.startsWith(it.to + '/') || (it.also ?? []).some(a => path.startsWith(a))
  // The longest matching item wins (so /schedule/team doesn't also light up "Day view").
  const best = items.filter((x): x is Item => x !== '-' && on(x)).sort((a, b) => b.to.length - a.to.length)[0]
  return (
    <aside className="w-[208px] shrink-0 h-full flex flex-col gap-0.5 px-3 py-4 border-r border-white/[0.06] bg-[#0B0B0C] overflow-y-auto">
      <div className="flex items-center gap-2 px-2 pb-4 text-pt-text">
        <BrandMark className="w-6 h-6 text-white" title="" />
        <span className="font-bold text-[13px] tracking-wide">PRIME CAPITOL</span>
      </div>
      {items.map((it, i) => it === '-' ? <div key={i} className="h-px bg-white/[0.06] my-2 mx-2" /> : (
        <NavLink key={it.to} to={it.to} end={it.to === '/'}
          className={`flex items-center gap-3 px-3 py-2 rounded-[10px] text-[14px] ${best === it ? 'bg-pt-raised text-pt-text font-semibold' : 'text-pt-muted hover:text-pt-text hover:bg-white/[0.04]'}`}>
          <Icon name={it.icon} className="w-[18px] h-[18px] shrink-0" />
          <span className="flex-1 min-w-0 truncate">{it.label}</span>
          {it.badge && waiting > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-400 text-stone-900 text-xs font-bold grid place-items-center">{waiting}</span>}
        </NavLink>
      ))}
      <div className="mt-auto pt-4 space-y-2">
        <NavLink to="/account" className="flex items-center gap-2 px-2 py-1.5 rounded-[10px] hover:bg-white/[0.04]">
          <Avatar email={profile.email} name={profile.name || profile.email} size={28} />
          <span className="min-w-0 flex-1"><span className="block text-pt-text text-[13px] truncate">{profile.name || profile.email}</span><span className="block text-pt-muted text-xs capitalize">{role}</span></span>
        </NavLink>
        <button onClick={() => setDeskOff(true)} className="w-full text-left px-2 text-pt-muted text-xs hover:text-pt-text">Use the phone layout</button>
      </div>
    </aside>
  )
}

/** Keyboard shortcuts for desk pages; ignored while typing in a box. */
export function useKeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const fn = map[e.key] ?? map[e.key.toLowerCase()]
      if (fn) { e.preventDefault(); fn(e) }
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  })
}
