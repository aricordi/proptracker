// Shared bits of the connector (tools.ts + more.ts), kept apart so the two never load each other in a loop.
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { db, getCaller, type Caller } from '../auth.js'
import { collectionOf } from '../collections.js'
import { freeForRange, todayInStudio, type BookingEntry } from '../booking.js'
import { loadSettings } from '../reservations.js'

export interface McpUser { email: string; name: string; assistant: string; reviewer?: boolean; sandboxKey?: string }
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

/** A whole number from the assistant, kept between lo and hi (anything odd → the default). */
export const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => Number.isInteger(v) ? Math.min(hi, Math.max(lo, v as number)) : dflt
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
// Writes that also reach other people or outside systems (notifications to the team or friends, Google Calendar).
export const WRITE_OUT = { readOnlyHint: false, openWorldHint: true, destructiveHint: false }
export const DESTRUCTIVE_OUT = { readOnlyHint: false, openWorldHint: true, destructiveHint: true }
export const DESTRUCTIVE = { readOnlyHint: false, openWorldHint: false, destructiveHint: true }
export const obj = (properties: Json, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

// People are named to the assistant by an anonymous id, never by email (privacy policy: "never other people's emails").
import { createHmac, randomBytes } from 'node:crypto'
import { resolvePerson, type PersonMatch } from './understand.js'
// A secret kept on the server (mcp_settings/people), so nobody can work out a person id from an email list.
let PEOPLE_KEY = ''
export async function ensurePeopleKey() {
  if (PEOPLE_KEY) return
  const ref = db.doc('mcp_settings/people')
  PEOPLE_KEY = await db.runTransaction(async tx => {
    const k = String((await tx.get(ref)).get('key') ?? '')
    if (k) return k
    const fresh = randomBytes(24).toString('hex')
    tx.set(ref, { key: fresh, at: new Date().toISOString() })
    return fresh
  })
}
export const personId = (email: string) => `p_${createHmac('sha256', PEOPLE_KEY || 'unset').update(email.toLowerCase()).digest('hex').slice(0, 12)}`
/** A name or a person id → who it is (one), several people (many), a likely typo/loose match to confirm (maybe), or nobody.
 *  Nicknames, first/last names and the start of a first name count; email addresses never do. */
export function matchPerson<T extends { email: string; name: string }>(people: T[], said: string, me: string): PersonMatch<T> {
  return resolvePerson(people, said, me, (p, id) => personId(p.email) === id)
}
/** What to ask the person when a name didn't land on exactly one person (null = it did). */
export function askWho(said: string, m: PersonMatch<{ email: string; name: string }>): string | null {
  if (m.status === 'one') return null
  if (m.status === 'many') return `More than one person could be "${said}": ${describePeople(m.hits)}. Ask which one, then pass their person id.`
  if (m.status === 'maybe') return `Nobody is called exactly "${said}". Did they mean ${describePeople(m.hits)}? Ask, then pass the person id.`
  return `Nobody called "${said}" uses the app.`
}
export const describePeople = (hits: { email: string; name: string }[]) => hits.map(h => `${h.name} (${personId(h.email)})`).join(', ')

/** Read one doc by an id the assistant gave; a missing or odd id (empty, slashes) is simply "not found" instead of a crash. */
export async function docById(col: string, id: unknown) {
  const v = typeof id === 'string' ? id.trim() : ''
  if (!/^[\w-]{1,100}$/.test(v)) return undefined
  return (await db.doc(`${col}/${v}`).get()).data()
}
