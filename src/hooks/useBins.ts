import { useState, useEffect } from 'react'
import { subscribeToBins } from '../services/bins'
import { compareBinLabels } from '../../functions/src/binNames'
import type { Bin } from '../types'

export function useBins() {
  const [bins, setBins] = useState<Bin[]>([])
  // Every bin list in the app is in number order (owner, Oct 27): Bin 1, 2, 3 … 10, not 1, 10, 2.
  useEffect(() => subscribeToBins(list => setBins([...list].sort((a, b) => compareBinLabels(a.label, b.label)))), [])
  return bins
}
