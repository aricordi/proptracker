// The shoot a creator is adding props and gear to ("Adding to: Cliff 1 · Sat Oct 24").
// Kept on this phone. Picking a shoot sets both baskets to its day (and gear to its hours),
// so everything shown as "free" is free for that shoot.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSession } from './auth'
import { useCart } from './cart'
import { useGearCart } from './gearCart'
import { useBookingSettings } from './hooks/useBookings'
import { todayInStudio, lastDayToBook, pickupDay, addDays } from '../functions/src/booking'
import { nowStamp, GEAR_DAY_START, GEAR_DAY_END, GEAR_LEAD_TIME_DAYS, gearReserveOpensAt, canTakeGear, fmtTime } from '../functions/src/gearBooking'
import { useMyShoots, useScheduleSettings, fmtSlot, isLive, type Shoot } from './services/schedule'
import { formatDay } from './lib/dates'
import BottomSheet from './components/BottomSheet'
import { primaryBtn, secondaryBtn } from './components/ChatCard'

const KEY = 'primeapp.activeShoot.v1'
// Which shoot the props basket was filled for (owner, Nov 6: switching shoots asks before moving an unsent basket).
const BASKET_KEY = 'primeapp.basketShoot.v1'

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
  const upcoming = useMemo(() => (mine ?? []).filter(x => isLive(x) && x.to > now), [mine, now.slice(0, 15)])   // eslint-disable-line react-hooks/exhaustive-deps
  const shoot = upcoming.find(x => x.id === id) ?? null
  const chosenAt = useRef(0)
  // id: a shoot id, '' = the person picked "Just browsing", null = never chose (the app picks for them, below).
  const choose = (next: string | null) => {
    setId(next); chosenAt.current = Date.now()
    try { next !== null ? localStorage.setItem(KEY, next) : localStorage.removeItem(KEY) } catch { /* private mode: fine */ }
  }
  // Nothing chosen yet (owner, Oct 27: zero thinking): start on your soonest shoot that can still take props.
  const settings = useBookingSettings()
  useEffect(() => {
    if (!mine || id !== null) return
    const today = todayInStudio()
    const next = upcoming.find(x => lastDayToBook(x.date, settings.leadTimeDays, settings) >= today)
    if (next) choose(next.id)
  }, [mine, id, upcoming, settings])   // eslint-disable-line react-hooks/exhaustive-deps
  // The shoot was cancelled or is over: back to just browsing. (A shoot booked a moment ago may not have
  // reached this phone's list yet, so give it half a minute before deciding it's gone.)
  useEffect(() => {
    if (!mine || !id || shoot) return
    const wait = 30_000 - (Date.now() - chosenAt.current)
    if (wait <= 0) { choose(null); return }
    const t = setTimeout(() => choose(null), wait)
    return () => clearTimeout(t)
  }, [mine, id, shoot])   // eslint-disable-line react-hooks/exhaustive-deps
  // The basket belongs to the shoot it was filled for. Switching to ANOTHER shoot with props still unsent asks first
  // (owner, Nov 6: it might be a test basket they don't care about), instead of quietly moving them.
  const [basketFor, setBasketForState] = useState<string>(() => { try { return localStorage.getItem(BASKET_KEY) ?? '' } catch { return '' } })
  const setBasketFor = (v: string) => { setBasketForState(v); try { v ? localStorage.setItem(BASKET_KEY, v) : localStorage.removeItem(BASKET_KEY) } catch { /* private mode */ } }
  useEffect(() => {
    if (cart.count === 0) { if (basketFor) setBasketFor(''); return }
    if (!basketFor && shoot) setBasketFor(shoot.id)
  }, [cart.count, shoot?.id])   // eslint-disable-line react-hooks/exhaustive-deps
  const askMove = !!shoot && cart.count > 0 && !!basketFor && basketFor !== shoot.id
  const label = useShootLabel()
  const oldShoot = askMove ? upcoming.find(x => x.id === basketFor) ?? null : null
  // Both baskets follow the shoot's day; gear follows its hours. (Not while the basket question is open.)
  useEffect(() => {
    if (!shoot || askMove) return
    if (cart.start !== shoot.date || cart.end !== shoot.date) cart.setDates(shoot.date, shoot.date)
    const h = gearHoursFor(shoot)
    // Gear always matches the shoot's slot (owner, Oct 20: no picking times).
    if (gear.date !== shoot.date || gear.start !== h.start || gear.end !== h.end) gear.setWhen(shoot.date, h.start, h.end)
  // (cart.start/end too: sending empties the basket and its day; without them it stayed dayless, audit Nov 5.)
  }, [shoot?.id, shoot?.date, shoot?.start, shoot?.end, cart.start, cart.end, gear.date, gear.start, gear.end, askMove])   // eslint-disable-line react-hooks/exhaustive-deps
  const n = cart.count
  return <Ctx.Provider value={{ shoot, upcoming, loaded: mine !== null, choose }}>
    {children}
    {askMove && shoot && (
      <BottomSheet open locked onClose={() => {}} title={`Move your ${n} prop${n === 1 ? '' : 's'} to this shoot?`}>
        <div className="space-y-3">
          <p className="text-pt-muted text-[16px]">
            {oldShoot ? <>You picked {n === 1 ? 'it' : 'them'} for <b className="text-pt-text">{label(oldShoot)}</b>.</> : <>You picked {n === 1 ? 'it' : 'them'} for another shoot.</>}
            {' '}Nothing was sent yet.</p>
          <p className="rounded-2xl bg-white/[0.06] px-4 py-3 text-[16px] text-pt-text">Now adding to: <b>{label(shoot)}</b></p>
          <button onClick={() => setBasketFor(shoot.id)} className={`w-full ${primaryBtn}`}>Yes, move {n === 1 ? 'it' : 'them'} here</button>
          <button onClick={() => { cart.clear(); setBasketFor(shoot.id) }} className={`w-full ${secondaryBtn}`}>No, empty the basket</button>
          {oldShoot && <button onClick={() => choose(oldShoot.id)} className="tap w-full min-h-[44px] text-pt-accent text-[16px] font-semibold">Keep adding to {formatDay(oldShoot.date, { weekday: 'short', month: 'short', day: 'numeric' })} instead</button>}
        </div>
      </BottomSheet>
    )}
  </Ctx.Provider>
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

// Gear is grab-and-go (owner, Nov 2): a creator can RESERVE from `gearReserveHours` before the shoot, and TAKE what's free
// from an hour before it until it ends. 'early' = too soon to do either (first come, first served on the day).
export type GearWindow = { state: 'early' | 'reserve' | 'take' | 'over'; opens: string }
export function useGearWindow() {
  const s = useScheduleSettings()
  return (sh: Shoot, now = nowStamp()): GearWindow => {
    const opens = gearReserveOpensAt(sh.from, s.gearReserveHours)
    // Reserving ahead is off unless the owner turns it on (owner, Nov 3: first come, first served on the day).
    // Only an approved shoot can take gear (a request shows when it can, once approved).
    const state = now >= sh.to ? 'over' : canTakeGear(sh.from, sh.to, now) && sh.status === 'booked' ? 'take' : now >= opens && s.gearReserve ? 'reserve' : 'early'
    return { state, opens }
  }
}
/** "Thu 1 PM" from a 'YYYY-MM-DDTHH:MM' stamp. */
export const stampLabel = (st: string) => `${formatDay(st.slice(0, 10), { weekday: 'short' })} ${fmtTime(Number(st.slice(11, 13)) * 60 + Number(st.slice(14, 16)))}`

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
  const gearOn = useScheduleSettings().gearReserve
  return (shootId: string, a: ShootAdds) => {
    choose(shootId)
    a.props.forEach(id => { if (!cart.lines[id]) cart.setQty(id, 1) })
    // Gear isn't booked ahead (owner, Nov 3): picked gear never goes into a shoot.
    if (gearOn) a.gear.forEach(id => { if (!gear.lines[id]) gear.setQty(id, 1) })
    a.builds.forEach(name => { if (!cart.builds.some(b => b.description === name)) cart.addBuild({ description: name, qty: 1 }) })
  }
}
