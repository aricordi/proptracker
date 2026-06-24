import { useState, useEffect } from 'react'
import { subscribeToBins } from '../services/bins'
import type { Bin } from '../types'

export function useBins() {
  const [bins, setBins] = useState<Bin[]>([])
  useEffect(() => subscribeToBins(setBins), [])
  return bins
}
