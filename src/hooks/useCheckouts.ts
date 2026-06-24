import { useState, useEffect } from 'react'
import { subscribeToCheckouts } from '../services/checkout'
import type { ActiveCheckout } from '../types'

export function useCheckouts() {
  const [checkouts, setCheckouts] = useState<ActiveCheckout[]>([])
  useEffect(() => subscribeToCheckouts(setCheckouts), [])
  return checkouts
}
