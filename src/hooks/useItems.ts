import { useState, useEffect } from 'react'
import { subscribeToItems } from '../services/items'
import type { Item } from '../types'

export function useItems() {
  const [items, setItems] = useState<Item[]>([])
  useEffect(() => subscribeToItems(setItems), [])
  return items
}
