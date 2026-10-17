// The shoot a creator is adding props and gear to ("Adding to: Cliff 1 · Sat Oct 24").
// Kept on this phone. Picking a shoot sets both baskets to its day (and gear to its hours),
// so everything shown as "free" is free for that shoot.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSession } from './auth'
import { useCart } from './cart'
import { useGearCart } from './gearCart'
import { useBookingSettings } from './hooks/useBookings'
import { todayInStudio, lastDayToBook, pickupDay } from '../functions/src/booking'
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
  const choose = (next: string | null) => {
    setId(next)
    try { next ? localStorage.setItem(KEY, next) : localStorage.removeItem(KEY) } catch { /* private mode: fine */ }
  }
  // The shoot was cancelled or is over: back to just browsing.
  useEffect(() => { if (mine && id && !shoot) choose(null) }, [mine, id, shoot])   // eslint-disable-line react-hooks/exhaustive-deps
  // Both baskets follow the shoot's day; gear follows its hours.
  useEffect(() => {
    if (!shoot) return
    if (cart.start !== shoot.date || cart.end !== shoot.date) cart.setDates(shoot.date, shoot.date)
    const h = gearHoursFor(shoot)
    if (gear.date !== shoot.date) gear.setWhen(shoot.date, h.start, h.end)
  }, [shoot?.id, shoot?.date, shoot?.start])   // eslint-disable-line react-hooks/exhaustive-deps
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
