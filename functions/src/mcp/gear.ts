// Gear through ChatGPT / Claude (owner, Nov 24: "if they ask ChatGPT, is there a camera available… it should answer, remind
// them to take a picture before picking it up… act like our agent"). Same rules as the app's grab-and-go (gearBookings.ts):
// gear is never booked ahead; on the shoot day, from an hour before an APPROVED shoot, the creator takes what's free, checks
// every piece and sends one photo; it comes back with one photo (everything in the case, batteries charging).
// Photos come from the chat (ChatGPT file servers only, or the creator's own folder) and keep their taken-date (refImage.ts).
import { db } from '../auth.js'
import { nowStamp, addMinutes, freeQty, checkLines, GEAR_TAKE_BEFORE_MINUTES, fmtTime, type GearHold } from '../gearBooking.js'
import { todayInStudio } from '../booking.js'
import { byCount } from '../gearStock.js'
import { takeGear, returnGear } from '../gearBookings.js'
import { asUser, docById, s, objs, hm, READ, WRITE_OUT, obj, type Json, type McpUser, type ToolResult } from './common.js'
import { savePhoto } from './refImage.js'

const APP_URL = 'https://proptracker.arbcreative.co'
const PLACE: Record<string, string> = { cliff1: 'Cliff 1', cliff2: 'Cliff 2', offsite: 'Offsite' }
const PHOTO = { type: 'object', properties: { download_url: { type: 'string' }, file_id: { type: 'string' } } }
const stampAt = (date: string, min: number) => addMinutes(`${date}T00:00`, min)
const niceStamp = (st: string) => `${st.slice(5, 10).replace('-', '/')} ${fmtTime(Number(st.slice(11, 13)) * 60 + Number(st.slice(14, 16)))}`
const plain = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

export const GEAR_TOOLS = [
  { name: 'gear_available', title: 'What gear is free', annotations: READ,
    description: 'Gear (camera kits, lights, sound, single pieces) and how many are free for one of the person\'s shoots (default: their next approved shoot), with photos, what is in each kit and when they can take it. Gear is never booked ahead: it is taken on the shoot day, first come first served, from an hour before an approved shoot. Use it for "is there a camera free?".',
    inputSchema: obj({ shoot_id: { type: 'string', description: 'Shoot id from get_context or my_shoots (left out = their next approved shoot)' }, search: { type: 'string', description: 'Optional: what they want, e.g. "camera", "FX3", "light"' } }) },
  { name: 'take_gear', title: 'Take gear for the shoot (with a photo)', annotations: WRITE_OUT,
    description: 'On the shoot day (from an hour before an approved shoot until it ends): the person takes gear. Before calling, list every piece in what they picked and ask them to check each one is in the bag (any missing piece goes in `missing` so it isn\'t on them), then ask for ONE photo of the gear taken right now and attached in this chat. Confirm, then call. The reply says when it is due back.',
    inputSchema: obj({ shoot_id: { type: 'string', description: 'Shoot id (left out = their shoot happening now)' },
      items: { type: 'array', maxItems: 12, items: obj({ gear: { type: 'string', description: 'Kit or piece name (or id) from gear_available' }, qty: { type: 'integer', minimum: 1 } }, ['gear']) },
      all_pieces_there: { type: 'boolean', description: 'true once they checked every piece' },
      missing: { type: 'array', maxItems: 30, items: { type: 'string' }, description: 'Pieces that are NOT there (names as listed; "2 battery" for two of the same piece)' },
      photo: { ...PHOTO, description: 'The photo of the gear they attached in this chat' } }, ['items', 'photo']) },
  { name: 'return_gear', title: 'Return gear (with a photo)', annotations: WRITE_OUT,
    description: 'Return gear that is out with the person: ONE photo of everything back in the case with the batteries charging, taken now and attached in this chat. Ask if anything broke (damage) and whether the batteries / charging case are plugged in. Confirm, then call.',
    inputSchema: obj({ booking_id: { type: 'string', description: 'Gear booking id from my_status (left out = the only gear they have out)' },
      photo: { ...PHOTO, description: 'The return photo they attached in this chat' },
      charging: { type: 'boolean', description: 'Batteries / charging case plugged in?' },
      damage: { type: 'array', maxItems: 20, items: obj({ piece: { type: 'string' }, note: { type: 'string' } }, ['piece']) } }, ['photo']) },
]
export const GEAR_TOOL_NAMES = new Set(GEAR_TOOLS.map(t => t.name))

interface Offer { id: string; name: string; kind: 'bundle' | 'extra'; category: string; photo: string; offered: number; pieces: { itemId: string; qty: number; name: string }[]; housesOnly: boolean; usualHouse: string; missing: string[]; entries: GearHold[] }
async function offers(): Promise<Offer[]> {
  const snap = await db.collection('gear_bundles').where('archived', '==', false).get().catch(() => null)
  const docs = snap?.docs.length ? snap.docs : (await db.collection('gear_bundles').get()).docs.filter(d => d.get('archived') !== true)
  const holds = docs.length ? await db.getAll(...docs.map(d => db.doc(`gear_holds/${d.id}`))) : []
  return docs.map((d, i) => {
    const x = d.data(), kind = byCount(x.kind) ? 'extra' as const : 'bundle' as const
    const pieces = ((x.pieces ?? []) as { itemId: string; qty: number; name?: string }[]).map(p => ({ itemId: p.itemId, qty: Number(p.qty) || 1, name: String(p.name ?? '') }))
    return { id: d.id, name: String(x.name ?? 'Gear'), kind, category: String(x.category ?? ''), photo: ((x.photos ?? []) as string[])[0] ?? '',
      offered: kind === 'extra' ? (pieces[0]?.qty ?? 0) : 1, pieces, housesOnly: x.housesOnly === true, usualHouse: String(x.usualHouse ?? ''),
      missing: ((x.missing ?? []) as { name?: string }[]).map(m => String(m.name ?? 'a piece')), entries: ((holds[i]?.get('entries') ?? []) as GearHold[]) }
  })
}

async function myShoot(u: McpUser, id: string) {
  if (id) { const sh = await docById('shoots', id); return sh && sh.creatorEmail === u.email ? { id, ...sh } as Json & { id: string } : null }
  const today = todayInStudio(), now = nowStamp()
  const snap = await db.collection('shoots').where('creatorEmail', '==', u.email).where('date', '>=', today).get()
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Json & { id: string }))
    .filter(x => x.status === 'booked' && stampAt(String(x.date), Number(x.end)) > now)
    .sort((a, b) => `${a.date}${String(a.start).padStart(4, '0')}`.localeCompare(`${b.date}${String(b.start).padStart(4, '0')}`))[0] ?? null
}
const shootLabel = (sh: Json) => `${PLACE[String(sh.place)] ?? sh.place} ${sh.date} ${hm(Number(sh.start))}–${hm(Number(sh.end))}`

/** "fx3", "the camera kit", an id → that offer (or the choices when it's unclear). */
export function offerFor(said: unknown, list: { id: string; name: string; category?: string }[]): { hit?: string; options?: string[] } {
  const raw = plain(String(said ?? ''))
  if (!raw) return { options: list.map(o => o.name) }
  const byId = list.find(o => o.id === String(said).trim())
  if (byId) return { hit: byId.id }
  const exact = list.filter(o => plain(o.name) === raw)
  if (exact.length === 1) return { hit: exact[0].id }
  const words = raw.split(' ').filter(w => w.length > 1 && !['the', 'a', 'kit', 'one', 'my', 'some'].includes(w))
  const hits = list.filter(o => { const n = plain(`${o.name} ${o.category ?? ''}`); return words.length > 0 && words.every(w => n.includes(w.replace(/s$/, ''))) })
  return hits.length === 1 ? { hit: hits[0].id } : { options: (hits.length ? hits : list).slice(0, 10).map(o => o.name) }
}

export async function runGearTool(name: string, a: Json, u: McpUser): Promise<ToolResult | null> {
  if (!GEAR_TOOL_NAMES.has(name)) return null
  if (u.practice && name !== 'gear_available') return { text: 'Practice mode: gear would be taken or returned here (pieces ticked, one photo). Nothing was recorded and the equipment team wasn\'t told. Turn practice mode off in the app when you\'re done.', structured: { practice_mode: true } }
  if (u.reviewer) return { text: 'The demo account has no gear room: gear is taken and returned on the shoot day by real creators. (Demo account: nothing is sent to the studio team.)' }
  if (name === 'return_gear') return returnIt(a, u)
  const sh = await myShoot(u, s(a.shoot_id, 100))
  const list = await offers()
  const now = nowStamp()
  if (name === 'gear_available') {
    const from = sh ? (stampAt(String(sh.date), Number(sh.start)) > now ? stampAt(String(sh.date), Number(sh.start)) : now) : now
    const to = sh ? stampAt(String(sh.date), Number(sh.end)) : addMinutes(now, 120)
    const want = plain(s(a.search, 80))
    const rows = list.filter(o => !want || want.split(' ').every(w => plain(`${o.name} ${o.category} ${o.pieces.map(p => p.name).join(' ')}`).includes(w.replace(/s$/, ''))))
      .map(o => ({ id: o.id, name: o.name, category: o.category, kind: o.kind === 'bundle' ? 'kit' : 'single item', photo: o.photo || null,
        how_many: o.offered, free_that_day: freeQty(o.offered, o.entries, from, to),
        in_the_kit: o.kind === 'bundle' ? o.pieces.map(p => `${p.name || 'piece'}${p.qty > 1 ? ` x${p.qty}` : ''}`) : undefined,
        houses_only: o.housesOnly || undefined, usual_for: PLACE[o.usualHouse] || undefined, known_missing: o.missing.length ? o.missing : undefined,
        offsite_not_allowed: sh?.place === 'offsite' && o.housesOnly ? true : undefined }))
      .sort((x, y) => Number(y.free_that_day > 0) - Number(x.free_that_day > 0) || (x.kind === y.kind ? 0 : x.kind === 'kit' ? -1 : 1))
    const opens = sh ? addMinutes(stampAt(String(sh.date), Number(sh.start)), -GEAR_TAKE_BEFORE_MINUTES) : ''
    const when = !sh ? 'They have no approved shoot coming up: gear is only taken for an approved shoot, on its day.'
      : now < opens ? `For ${shootLabel(sh)}: they can take gear from ${niceStamp(opens)} (an hour before). Free now doesn't hold it: first come, first served.`
      : `For ${shootLabel(sh)}: they can take it now (take_gear), until the shoot ends.`
    return { text: `${when}\n${rows.map(r => `${r.name} (${r.kind}): ${r.free_that_day > 0 ? `${r.free_that_day} free` : 'taken'}${r.houses_only ? ', houses only' : ''}${r.known_missing ? `, missing: ${r.known_missing.join(', ')}` : ''}${r.in_the_kit ? ` · in it: ${r.in_the_kit.join(', ')}` : ''}`).join('\n') || 'No gear matches that.'}`,
      structured: { shoot: sh ? { id: sh.id, label: shootLabel(sh) } : null, can_take_from: opens ? niceStamp(opens) : null, props: rows }, widget: true }
  }
  // take_gear
  if (!sh) return { text: 'Gear is taken for an approved shoot on its day. They have none coming up (my_shoots).' }
  if (sh.status !== 'booked') return { text: 'That shoot is still waiting for approval: gear can be taken once it is approved.' }
  const picked: { offerId: string; qty: number }[] = [], unclear: string[] = []
  for (const it of objs(a.items)) {
    const f = offerFor(it.gear, list)
    if (!f.hit) { unclear.push(`"${s(it.gear, 60)}" (could be: ${(f.options ?? []).join(', ')})`); continue }
    const o = list.find(x => x.id === f.hit)!
    picked.push({ offerId: o.id, qty: o.kind === 'bundle' ? 1 : Math.max(1, Math.min(o.offered, Number(it.qty) || 1)) })
  }
  if (unclear.length) return { text: `Which gear? ${unclear.join('; ')}.`, structured: { needs_clarifying: true, field: 'items' } }
  if (!picked.length) return { text: 'Which gear are they taking? (gear_available lists what is free.)' }
  const lines = picked.map(p => { const o = list.find(x => x.id === p.offerId)!; return { offerId: o.id, kind: o.kind, qty: p.qty, name: o.name, pieces: o.kind === 'extra' ? [{ itemId: o.pieces[0]?.itemId ?? o.id, qty: p.qty, name: o.name }] : o.pieces } })
  const checks = checkLines(lines)
  const missingSaid = (Array.isArray(a.missing) ? a.missing : []).map(x => plain(String(x))).filter(Boolean)
  const missing: string[] = []
  for (const m of missingSaid) {
    // "2 batteries" = two units of that piece (review, Nov 24): the next unit not marked yet each time.
    const count = Math.max(1, Math.min(20, Number(/^(\d+)\s/.exec(m)?.[1] ?? 1)))
    const name = m.replace(/^\d+\s+/, '')
    const match = (c: { name: string }) => plain(c.name).includes(name.replace(/s$/, '')) || name.includes(plain(c.name))
    if (!checks.some(match)) return { text: `"${m}" isn't one of the pieces. The pieces are: ${checks.map(c => c.name).join(', ')}.` }
    for (let n = 0; n < count; n++) { const k = checks.find(c => match(c) && !missing.includes(c.key)); if (k) missing.push(k.key) }
  }
  if (a.all_pieces_there !== true && !missing.length) return { text: `Ask them to check every piece is in the bag first: ${checks.map(c => `${c.name}${c.of > 1 ? ` (${c.unit} of ${c.of})` : ''}`).join(', ')}. Then all_pieces_there, or say what is missing.` }
  if (!a.photo) return { text: 'Ask for ONE photo of the gear they are taking, taken now and attached here. It protects them if something was already missing or broken.' }
  const saved = await savePhoto(a.photo, `shoot-photos/${sh.id}`, { keepDate: true, allowOwn: `shoot-photos/${sh.id}/` })
  if ('problem' in saved) return { text: `Couldn't use that photo (${saved.problem}). Attach it again, or take the gear in the app: ${APP_URL}/gear` }
  const r = await takeGear.run(asUser(u, { scheduleShootId: sh.id, lines: picked, missing, photos: [saved.url], title: 'Shoot' })) as { id: string }
  const b = await docById('gear_bookings', r.id)
  const due = b?.to ? niceStamp(String(b.to)) : ''
  return { text: `Taken ✓ ${lines.map(l => `${l.name}${l.kind === 'extra' && l.qty > 1 ? ` x${l.qty}` : ''}`).join(', ')}${missing.length ? ` (noted missing: ${missing.length} piece${missing.length > 1 ? 's' : ''}; the equipment team is told)` : ''}. Due back ${due} (late after 30 minutes past that). Return it here with one photo of everything in the case, batteries charging (return_gear).`,
    structured: { booking_id: r.id, due_back: due } }
}

async function returnIt(a: Json, u: McpUser): Promise<ToolResult> {
  let id = s(a.booking_id, 100)
  const mine = await db.collection('gear_bookings').where('crewEmails', 'array-contains', u.email).where('status', '==', 'out').get().catch(() => null)
  const own = await db.collection('gear_bookings').where('creatorEmail', '==', u.email).where('status', '==', 'out').get()
  const out = [...own.docs, ...(mine?.docs ?? [])].map(d => ({ id: d.id, ...d.data() } as Json & { id: string }))
  if (!id && out.length === 1) id = out[0].id
  const b = out.find(x => x.id === id)
  if (!b) return { text: out.length ? `Which gear? ${out.map(x => `${x.id}: ${((x.lines ?? []) as Json[]).map(l => l.name).join(', ')}`).join('; ')}` : 'They have no gear out.' }
  if (!a.photo) return { text: 'Ask for ONE photo of everything back in the case with the batteries charging, taken now and attached here.' }
  const pieces = ((b.lines ?? []) as Json[]).flatMap(l => ((l.pieces ?? []) as Json[]).map(p => ({ itemId: String(p.itemId), name: String(p.name || l.name) })))
  const damage = objs(a.damage).map(d => { const p = pieces.find(x => plain(x.name).includes(plain(s(d.piece, 80))) || plain(s(d.piece, 80)).includes(plain(x.name))); return { itemId: p?.itemId ?? '', name: p?.name ?? s(d.piece, 80), note: s(d.note, 200) } })
  const saved = await savePhoto(a.photo, `gear-returns/${b.id}`, { keepDate: true, allowOwn: `gear-returns/${b.id}/` })
  if ('problem' in saved) return { text: `Couldn't use that photo (${saved.problem}). Attach it again, or return it in the app: ${APP_URL}/requests` }
  await returnGear.run(asUser(u, { id: b.id, photos: [saved.url], ...(damage.length ? { damage } : {}), ...(typeof a.charging === 'boolean' ? { charging: a.charging } : {}) }))
  const age = saved.takenAt ? (Date.now() - new Date(saved.takenAt).getTime()) / 60000 : null
  return { text: `Returned ✓ The equipment team checks it in.${damage.length ? ` Damage noted: ${damage.map(d => d.name).join(', ')}.` : ''}${a.charging === false ? ' Please plug the batteries in to charge if you can.' : ''}${age == null ? ' (The photo has no date in it, so the team may ask about it.)' : age > 60 ? ' (That photo was taken over an hour ago; the team sees that.)' : ''}`,
    structured: { booking_id: b.id, status: 'returned' } }
}
