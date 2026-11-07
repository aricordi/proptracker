// Prop insights for the arts department (owner, Nov 7: "what to buy duplicates of, what to move to Grab and Go, who damages
// props, who's responsible for missing ones… add anything else that would help them"). Pure (no Firebase), unit-tested.
//
// Everything is worked out from the props requests the app already keeps (reservations) and the props list:
//   • a REQUEST counts as demand unless the creator cancelled it (declined ones count: someone wanted it);
//   • its date is the day it was ASKED FOR (createdAt, studio time), so "this week" = what creators asked for this week;
//   • "ran out" = a shoot day on which every unit was booked (only props from the closet: builds aren't props yet);
//   • damage and loss = what the arts department marked at check-in (damaged = 1 unit, missing = the units missing),
//     on the creator who booked it;
//   • "wanted but booked" = a creator opened the prop while adding to their shoot and every unit was already booked that
//     day (prop_wants: one record per prop, shoot day and person, noted quietly by the prop page).
import type { Item } from '../types'
import type { Reservation } from '../services/reservations'
import { nameLikeness, nameWords } from '../../functions/src/doubles'

export type Period = '7d' | '30d' | '90d' | 'all'
export const PERIODS: { id: Period; label: string; days: number | null }[] = [
  { id: '7d', label: '7 days', days: 7 }, { id: '30d', label: '30 days', days: 30 }, { id: '90d', label: '90 days', days: 90 }, { id: 'all', label: 'All time', days: null },
]
export const TREND_DAYS = 14          // "trending" = the last 2 weeks vs the 2 weeks before
export const GRAB_DAYS = 90           // grab-and-go candidates look at the last 3 months
export const GRAB_MIN_REQUESTS = 3
export const GRAB_MIN_CREATORS = 2
export const BUY_MIN_FULL_DAYS = 2    // ran out on 2+ shoot days → "Buy another?"
export const BUY_MIN_WANTED = 2       // …or wanted 2+ times (person + day) while it was booked out

/** A creator opened this prop while adding to their shoot on `day`, and it was booked out (functions/src/propWants.ts). */
export interface PropWant { itemId: string; day: string; email: string }

/** 'YYYY-MM-DD' in studio time (Toronto) for an ISO time. */
export function studioDay(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso ?? '').slice(0, 10)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
}
export function addDaysTo(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

export interface PropStat { id: string; name: string; item?: Item; requests: number; units: number; creators: number; last: string }
export interface Unavailable {
  id: string; name: string; item?: Item; fullDays: number; cantFind: number; declined: number
  wantedWhileBooked: number   // records: one per person and shoot day
  wantedBy: number            // different people among them
  buyMore: boolean
}
export interface Wanted { key: string; label: string; requests: number; units: number; couldntGet: number; made: number; last: string }
export interface PersonLoss { email: string; name: string; incidents: number; units: number; value: number; valueMissing: boolean; props: { id: string; name: string; units: number; day: string; resId: string }[] }
export interface Trend { stat: PropStat; recent: number; before: number }
export interface CategoryRow { id: string; lines: number; units: number; props: number; perProp: number }
export interface Insights {
  from: string | null; to: string
  totals: { requests: number; units: number; props: number; creators: number; declined: number; catalogue: number; everBooked: number; damagedUnits: number; missingUnits: number; lossValue: number }
  mostBooked: PropStat[]
  trending: Trend[]
  unavailable: Unavailable[]
  wanted: Wanted[]
  grabAndGo: (PropStat & { perMonth: number })[]
  damagedBy: PersonLoss[]
  missingBy: PersonLoss[]
  damagedNow: Item[]
  missingNow: Item[]
  neverBooked: Item[]
  byCategory: CategoryRow[]
}

const counts = (r: Reservation) => r.status !== 'cancelled'

/** Follow "merged into" so a prop combined later still gets its old requests. */
function resolver(items: Item[]) {
  const byId = new Map(items.map(i => [i.id, i]))
  return (id: string): { id: string; item?: Item } => {
    let cur = id
    for (let n = 0; n < 6; n++) {
      const it = byId.get(cur)
      if (!it?.mergedInto || !byId.has(it.mergedInto)) return { id: cur, item: it }
      cur = it.mergedInto
    }
    return { id: cur, item: byId.get(cur) }
  }
}

/** A short key for "things we don't have" so "Fog machine", "fog machines" and "A fog machine!" count as one. */
export function wantedKey(text: string): string {
  return nameWords(text).slice(0, 6).join(' ')
}

/** Props for a list of requests: how many requests, units and creators each prop had (best first). */
function tally(rs: Reservation[], resolve: ReturnType<typeof resolver>): PropStat[] {
  const m = new Map<string, PropStat & { who: Set<string> }>()
  for (const r of rs) {
    const seen = new Set<string>()
    for (const l of r.lines ?? []) {
      const { id, item } = resolve(l.itemId)
      const s = m.get(id) ?? { id, name: item?.name ?? l.itemName, item, requests: 0, units: 0, creators: 0, last: '', who: new Set<string>() }
      if (!seen.has(id)) { s.requests++; seen.add(id) }
      s.units += Math.max(1, Number(l.qty) || 1)
      s.who.add(r.creatorEmail)
      const day = studioDay(r.createdAt)
      if (day > s.last) s.last = day
      m.set(id, s)
    }
  }
  return [...m.values()].map(({ who, ...s }) => ({ ...s, creators: who.size }))
    .sort((a, b) => b.requests - a.requests || b.units - a.units || b.last.localeCompare(a.last) || a.name.localeCompare(b.name))
}

export function propInsights(input: { items: Item[]; reservations: Reservation[]; wants?: PropWant[]; today: string; period: Period; highValue: number }): Insights {
  const { today, period, highValue } = input
  const items = input.items.filter(i => i.collection === 'company')
  const active = items.filter(i => !i.archived)
  const resolve = resolver(items)
  const days = PERIODS.find(p => p.id === period)?.days ?? null
  const from = days ? addDaysTo(today, -(days - 1)) : null
  const inPeriod = (day: string) => (!from || day >= from) && day <= today
  const all = input.reservations.filter(counts)
  const asked = all.filter(r => inPeriod(studioDay(r.createdAt)))
  const wanted = asked.filter(r => r.status !== 'declined')   // what actually went (or will go) out

  // Most booked (in the period).
  const mostBooked = tally(asked, resolve)

  // Trending: the last 2 weeks against the 2 weeks before (whatever period is picked).
  const recentFrom = addDaysTo(today, -(TREND_DAYS - 1)), beforeFrom = addDaysTo(today, -(TREND_DAYS * 2 - 1))
  const recent = tally(all.filter(r => { const d = studioDay(r.createdAt); return d >= recentFrom && d <= today }), resolve)
  const beforeBy = new Map(tally(all.filter(r => { const d = studioDay(r.createdAt); return d >= beforeFrom && d < recentFrom }), resolve).map(s => [s.id, s.requests]))
  const trending = recent.map(stat => ({ stat, recent: stat.requests, before: beforeBy.get(stat.id) ?? 0 }))
    .filter(t => t.recent >= 2 && t.recent > t.before)
    .sort((a, b) => (b.recent - b.before) - (a.recent - a.before) || b.recent - a.recent || a.stat.name.localeCompare(b.stat.name))

  // Ran out / couldn't be found / turned away.
  const un = new Map<string, Unavailable>()
  const unOf = (raw: string, name: string) => {
    const { id, item } = resolve(raw)
    const u = un.get(id) ?? { id, name: item?.name ?? name, item, fullDays: 0, cantFind: 0, declined: 0, wantedWhileBooked: 0, wantedBy: 0, buyMore: false }
    un.set(id, u)
    return u
  }
  const perDay = new Map<string, number>()   // itemId|day → units booked that shoot day
  for (const r of all) {
    if (r.status === 'declined') continue
    let day = r.startDate
    for (let n = 0; day <= (r.endDate || r.startDate) && n < 31; n++, day = addDaysTo(day, 1)) {
      if (from && day < from) continue
      for (const l of r.lines ?? []) {
        const { id } = resolve(l.itemId)
        const k = `${id}|${day}`
        perDay.set(k, (perDay.get(k) ?? 0) + Math.max(1, Number(l.qty) || 1))
      }
    }
  }
  const byId = new Map(items.map(i => [i.id, i]))
  for (const [k, units] of perDay) {
    const [id] = k.split('|')
    const it = byId.get(id)
    if (it && units >= Math.max(1, it.quantity - (it.missingQty ?? 0))) unOf(id, it.name).fullDays++
  }
  // Wanted while booked out: counted on the shoot day, like "ran out" (Prime Capitol props only).
  const wantedBy = new Map<string, Set<string>>()
  for (const w of input.wants ?? []) {
    if (from && w.day < from) continue
    const it = byId.get(w.itemId)
    if (!it) continue
    const u = unOf(w.itemId, it.name)
    u.wantedWhileBooked++
    const who = wantedBy.get(u.id) ?? new Set<string>()
    who.add(w.email); wantedBy.set(u.id, who)
  }
  for (const r of asked) {
    for (const l of r.lines ?? []) {
      if (l.pick?.state === 'unavailable') unOf(l.itemId, l.itemName).cantFind++
      if (r.status === 'declined') unOf(l.itemId, l.itemName).declined++
    }
  }
  const unScore = (u: Unavailable) => u.fullDays + 2 * u.cantFind + u.declined + u.wantedWhileBooked
  const unavailable = [...un.values()].map(u => ({ ...u, wantedBy: wantedBy.get(u.id)?.size ?? 0,
    buyMore: u.fullDays >= BUY_MIN_FULL_DAYS || (u.fullDays >= 1 && u.declined >= 1) || u.wantedWhileBooked >= BUY_MIN_WANTED }))
    .filter(u => unScore(u) > 0 && (!u.item || !u.item.archived))
    .sort((a, b) => unScore(b) - unScore(a) || a.name.localeCompare(b.name))

  // Things creators asked us to make or find (build requests).
  const w = new Map<string, Wanted>()
  for (const r of asked) for (const b of r.builds ?? []) {
    const key = wantedKey(b.description)
    if (!key) continue
    const x = w.get(key) ?? { key, label: '', requests: 0, units: 0, couldntGet: 0, made: 0, last: '' }
    const day = studioDay(r.createdAt)
    x.requests++; x.units += Math.max(1, Number(b.qty) || 1)
    if (b.state === 'unavailable') x.couldntGet++
    if (b.state === 'done') x.made++
    if (day >= x.last) { x.last = day; x.label = String(b.description ?? '').trim().slice(0, 80) }
    w.set(key, x)
  }
  const wantedList = [...w.values()].sort((a, b) => b.requests - a.requests || b.couldntGet - a.couldntGet || b.last.localeCompare(a.last))

  // Grab-and-go: asked for often, by different creators, low value, in good shape (last 90 days, whatever the period).
  const grabFrom = addDaysTo(today, -(GRAB_DAYS - 1))
  const grabAndGo = tally(all.filter(r => r.status !== 'declined' && studioDay(r.createdAt) >= grabFrom && studioDay(r.createdAt) <= today), resolve)
    .filter(s => s.item && !s.item.archived && s.item.condition !== 'damaged' && (s.item.replacementCost ?? 0) < highValue
      && s.requests >= GRAB_MIN_REQUESTS && s.creators >= GRAB_MIN_CREATORS)
    .map(s => ({ ...s, perMonth: Math.round((s.requests / (GRAB_DAYS / 30)) * 10) / 10 }))

  // Damage and loss, on the creator who booked it (dated by the check-in).
  const loss = (result: 'damaged' | 'missing') => {
    const m = new Map<string, PersonLoss>()
    for (const r of all) for (const l of r.lines ?? []) {
      if (l.checkIn?.result !== result) continue
      const day = studioDay(l.checkIn.at || r.checkedInAt || r.endDate)
      if (!inPeriod(day)) continue
      const { id, item } = resolve(l.itemId)
      const units = result === 'missing' ? Math.max(1, Number(l.checkIn.missingQty) || 1) : 1
      const p = m.get(r.creatorEmail) ?? { email: r.creatorEmail, name: r.creatorName || r.creatorEmail.split('@')[0], incidents: 0, units: 0, value: 0, valueMissing: false, props: [] }
      p.incidents++; p.units += units
      if (item?.replacementCost != null) p.value += item.replacementCost * units; else p.valueMissing = true
      p.props.push({ id, name: item?.name ?? l.itemName, units, day, resId: r.id })
      m.set(r.creatorEmail, p)
    }
    return [...m.values()].map(p => ({ ...p, props: p.props.sort((a, b) => b.day.localeCompare(a.day)) }))
      .sort((a, b) => b.units - a.units || b.value - a.value || a.name.localeCompare(b.name))
  }
  const damagedBy = loss('damaged'), missingBy = loss('missing')

  // Right now.
  const damagedNow = active.filter(i => i.condition === 'damaged' || (i.status as string) === 'damaged').sort((a, b) => (b.replacementCost ?? 0) - (a.replacementCost ?? 0))
  const missingNow = active.filter(i => (i.missingQty ?? 0) > 0).sort((a, b) => (b.missingQty ?? 0) - (a.missingQty ?? 0))

  // Never asked for (ever): the oldest first, they've had the longest chance.
  const everIds = new Set<string>()
  for (const r of all) for (const l of r.lines ?? []) everIds.add(resolve(l.itemId).id)
  const neverBooked = active.filter(i => !everIds.has(i.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  // By category: requests per prop in that category.
  const cats = new Map<string, CategoryRow>()
  for (const i of active) { const c = cats.get(i.categoryId) ?? { id: i.categoryId, lines: 0, units: 0, props: 0, perProp: 0 }; c.props++; cats.set(i.categoryId, c) }
  for (const r of wanted) for (const l of r.lines ?? []) {
    const { item } = resolve(l.itemId)
    if (!item) continue
    const c = cats.get(item.categoryId) ?? { id: item.categoryId, lines: 0, units: 0, props: 0, perProp: 0 }
    c.lines++; c.units += Math.max(1, Number(l.qty) || 1); cats.set(item.categoryId, c)
  }
  const byCategory = [...cats.values()].map(c => ({ ...c, perProp: c.props ? Math.round((c.lines / c.props) * 100) / 100 : 0 }))
    .filter(c => c.lines > 0 || c.props > 0).sort((a, b) => b.lines - a.lines || b.props - a.props)

  const lossUnits = (l: PersonLoss[]) => l.reduce((n, p) => n + p.units, 0)
  return {
    from, to: today,
    totals: {
      requests: asked.length, units: wanted.reduce((n, r) => n + (r.lines ?? []).reduce((m, l) => m + Math.max(1, Number(l.qty) || 1), 0), 0),
      props: tally(wanted, resolve).length, creators: new Set(asked.map(r => r.creatorEmail)).size,
      declined: asked.filter(r => r.status === 'declined').length,
      catalogue: active.length, everBooked: active.filter(i => everIds.has(i.id)).length,
      damagedUnits: lossUnits(damagedBy), missingUnits: lossUnits(missingBy),
      lossValue: [...damagedBy, ...missingBy].reduce((n, p) => n + p.value, 0),
    },
    mostBooked, trending, unavailable, wanted: wantedList, grabAndGo, damagedBy, missingBy, damagedNow, missingNow, neverBooked, byCategory,
  }
}

/** How long ago, in plain words ("today", "3 days ago", "5 weeks ago"). */
export function agoLabel(day: string, today: string): string {
  const n = daysBetween(day, today)
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  if (n < 14) return `${n} days ago`
  if (n < 70) return `${Math.round(n / 7)} weeks ago`
  return `${Math.round(n / 30)} months ago`
}

/** Props that share tags and the category with this one (when smart search has nothing for it yet). */
export function similarByTags(item: Item, pool: Item[], max = 8): Item[] {
  const tags = new Set(item.tags ?? [])
  return pool.filter(o => o.id !== item.id).map(o => {
    const shared = (o.tags ?? []).filter(t => tags.has(t)).length
    return { o, shared, s: shared * 2 + (o.categoryId === item.categoryId ? 1 : 0) + 2 * nameLikeness(item.name, o.name) }
  }).filter(x => x.s >= 3 && (x.shared > 0 || x.o.categoryId === item.categoryId))
    .sort((a, b) => b.s - a.s || a.o.name.localeCompare(b.o.name)).slice(0, max).map(x => x.o)
}
