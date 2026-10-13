import { useEffect, useState } from 'react'
import { useSession } from '../auth'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { isLate } from '../../functions/src/booking'
import { useBookingSettings } from './useBookings'

// The signed-in creator's bookings whose props are late. Creators with late
// props can't book more until they're back (the server enforces this too).
// Always empty for the arts department.
export function useMyLateBookings(): Reservation[] {
  const { isStaff, profile } = useSession()
  const settings = useBookingSettings()
  const [mine, setMine] = useState<Reservation[]>([])
  // Re-check every few minutes so the flag appears at 10am without a reload.
  const [, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 5 * 60_000); return () => clearInterval(t) }, [])
  useEffect(() => isStaff ? undefined : subscribeToReservations({ email: profile.email, all: false }, setMine), [isStaff, profile.email])
  return isStaff ? [] : mine.filter(r => isLate(r.status, r.endDate, settings))
}
