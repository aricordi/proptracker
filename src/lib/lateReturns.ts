// LATE RETURNS LOG (owner, Oct 27: new company-wide rule, a late return fee of 10% of the equipment's value; "keep an
// auditable log in the analytics of how many times creators have returned stuff late, per creator… we don't have to
// calculate the 10% yet, just track the lateness"). Gear carries the fee; props are logged too, with no fee for now.
// Pure: built from the analytics incidents (late-gear / late-props), so excused ones drop out like every other flag.
import type { Incident, LateInfo } from './analytics'
import { LATE_FEE_PERCENT, fmtMoney } from '../../functions/src/gearStock'
export { LATE_FEE_PERCENT, fmtMoney }

export type LateKind = 'gear' | 'props'
export interface LateRow { i: Incident; late: LateInfo; kind: LateKind }
export const lateRows = (incidents: Incident[]): LateRow[] => incidents
  .filter(i => (i.kind === 'late-gear' || i.kind === 'late-props') && i.late)
  .map(i => ({ i, late: i.late!, kind: (i.kind === 'late-gear' ? 'gear' : 'props') as LateKind }))
  .sort((a, b) => (b.late.dueAt).localeCompare(a.late.dueAt))

// "45 min", "2 h 10 min", "3 days 4 h"
export function lateFor(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  if (m < 48 * 60) { const h = Math.floor(m / 60), r = m % 60; return `${h} h${r ? ` ${r} min` : ''}` }
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return `${d} days${h ? ` ${h} h` : ''}`
}
// Studio stamp 'YYYY-MM-DDTHH:MM' → "Oct 27, 5:30 PM"
export function stampLabel(s: string): string {
  const [y, mo, d] = s.slice(0, 10).split('-').map(Number), h = Number(s.slice(11, 13)), mi = s.slice(14, 16)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1]
  void y
  return `${month} ${d}, ${h % 12 || 12}${mi === '00' ? '' : `:${mi}`} ${h < 12 ? 'AM' : 'PM'}`
}
export const valueLabel = (l: LateInfo) => l.value === null ? 'Value not recorded' : l.valueMissing && !l.value ? 'No value set' : `${fmtMoney(l.value)}${l.valueMissing ? ' (some pieces have no value)' : ''}`

export interface LatePerson { email: string; name: string; count: number; gear: number; props: number; stillOut: number; minutes: number; gearValue: number }
export function latePeople(rows: LateRow[]): LatePerson[] {
  const m = new Map<string, LatePerson>()
  for (const r of rows) {
    const p = m.get(r.i.email) ?? { email: r.i.email, name: r.i.name, count: 0, gear: 0, props: 0, stillOut: 0, minutes: 0, gearValue: 0 }
    p.count++; p[r.kind]++; p.minutes += r.late.minutes
    if (r.late.still) p.stillOut++
    if (r.kind === 'gear' && r.late.value) p.gearValue += r.late.value
    m.set(r.i.email, p)
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.minutes - a.minutes || a.name.localeCompare(b.name))
}
export function lateTotals(rows: LateRow[]) {
  const gear = rows.filter(r => r.kind === 'gear')
  return { count: rows.length, gear: gear.length, props: rows.length - gear.length, stillOut: rows.filter(r => r.late.still).length,
    gearValue: gear.reduce((n, r) => n + (r.late.value ?? 0), 0), people: new Set(rows.map(r => r.i.email)).size }
}

// The audit log as a spreadsheet (one line per late return; excused ones are listed separately by the caller).
export function lateCsv(rows: LateRow[], status: (r: LateRow) => string): string {
  const q = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const head = ['Shoot day', 'Creator', 'Email', 'What', 'Type', 'Due back', 'Brought back', 'Minutes late', 'How late', `Value ($)`, 'Pieces with no value', `Fee (${LATE_FEE_PERCENT}% of value)`, 'Status']
  const lines = rows.map(r => [r.i.date, r.i.name, r.i.email, r.i.text, r.kind === 'gear' ? 'Gear' : 'Props', stampLabel(r.late.dueAt),
    r.late.still ? 'Still out' : r.late.backAt ? stampLabel(r.late.backAt) : '', r.late.minutes, lateFor(r.late.minutes),
    r.late.value ?? '', r.late.valueMissing, r.kind === 'gear' ? 'Applies' : 'No fee (props, for now)', status(r)])
  return [head, ...lines].map(l => l.map(q).join(',')).join('\n')
}
