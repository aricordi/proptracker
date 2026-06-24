import { useState, useEffect } from 'react'
import { subscribeToVideoChecklists } from '../services/videoChecklists'
import type { VideoChecklist } from '../types'

export function useVideoChecklists(): VideoChecklist[] {
  const [checklists, setChecklists] = useState<VideoChecklist[]>([])
  useEffect(() => subscribeToVideoChecklists(setChecklists), [])
  return checklists
}
