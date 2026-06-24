import { useState, useEffect } from 'react'
import { subscribeToLocations } from '../services/locations'
import type { Location } from '../types'

export function useLocations() {
  const [locations, setLocations] = useState<Location[]>([])
  useEffect(() => subscribeToLocations(setLocations), [])
  return locations
}
