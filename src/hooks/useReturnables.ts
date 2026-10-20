// Return props + gear together (owner, Oct 20): what you still have out, grouped by shoot like My requests.
// Props are returnable once picked up ('collected'); gear once signed for ('out').
import { useEffect, useMemo, useState } from 'react'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToGearBookings, type GearBooking } from '../services/gear'
import { useMyShoots, type Shoot } from '../services/schedule'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { groupByShoot, type RequestGroup } from '../lib/requestGroups'

export type ReturnGroup = RequestGroup<Reservation, GearBooking, Shoot>

export const canReturnProps = (r: Reservation) => r.status === 'collected'
export const canReturnGear = (b: GearBooking) => b.status === 'out'
export const returnCount = (g: ReturnGroup) => g.props.filter(canReturnProps).length + g.gear.filter(canReturnGear).length

// Your groups with something still out. `null` while loading.
export function useReturnGroups(email: string): ReturnGroup[] | null {
  const today = todayInStudio()
  const shoots = useMyShoots(email, addDays(today, -365))
  const [props, setProps] = useState<Reservation[] | null>(null)
  const [gear, setGear] = useState<GearBooking[] | null>(null)
  useEffect(() => subscribeToReservations({ email, all: false }, setProps), [email])
  useEffect(() => subscribeToGearBookings(email, setGear), [email])
  return useMemo(() => {
    if (!props || !gear || !shoots) return null
    return groupByShoot(props, gear, shoots, today).upcoming.filter(g => returnCount(g) > 0)
  }, [props, gear, shoots, today])
}

// The group a request belongs to ('props:<id>' / 'gear:<id>'), or a group key.
export function findReturnGroup(groups: ReturnGroup[], ref: string): ReturnGroup | undefined {
  const [kind, id] = ref.split(':')
  if (kind === 'props') return groups.find(g => g.props.some(p => p.id === id))
  if (kind === 'gear') return groups.find(g => g.gear.some(b => b.id === id))
  return groups.find(g => g.key === ref)
}
