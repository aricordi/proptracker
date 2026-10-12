import { useState, useEffect } from 'react'
import { subscribeToCategories } from '../services/categories'
import type { Category } from '../types'

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([])
  useEffect(() => subscribeToCategories(setCategories), [])
  return categories
}
