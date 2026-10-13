// Summaries for the history pages: what a creator has borrowed, and how it went.
import type { Reservation, ReservationLine } from '../services/reservations'
import type { Item } from '../types'
import { isLate, wasReturnedLate, type ClosedDays } from '../../functions/src/booking'

export interface Incident {
  reservation: Reservation
  line: ReservationLine
  result: 'damaged' | 'missing'
  units: number
  unitCost: number | null   // null = no replacement cost on the prop
  cost: number              // units × unit cost (0 when unknown)
}

export interface CreatorSummary {
  total: number             // bookings made (any status)
  completed: number         // checked back in
  cancelled: number         // cancelled or declined
  lateNow: Reservation[]    // out right now and late
  lateReturns: Reservation[]// brought back after the deadline
  incidents: Incident[]
  incidentCost: number
  unknownCosts: number      // incidents whose prop has no replacement cost
}

export const unitCostOf = (item: Item | undefined): number | null => {
  const v = item?.replacementCost ?? item?.cost
  return typeof v === 'number' && v >= 0 ? v : null
}

export function incidentsIn(r: Reservation, itemsById: Map<string, Item>): Incident[] {
  const out: Incident[] = []
  for (const line of r.lines) {
    const result = line.checkIn?.result
    if (result !== 'damaged' && result !== 'missing') continue
    const units = result === 'missing' ? (line.checkIn?.missingQty ?? 1) : 1
    const unitCost = unitCostOf(itemsById.get(line.itemId))
    out.push({ reservation: r, line, result, units, unitCost, cost: unitCost === null ? 0 : unitCost * units })
  }
  return out
}

export function summarizeCreator(reservations: Reservation[], itemsById: Map<string, Item>, closed: ClosedDays, now = new Date()): CreatorSummary {
  const returnedAt = (r: Reservation) => r.returnInfo?.at ?? r.checkedInAt
  const incidents = reservations.flatMap(r => incidentsIn(r, itemsById))
  return {
    total: reservations.length,
    completed: reservations.filter(r => r.status === 'returned').length,
    cancelled: reservations.filter(r => r.status === 'cancelled' || r.status === 'declined').length,
    lateNow: reservations.filter(r => isLate(r.status, r.endDate, closed, now)),
    lateReturns: reservations.filter(r => {
      const at = returnedAt(r)
      return (r.status === 'return_pending' || r.status === 'returned') && !!at && wasReturnedLate(r.endDate, at, closed)
    }),
    incidents,
    incidentCost: incidents.reduce((n, i) => n + i.cost, 0),
    unknownCosts: incidents.filter(i => i.unitCost === null).length,
  }
}

export const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
