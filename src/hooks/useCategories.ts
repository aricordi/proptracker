import { useState, useEffect } from 'react'
import { subscribeToCategories } from '../services/categories'
import { DEFAULT_CATEGORIES } from '../config'
import type { Category } from '../types'

// Until an admin has opened the app once (which saves the defaults),
// show the default list so filters and pickers are never empty.
const FALLBACK: Category[] = DEFAULT_CATEGORIES.map((c, order) => ({ ...c, order, active: true }))

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([])
  useEffect(() => subscribeToCategories(setCategories), [])
  return categories.length > 0 ? categories : FALLBACK
}
