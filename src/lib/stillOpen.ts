// Owner, Nov 8 (option A): a creator can't be switched back to Props only while they still have something going on in the
// full app (Props-only people can't see shoots, requests or gear, so they'd be stuck with them). Pure, tested.
export interface OpenThings { shoots: string[]; props: number; gear: number }

type Shoot = { status?: string; date?: string }
type Res = { status?: string }
type Gear = { status?: string }

// Shoots booked or waiting for approval from today on; props requests not yet brought back (once returned, the rest is the
// arts team's check-in); gear held or out.
export function stillOpen(shoots: Shoot[], props: Res[], gear: Gear[], today: string): OpenThings {
  return {
    shoots: shoots.filter(s => (s.status === 'booked' || s.status === 'requested') && String(s.date ?? '') >= today)
      .map(s => String(s.date)).sort(),
    props: props.filter(r => ['requested', 'preparing', 'packed', 'collected'].includes(String(r.status))).length,
    gear: gear.filter(g => g.status === 'held' || g.status === 'out').length,
  }
}

export const nothingOpen = (o: OpenThings) => !o.shoots.length && !o.props && !o.gear

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
// "2 shoots coming up (Fri, Nov 14 + 1 more) · 1 props request not brought back · 1 gear booking"
export function openText(o: OpenThings, dayLabel: (d: string) => string): string {
  const parts: string[] = []
  if (o.shoots.length) parts.push(`${plural(o.shoots.length, 'shoot')} coming up (${dayLabel(o.shoots[0])}${o.shoots.length > 1 ? ` + ${o.shoots.length - 1} more` : ''})`)
  if (o.props) parts.push(`${plural(o.props, 'props request')} not brought back yet`)
  if (o.gear) parts.push(`${plural(o.gear, 'gear booking')} held or out`)
  return parts.join(' · ')
}
