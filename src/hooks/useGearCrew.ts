// Friends filming back to back with one of your shoots (same day, same place), for sharing gear (owner, Oct 20).
import { useMemo } from 'react'
import { useScheduleDays, useScheduleSettings, type Shoot } from '../services/schedule'
import { backToBack, type CrewShoot } from '../../functions/src/gearCrew'

export function useBackToBack(shoot: Shoot | null): CrewShoot[] {
  const days = useScheduleDays(shoot?.date ?? '0000-00-00', shoot?.date ?? '0000-00-00')
  const { slotMinutes } = useScheduleSettings()
  return useMemo(() => {
    if (!shoot || !days) return []
    const day = days[shoot.date]
    if (!day) return []
    const all = new Map<string, CrewShoot>()
    if (shoot.place === 'offsite') {
      for (const o of day.offsite ?? []) if (o.shootId && o.email) all.set(o.shootId, { id: o.shootId, email: o.email, name: o.name, date: shoot.date, place: 'offsite', start: o.start, end: o.end })
    } else {
      for (const [k, e] of Object.entries(day[shoot.place] ?? {})) {
        if (!e.shootId || !e.email || all.has(e.shootId)) continue
        const start = e.time?.start ?? Number(k), end = e.time?.end ?? Number(k) + slotMinutes
        all.set(e.shootId, { id: e.shootId, email: e.email, name: e.name, date: shoot.date, place: shoot.place, start, end })
      }
    }
    const mine: CrewShoot = { id: shoot.id, email: shoot.creatorEmail, name: shoot.creatorName, date: shoot.date, place: shoot.place, start: shoot.start, end: shoot.end }
    return backToBack(mine, [...all.values()])
  }, [shoot, days, slotMinutes])
}
