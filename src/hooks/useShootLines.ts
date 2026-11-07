// "Cliff 1 · Sat, Nov 8 · 1–3 PM · Riley" for requests and gear bookings that belong to a shoot on the schedule.
// Looks the shoot up in that day's schedule doc (every team can read those; the arts team can't read shoots/).
// ONE live copy per day for the whole app, kept a few minutes after the last screen using it closes, so going from
// a queue to a request and back doesn't read it again.
import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useScheduleSettings, type ScheduleDay } from '../services/schedule'
import { findShootOnDay, shootLineText } from '../lib/shootLine'

interface DayStore { day: ScheduleDay | null; subs: Set<() => void>; stop?: () => void; linger?: ReturnType<typeof setTimeout> }
const stores = new Map<string, DayStore>()
const LINGER_MS = 5 * 60_000

function watchDay(date: string, cb: () => void) {
  let s = stores.get(date)
  if (!s) { s = { day: null, subs: new Set() }; stores.set(date, s) }
  const st = s
  if (st.linger) { clearTimeout(st.linger); st.linger = undefined }
  st.subs.add(cb)
  if (!st.stop) st.stop = onSnapshot(doc(db, 'schedule_days', date),
    snap => { st.day = snap.exists() ? ({ date, ...snap.data() } as ScheduleDay) : null; st.subs.forEach(f => f()) },
    () => { st.stop = undefined; st.day = null; st.subs.forEach(f => f()) })   // not allowed / signed out: show nothing
  return () => {
    st.subs.delete(cb)
    if (!st.subs.size) st.linger = setTimeout(() => { st.stop?.(); st.stop = undefined; st.day = null; st.linger = undefined; stores.delete(date) }, LINGER_MS)
  }
}

export type ShootRef = { shootId?: string; date?: string }

// Give it the requests on screen; get back shootId → the line ('' when there's no shoot, or it isn't on the schedule).
// `viewer` = the person looking: their own name is left out of the line. Lists of cards get a short offsite place
// (so the day, hours and name always fit); a request's own page (useShootLine) shows the whole address.
export function useShootLines(refs: ShootRef[], viewer?: string, { short = true }: { short?: boolean } = {}): (shootId: string | undefined) => string {
  const s = useScheduleSettings()
  const [, setVersion] = useState(0)
  const key = [...new Set(refs.filter(r => r.shootId && r.date).map(r => r.date as string))].sort().join(',')
  useEffect(() => {
    if (!key) return
    const bump = () => setVersion(v => v + 1)
    const stops = key.split(',').map(d => watchDay(d, bump))
    return () => stops.forEach(f => f())
  }, [key])
  const lines = new Map<string, string>()
  for (const r of refs) {
    if (!r.shootId || !r.date || lines.has(r.shootId)) continue
    const spot = findShootOnDay(stores.get(r.date)?.day, r.shootId, s.slotMinutes)
    if (spot) lines.set(r.shootId, shootLineText(spot, s.houses, viewer, short))
  }
  return id => (id && lines.get(id)) || ''
}

// One request (its page header): the whole offsite address, wrapped.
export function useShootLine(shootId: string | undefined, date: string | undefined, viewer?: string): string {
  return useShootLines([{ shootId, date }], viewer, { short: false })(shootId)
}
