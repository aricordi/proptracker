import { useState, useEffect, useMemo } from 'react'
import { subscribeToItems } from '../services/items'
import { useSession } from '../auth'
import type { Item } from '../types'

// The props this person may see. The owner gets everything (personal props
// included) unless previewing another role with "View as".
export function useItems() {
  const { realRole, viewingAs } = useSession()
  const [items, setItems] = useState<Item[]>([])
  const scope = realRole === 'owner' ? 'all' : 'company'
  useEffect(() => subscribeToItems(scope, setItems), [scope])
  return useMemo(() => viewingAs ? items.filter(i => i.collection === 'company') : items, [items, viewingAs])
}
