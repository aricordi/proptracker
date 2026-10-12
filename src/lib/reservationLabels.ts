import type { Reservation, ReservationStatus } from '../services/reservations'

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  requested:      'Requested',
  preparing:      'Being picked',
  packed:         'Packed & ready',
  collected:      'Collected',
  return_pending: 'Returned, being checked',
  returned:       'Returned',
  declined:       'Declined',
  cancelled:      'Cancelled',
}

// "Being built or sourced" when the booking includes something to make.
export function statusLabel(r: Pick<Reservation, 'status' | 'builds'>) {
  if (r.status === 'preparing' && r.builds?.some(b => b.state === 'todo')) return 'Being built or sourced'
  return STATUS_LABELS[r.status]
}

export const STATUS_STYLES: Record<ReservationStatus, string> = {
  requested:      'bg-sky-500/20 text-sky-300',
  preparing:      'bg-violet-500/20 text-violet-300',
  packed:         'bg-pt-accent text-stone-900',
  collected:      'bg-amber-500/20 text-amber-300',
  return_pending: 'bg-teal-500/20 text-teal-300',
  returned:       'bg-green-500/20 text-green-400',
  declined:       'bg-red-500/20 text-red-300',
  cancelled:      'bg-pt-border text-pt-muted',
}

// The steps shown as a progress line on a booking.
export const JOURNEY: { status: ReservationStatus; label: string }[] = [
  { status: 'requested',      label: 'Requested' },
  { status: 'preparing',      label: 'Being prepared' },
  { status: 'packed',         label: 'Ready' },
  { status: 'collected',      label: 'Collected' },
  { status: 'return_pending', label: 'Returned' },
  { status: 'returned',       label: 'Checked in' },
]
