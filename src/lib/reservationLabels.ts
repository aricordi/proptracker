import type { ReservationStatus } from '../services/reservations'

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  requested: 'Requested',
  declined:  'Declined',
  cancelled: 'Cancelled',
  returned:  'Returned',
}

export const STATUS_STYLES: Record<ReservationStatus, string> = {
  requested: 'bg-sky-500/20 text-sky-300',
  declined:  'bg-red-500/20 text-red-300',
  cancelled: 'bg-pt-border text-pt-muted',
  returned:  'bg-green-500/20 text-green-400',
}
