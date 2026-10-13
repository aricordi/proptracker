import { useMemo } from 'react'
import { useCategories } from './useCategories'
import { useBookingSettings } from './useBookings'
import { turnaroundFor } from '../../functions/src/booking'
import type { Item } from '../types'

// Returns a function giving each prop's turnaround days (its category's own
// setting, or the default). Mirrors what the server checks.
export function useTurnaround() {
  const categories = useCategories()
  const settings = useBookingSettings()
  return useMemo(() => {
    const byCategory = Object.fromEntries(categories.map(c => [c.id, c.turnaroundDays]))
    return (item: Pick<Item, 'categoryId'>) => turnaroundFor(item.categoryId, byCategory, settings.bufferDays)
  }, [categories, settings.bufferDays])
}
