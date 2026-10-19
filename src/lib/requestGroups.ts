// "My requests" (owner, Oct 20): props and gear requests lumped together by shoot.
// A request linked to one of your booked shoots goes under that shoot; anything else (older requests,
// or a shoot that was cancelled) goes under its shoot day, so props + gear for the same day still sit together.
const DONE = ['returned', 'checked_in', 'cancelled', 'declined']

export interface PropsReq { id: string; status: string; startDate: string; shootId?: string; scheduleShootId?: string }
export interface GearReq { id: string; status: string; date: string; shootId?: string; scheduleShootId?: string }
export interface ShootRef { id: string; date: string; from: string }

export interface RequestGroup<P, G, S> {
  key: string
  date: string
  shoot?: S
  props: P[]
  gear: G[]
  open: boolean     // something still to happen (not returned / checked in / cancelled / declined)
}

export function groupByShoot<P extends PropsReq, G extends GearReq, S extends ShootRef>(
  props: P[], gear: G[], shoots: S[], today: string,
): { upcoming: RequestGroup<P, G, S>[]; past: RequestGroup<P, G, S>[] } {
  const byId = new Map(shoots.map(s => [s.id, s]))
  const groups = new Map<string, RequestGroup<P, G, S>>()
  const at = (shootIds: (string | undefined)[], date: string) => {
    const shoot = shootIds.map(id => id && byId.get(id)).find(Boolean) as S | undefined
    const key = shoot ? shoot.id : `day:${date}`
    let g = groups.get(key)
    if (!g) { g = { key, date: shoot?.date ?? date, shoot, props: [], gear: [], open: false }; groups.set(key, g) }
    return g
  }
  for (const p of props) { const g = at([p.scheduleShootId, p.shootId], p.startDate); g.props.push(p); if (!DONE.includes(p.status)) g.open = true }
  for (const r of gear) { const g = at([r.scheduleShootId, r.shootId], r.date); g.gear.push(r); if (!DONE.includes(r.status)) g.open = true }
  const all = [...groups.values()]
  const when = (g: RequestGroup<P, G, S>) => g.shoot?.from ?? g.date
  // Upcoming = the shoot day hasn't passed, or something is still out / not checked in. Soonest first.
  const upcoming = all.filter(g => g.date >= today || g.open).sort((a, b) => when(a).localeCompare(when(b)))
  const past = all.filter(g => !(g.date >= today || g.open)).sort((a, b) => when(b).localeCompare(when(a)))
  return { upcoming, past }
}
