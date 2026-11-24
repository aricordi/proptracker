// Shared bits of the connector (tools.ts + more.ts), kept apart so the two never load each other in a loop.
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { db, getCaller, type Caller } from '../auth.js'
import { collectionOf } from '../collections.js'
import { freeForRange, todayInStudio, type BookingEntry } from '../booking.js'
import { loadSettings } from '../reservations.js'

export interface McpUser { email: string; name: string; assistant: string; reviewer?: boolean }
/** OpenAI's app reviewers' demo account (practice copy of the studio; never a real person). */
export const REVIEWER_EMAIL = 'reviewer@demo.primecapitol.app'
export type Json = Record<string, unknown>
export interface ToolResult { text: string; structured?: Json; images?: { url: string; caption: string }[]; widget?: boolean }

// Run one of the app's own server functions AS this person.
export function asUser<T>(u: McpUser, data: T): CallableRequest<T> {
  return { data, auth: { uid: `mcp:${u.email}`, token: { email: u.email, email_verified: true, name: u.name } }, rawRequest: {}, acceptsStreaming: false } as unknown as CallableRequest<T>
}
export async function callerOf(u: McpUser): Promise<Caller> {
  const c = await getCaller(asUser(u, {}))
  if (!c) throw new HttpsError('permission-denied', 'Your Prime Capitol access is turned off. Ask the owner or an admin.')
  return c
}

export const s = (v: unknown, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : ''
export const firstName = (n: string) => String(n || '').split(/\s+/)[0]
export const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
// "13:15", "1:15 pm", "1315" → minutes after midnight (null if unreadable). After-midnight times may be given as 24:00–25:59.
export function parseClock(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  const t = s(v, 20).toLowerCase().replace(/\s+/g, '')
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/.exec(t)
  if (!m) return null
  let h = Number(m[1]); const min = Number(m[2] ?? 0)
  if (min > 59 || h > 25) return null
  if (m[3] === 'pm' && h < 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  return h * 60 + min
}

// ─── The props closet (company props only; cached a few minutes per server copy) ─────────────────────────────────────
export interface Prop { id: string; name: string; category: string; tags: string[]; description: string; words: string; quantity: number; missing: number; damaged: boolean; photo: string; photos: string[]; createdAt: string }
let closet: { at: number; props: Prop[] } | null = null
export async function loadCloset(): Promise<Prop[]> {
  if (closet && Date.now() - closet.at < 5 * 60_000) return closet.props
  const [items, cats, tags] = await Promise.all([
    db.collection('items').where('collection', '==', 'company').get(), db.collection('categories').get(), db.collection('tags').get(),
  ])
  const catLabel = new Map(cats.docs.map(d => [d.id, String(d.get('label') ?? d.id)]))
  const tagLabel = new Map(tags.docs.map(d => [d.id, String(d.get('label') ?? d.id)]))
  const props: Prop[] = []
  for (const d of items.docs) {
    const x = d.data()
    if (x.archived || x.mergedInto || collectionOf(x) !== 'company') continue
    const photos: string[] = Array.isArray(x.photos) ? x.photos.filter((p: unknown) => typeof p === 'string') : []
    const thumbs = (x.thumbs ?? {}) as Record<string, string>
    props.push({
      id: d.id, name: String(x.name ?? 'Prop'), category: catLabel.get(x.categoryId ?? x.itemType) ?? '',
      tags: (Array.isArray(x.tags) ? x.tags : []).map((t: string) => tagLabel.get(t) ?? t).slice(0, 12),
      description: String(x.description ?? '').slice(0, 400), words: Array.isArray(x.searchWords) ? x.searchWords.join(', ').slice(0, 300) : '',
      quantity: Number(x.quantity ?? 1), missing: Number(x.missingQty ?? 0), damaged: x.condition === 'damaged',
      photo: photos[0] ? (thumbs[photos[0]] ?? photos[0]) : '', photos: photos.slice(0, 4), createdAt: String(x.createdAt ?? ''),
    })
  }
  closet = { at: Date.now(), props }
  return props
}
export const short = (p: Prop) => ({ id: p.id, name: p.name, category: p.category, how_many: Math.max(0, p.quantity - p.missing), photo: p.photo || null })

// How many of each prop are free on a day (props are booked by the day; one shoot day each).
export async function freeOn(day: string, ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {}
  const settings = await loadSettings()
  const books = await db.getAll(...ids.map(id => db.doc(`item_bookings/${id}`)))
  const items = new Map((await loadCloset()).map(p => [p.id, p]))
  const today = todayInStudio(), out: Record<string, number> = {}
  ids.forEach((id, i) => {
    const p = items.get(id)
    if (!p) return
    out[id] = freeForRange({ quantity: p.quantity, missingQty: p.missing, legacyCheckedOut: false },
      (books[i].get('entries') ?? []) as BookingEntry[], day, day, today, settings.bufferDays, settings)
  })
  return out
}

export const READ = { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
export const WRITE = { readOnlyHint: false, openWorldHint: false, destructiveHint: false }
export const DESTRUCTIVE = { readOnlyHint: false, openWorldHint: false, destructiveHint: true }
export const obj = (properties: Json, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
