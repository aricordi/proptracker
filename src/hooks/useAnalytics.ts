// Everything Analytics and the Dashboard read (owner + admins can read all of it), turned into facts / incidents / jobs.
import { useEffect, useMemo, useState } from 'react'
import { subscribeToUsers } from '../services/users'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToGearBookings, type GearBooking } from '../services/gear'
import { useShootsSince, useReportsSince, useStrikesSince, useInvitesSince, useAllStatuses } from '../services/schedule'
import { useBookingSettings } from './useBookings'
import { todayInStudio } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import { analyze, type AShoot, type AProps, type AGear, type AReport, type AStrike, type AInvite } from '../lib/analytics'
import type { AppUser } from '../types'

export function useAnalyticsData(loadFrom: string) {
  const today = todayInStudio(), now = nowStamp()
  const closed = useBookingSettings()
  const shoots = useShootsSince(loadFrom, true)
  const reports = useReportsSince(loadFrom, true)
  const strikes = useStrikesSince(loadFrom, true)
  const invites = useInvitesSince(loadFrom, true)
  const statuses = useAllStatuses(true)
  const [users, setUsers] = useState<AppUser[]>([])
  const [props, setProps] = useState<Reservation[]>([])
  const [gear, setGear] = useState<GearBooking[]>([])
  useEffect(() => subscribeToUsers(setUsers), [])
  useEffect(() => subscribeToReservations({ email: '', all: true }, setProps), [])
  useEffect(() => subscribeToGearBookings(null, setGear), [])

  const people = useMemo(() => users.filter(u => u.active && (u.role === 'creator' || u.role === 'admin')).map(u => ({ email: u.email, name: u.name || u.email })), [users])
  const staffName = useMemo(() => { const m = new Map(users.map(u => [u.email, u.name || u.email.split('@')[0]])); return (e: string) => m.get(e) ?? e.split('@')[0] }, [users])
  const a = useMemo(() => analyze({ now, closed, shoots: (shoots ?? []) as unknown as AShoot[], props: props as unknown as AProps[], gear: gear as unknown as AGear[],
    reports: reports as unknown as AReport[], strikes: strikes as unknown as AStrike[], invites: invites as unknown as AInvite[] }), [now, closed, shoots, props, gear, reports, strikes, invites])
  const pausedNow = Object.entries(statuses).filter(([, st]) => st.pausedUntil && st.pausedUntil > today).map(([email]) => email)
  return { a, people, staffName, statuses, pausedNow, loading: shoots === null, today }
}
