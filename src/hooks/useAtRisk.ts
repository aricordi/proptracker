import { useMemo } from 'react'
import type { Reservation } from '../services/reservations'
import { lineRisk, todayInStudio, type Risk } from '../../functions/src/booking'
import { useBookings, useBookingSettings } from './useBookings'
import { useItems } from './useItems'
import { useTurnaround } from './useTurnaround'

export interface AtRiskLine { itemId: string; itemName: string; risk: Risk }

export const RISK_WORDS: Record<Risk, string> = {
  late: 'hasn’t been returned yet by the person who had it before',
  damaged: 'came back damaged',
  missing: 'has units missing',
}

// For each upcoming booking not yet packed: props that might not be ready
// (someone else has them out late, or they came back damaged or missing).
export function useAtRisk(reservations: Reservation[]): Record<string, AtRiskLine[]> {
  const bookings = useBookings()
  const settings = useBookingSettings()
  const items = useItems()
  const turnaround = useTurnaround()
  return useMemo(() => {
    const today = todayInStudio()
    const byId = new Map(items.map(i => [i.id, i]))
    const out: Record<string, AtRiskLine[]> = {}
    for (const r of reservations) {
      if (r.status !== 'requested' && r.status !== 'preparing') continue
      const risky: AtRiskLine[] = []
      for (const l of r.lines) {
        if (l.pick) continue   // already picked (or already marked not available)
        const item = byId.get(l.itemId)
        if (!item) continue
        const risk = lineRisk({
          reservationId: r.id, qty: l.qty, start: r.startDate, end: r.endDate,
          stock: { quantity: item.quantity, missingQty: item.missingQty },
          damaged: item.condition === 'damaged', entries: bookings[l.itemId] ?? [],
          today, bufferDays: turnaround(item), closed: settings,
        })
        if (risk) risky.push({ itemId: l.itemId, itemName: l.itemName, risk })
      }
      if (risky.length) out[r.id] = risky
    }
    return out
  }, [reservations, bookings, settings, items, turnaround])
}
