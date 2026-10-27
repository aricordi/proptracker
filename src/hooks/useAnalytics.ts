// Everything Analytics and the Dashboard read (owner + admins can read all of it), turned into facts / incidents / jobs.
import { useEffect, useMemo, useState } from 'react'
import { subscribeToUsers } from '../services/users'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToGearBookings, type GearBooking } from '../services/gear'
import { useShootsSince, useReportsSince, useStrikesSince, useInvitesSince, useAllStatuses, useFlagReviews } from '../services/schedule'
import { useBookingSettings } from './useBookings'
import { todayInStudio } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import { analyze, type AShoot, type AProps, type AGear, type AReport, type AStrike, type AInvite } from '../lib/analytics'
import type { AppUser } from '../types'
import { creatorPeople, countedEmails } from '../lib/creatorPeople'

export function useAnalyticsData(loadFrom: string) {
  const today = todayInStudio(), now = nowStamp()
  const closed = useBookingSettings()
  const shoots = useShootsSince(loadFrom, true)
  const reports = useReportsSince(loadFrom, true)
  const strikes = useStrikesSince(loadFrom, true)
  const invites = useInvitesSince(loadFrom, true)
  const statuses = useAllStatuses(true)
  const reviews = useFlagReviews(true)
  const excused = useMemo(() => new Set([...reviews.values()].filter(r => r.status === 'excused').map(r => r.flagId)), [reviews])
  const [users, setUsers] = useState<AppUser[]>([])
  const [props, setProps] = useState<Reservation[]>([])
  const [gear, setGear] = useState<GearBooking[]>([])
  useEffect(() => subscribeToUsers(setUsers), [])
  useEffect(() => subscribeToReservations({ email: '', all: true }, setProps), [])
  useEffect(() => subscribeToGearBookings(null, setGear), [])

  const people = useMemo(() => creatorPeople(users), [users])
  const counted = useMemo(() => countedEmails(users), [users])
  const staffName = useMemo(() => { const m = new Map(users.map(u => [u.email, u.name || u.email.split('@')[0]])); return (e: string) => m.get(e) ?? e.split('@')[0] }, [users])
  const raw0 = useMemo(() => analyze({ now, closed, shoots: (shoots ?? []) as unknown as AShoot[], props: props as unknown as AProps[], gear: gear as unknown as AGear[],
    reports: reports as unknown as AReport[], strikes: strikes as unknown as AStrike[], invites: invites as unknown as AInvite[], excused }),
  [now, closed, shoots, props, gear, reports, strikes, invites, excused])
  // Only creators and the owner are scored; team work (jobs, backlog) is kept as is.
  const a = useMemo(() => ({ ...raw0, facts: raw0.facts.filter(f => counted.has(f.email)),
    incidents: raw0.incidents.filter(i => counted.has(i.email)), excused: raw0.excused.filter(i => counted.has(i.email)),
    upcoming: raw0.upcoming.filter(u => counted.has(u.email)) }), [raw0, counted])
  // The raw records behind each flag (evidence on the flag sheet).
  const raw = useMemo(() => ({ shoots: new Map((shoots ?? []).map(x => [x.id, x])), reports: new Map(reports.map(x => [x.id, x])),
    props: new Map(props.map(x => [x.id, x])), gear: new Map(gear.map(x => [x.id, x])), strikes: new Map(strikes.map(x => [x.id, x])) }), [shoots, reports, props, gear, strikes])
  const pausedNow = Object.entries(statuses).filter(([, st]) => st.pausedUntil && st.pausedUntil > today).map(([email]) => email)
  return { a, people, staffName, statuses, pausedNow: pausedNow.filter(e => counted.has(e)), loading: shoots === null || !users.length, today, reviews, raw }
}
