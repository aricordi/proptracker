import { useState, useEffect } from 'react'
import { subscribeToTags } from '../services/tags'
import type { Tag } from '../types'

export function useTags() {
  const [tags, setTags] = useState<Tag[]>([])
  useEffect(() => subscribeToTags(setTags), [])
  return tags
}
