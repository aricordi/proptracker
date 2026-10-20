// The shoot a creator is adding props and gear to ("Adding to: Cliff 1 · Sat Oct 24").
// Kept on this phone. Picking a shoot sets both baskets to its day (and gear to its hours),
// so everything shown as "free" is free for that shoot.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSession } from './auth'
import { useCart } from './cart'
import { useGearCart } from './gearCart'
import { useBookingSettings } from './hooks/useBookings'
import { todayInStudio, lastDayToBook, pickupDay, addDays } from '../functions/src/booking'
import { nowStamp, GEAR_DAY_START, GEAR_DAY_END, GEAR_LEAD_TIME_DAYS } from '../functions/src/gearBooking'
import { useMyShoots, useScheduleSettings, fmtSlot, type Shoot } from './services/schedule'
import { formatDay } from './lib/dates'

const KEY = 'primeapp.activeShoot.v1'

interface ActiveShootApi {
  shoot: Shoot | null          // the shoot being added to (null = just browsing)
  upcoming: Shoot[]            // your booked shoots that haven't ended
  loaded: boolean
  choose: (id: string | null) => void
}

const Ctx = createContext<ActiveShootApi | null>(null)

// Gear can be booked 6 AM–midnight; a shoot's hours are trimmed to fit.
export function gearHoursFor(sh: Shoot) {
  const start = Math.min(Math.max(sh.start, GEAR_DAY_START), GEAR_DAY_END - 30)
  const end = Math.max(Math.min(sh.end, GEAR_DAY_END), start + 30)
  return { start, end }
}

export function ActiveShootProvider({ children }: { children: ReactNode }) {
  const { profile } = useSession()
  const cart = useCart(), gear = useGearCart()
  const mine = useMyShoots(profile.email, todayInStudio())
  const [id, setId] = useState<string | null>(() => { try { return localStorage.getItem(KEY) } catch { return null } })
  const now = nowStamp()
  const upcoming = useMemo(() => (mine ?? []).filter(x => x.status === 'booked' && x.to > now), [mine, now.slice(0, 15)])   // eslint-disable-line react-hooks/exhaustive-deps
  const shoot = upcoming.find(x => x.id === id) ?? null
  const chosenAt = useRef(0)
  const choose = (next: string | null) => {
    setId(next); chosenAt.current = Date.now()
    try { next ? localStorage.setItem(KEY, next) : localStorage.removeItem(KEY) } catch { /* private mode: fine */ }
  }
  // The shoot was cancelled or is over: back to just browsing. (A shoot booked a moment ago may not have
  // reached this phone's list yet, so give it half a minute before deciding it's gone.)
  useEffect(() => {
    if (!mine || !id || shoot) return
    const wait = 30_000 - (Date.now() - chosenAt.current)
    if (wait <= 0) { choose(null); return }
    const t = setTimeout(() => choose(null), wait)
    return () => clearTimeout(t)
  }, [mine, id, shoot])   // eslint-disable-line react-hooks/exhaustive-deps
  // Both baskets follow the shoot's day; gear follows its hours.
  useEffect(() => {
    if (!shoot) return
    if (cart.start !== shoot.date || cart.end !== shoot.date) cart.setDates(shoot.date, shoot.date)
    const h = gearHoursFor(shoot)
    // Gear always matches the shoot's slot (owner, Oct 20: no picking times).
    if (gear.date !== shoot.date || gear.start !== h.start || gear.end !== h.end) gear.setWhen(shoot.date, h.start, h.end)
  }, [shoot?.id, shoot?.date, shoot?.start, shoot?.end, gear.date, gear.start, gear.end])   // eslint-disable-line react-hooks/exhaustive-deps
  return <Ctx.Provider value={{ shoot, upcoming, loaded: mine !== null, choose }}>{children}</Ctx.Provider>
}

export function useActiveShoot(): ActiveShootApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('useActiveShoot outside ActiveShootProvider')
  return c
}

// "Cliff 1 · Sat, Oct 24 · 1–3 PM"
export function useShootLabel() {
  const s = useScheduleSettings()
  return (sh: Shoot) => `${sh.place === 'offsite' ? (sh.where || 'Offsite') : s.houses[sh.place].name} · ${formatDay(sh.date)} · ${fmtSlot(sh.start, sh.end - sh.start)}`
}

// Last day to add each kind of thing to a shoot (open days before; closed days don't count).
export function useCutoffs() {
  const settings = useBookingSettings()
  return (sh: Shoot) => ({
    props: lastDayToBook(sh.date, settings.leadTimeDays, settings),
    builds: lastDayToBook(sh.date, settings.buildLeadDays, settings),
    gear: lastDayToBook(pickupDay(sh.date, settings), GEAR_LEAD_TIME_DAYS, settings),
  })
}

// Things picked (e.g. from ✦ Prop ideas) to add to a shoot. When the creator books a NEW shoot for them, they wait
// on the phone until the booking is done, then go into that shoot's baskets (owner, Oct 19).
export interface ShootAdds { props: string[]; gear: string[]; builds: string[] }
const PENDING = 'primeapp.pendingAdds.v1'
export function savePendingAdds(a: ShootAdds) { try { localStorage.setItem(PENDING, JSON.stringify({ ...a, at: Date.now() })) } catch { /* private mode */ } }
export function takePendingAdds(): ShootAdds | null {
  try {
    const raw = localStorage.getItem(PENDING); localStorage.removeItem(PENDING)
    const a = raw ? JSON.parse(raw) : null
    // Only if it was picked in the last hour (an old, forgotten pick shouldn't sneak into a later shoot).
    return a && Date.now() - Number(a.at) < 3_600_000 ? { props: a.props ?? [], gear: a.gear ?? [], builds: a.builds ?? [] } : null
  } catch { return null }
}
export const hasPendingAdds = () => { try { return !!localStorage.getItem(PENDING) } catch { return false } }
export function peekPendingAdds(): ShootAdds | null {
  try { const a = JSON.parse(localStorage.getItem(PENDING) || 'null'); return a ? { props: a.props ?? [], gear: a.gear ?? [], builds: a.builds ?? [] } : null } catch { return null }
}
// The first shoot day those picks can still be added to (each kind has its own notice).
export function useEarliestDayFor() {
  const settings = useBookingSettings()
  return (a: ShootAdds | null, from: string) => {
    if (!a) return from
    for (let k = 0, d = from; k < 60; k++, d = addDays(d, 1)) {
      const ok = (!a.props.length || lastDayToBook(d, settings.leadTimeDays, settings) >= from)
        && (!a.builds.length || lastDayToBook(d, settings.buildLeadDays, settings) >= from)
        && (!a.gear.length || lastDayToBook(pickupDay(d, settings), GEAR_LEAD_TIME_DAYS, settings) >= from)
      if (ok) return d
    }
    return from
  }
}

// Make `shootId` the shoot being added to, and put the picks in its baskets.
export function useAddToShoot() {
  const { choose } = useActiveShoot()
  const cart = useCart(), gear = useGearCart()
  return (shootId: string, a: ShootAdds) => {
    choose(shootId)
    a.props.forEach(id => { if (!cart.lines[id]) cart.setQty(id, 1) })
    a.gear.forEach(id => { if (!gear.lines[id]) gear.setQty(id, 1) })
    a.builds.forEach(name => { if (!cart.builds.some(b => b.description === name)) cart.addBuild({ description: name, qty: 1 }) })
  }
}
