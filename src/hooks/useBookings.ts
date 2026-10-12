import { useState, useEffect } from 'react'
import { subscribeToBookings, subscribeToBookingSettings } from '../services/reservations'
import { DEFAULT_BOOKING_SETTINGS, type BookingEntry, type BookingSettings } from '../../functions/src/booking'

export function useBookings() {
  const [byItem, setByItem] = useState<Record<string, BookingEntry[]>>({})
  useEffect(() => subscribeToBookings(setByItem), [])
  return byItem
}

export function useBookingSettings() {
  const [settings, setSettings] = useState<BookingSettings>(DEFAULT_BOOKING_SETTINGS)
  useEffect(() => subscribeToBookingSettings(setSettings), [])
  return settings
}
