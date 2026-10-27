// Fills the LOCAL emulator with sample data for trying the app.
// Never touches the live database: it only talks to 127.0.0.1 and the
// "demo-" project, which Firebase guarantees is offline-only.
//
// Usage (the emulator must already be running):  node scripts/seed-emulator.mjs [--reset]

const BASE = 'http://127.0.0.1:8080/v1/projects/demo-proptracker/databases/(default)/documents'
const HEADERS = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' } // emulator admin bypass

function toValue(v) {
  if (v === null) return { nullValue: null }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } }
  return { stringValue: String(v) }
}
function toFields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)]))
}
async function put(path, data) {
  const res = await fetch(`${BASE}/${path}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ fields: toFields(data) }) })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
}

// --reset wipes the emulator's database first (never the live one), for a clean start.
if (process.argv.includes('--reset')) {
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-proptracker/databases/(default)/documents', { method: 'DELETE' })
}

const now = new Date().toISOString()
const meta = { createdAt: now, updatedAt: now, createdBy: 'seed', updatedBy: 'seed' }

const users = [
  { email: 'arts@example.com', name: 'Sam (Arts)', role: 'arts', active: true },
  { email: 'creator@example.com', name: 'Riley (Creator)', role: 'creator', active: true },
  { email: 'gear@example.com', name: 'Dev (Equipment)', role: 'equipment', active: true },
  { email: 'admin@example.com', name: 'Sam (Admin)', role: 'admin', active: true },
  { email: 'jana@example.com', name: 'Jana', role: 'creator', active: true },
  { email: 'kyle@example.com', name: 'Kyle', role: 'creator', active: true },
  { email: 'newbie@example.com', name: 'Nia', role: 'creator', active: true },
  { email: 'former@example.com', name: 'Former creator', role: 'creator', active: false },
]
const locations = [{ id: 'loc-main', name: 'Main prop room' }, { id: 'loc-cage', name: 'Costume cage' }]
const bins = [
  { id: 'bin-a1', label: 'A1', locationId: 'loc-main', qrSlug: 'bin-a1' },
  { id: 'bin-a2', label: 'A2', locationId: 'loc-main', qrSlug: 'bin-a2' },
  { id: 'bin-c1', label: 'Rack C1', locationId: 'loc-cage', qrSlug: 'bin-c1' },
]
const tags = [
  ['t-police', 'police'], ['t-uniform', 'uniform'], ['t-chair', 'chair'], ['t-wood', 'wood'],
  ['t-horror', 'horror'], ['t-glass', 'glass'], ['t-phone', 'phone'], ['t-vintage', 'vintage'],
].map(([id, label]) => ({ id, label, normalizedKey: label, usageCount: 1 }))
const characters = [{ id: 'ch-det', label: 'Detective', normalizedKey: 'detective', usageCount: 1 }]

const items = [
  // New-style records
  { id: 'cop', name: 'Police officer costume', categoryId: 'costume', quantity: 1, condition: 'good',
    replacementCost: 650, tags: ['t-police', 't-uniform'], characters: ['ch-det'], binId: 'bin-c1', locationId: 'loc-cage',
    notes: 'Size L. Badge is glued on, do not remove.', description: 'Navy blue police uniform with badge and hat.',
    photos: [], status: 'available', archived: false },
  { id: 'chairs', name: 'Wooden dining chair', categoryId: 'set-dressing', quantity: 10, condition: 'fair',
    replacementCost: 45, tags: ['t-chair', 't-wood'], binId: 'bin-a1', locationId: 'loc-main',
    photos: [], status: 'available', archived: false },
  { id: 'phone', name: 'Rotary phone', categoryId: 'prop', quantity: 2, condition: 'good',
    replacementCost: 80, tags: ['t-phone', 't-vintage'], binId: 'bin-a2', locationId: 'loc-main',
    photos: [], status: 'available', archived: false },
  { id: 'old-lamp', name: 'Broken lamp (archived)', categoryId: 'set-dressing', quantity: 1, condition: 'damaged',
    tags: [], photos: [], status: 'available', archived: true },
  // Old-style records, exactly as the previous version of the app saved them
  { id: 'legacy-skull', name: 'Fake skull', itemType: 'prop', status: 'damaged', cost: 25,
    tags: ['t-horror'], binId: 'bin-a2', locationId: 'loc-main', whereToRebuy: 'Spirit Halloween' },
  { id: 'legacy-bottle', name: 'Breakaway bottle', itemType: 'prop', status: 'checked-out',
    checkedOutInfo: { label: 'Bar fight shoot', checkedOutAt: now }, tags: ['t-glass'], description: 'Sugar-glass beer bottle.' },
]

for (const u of users) await put(`users/${u.email}`, { ...u, invitedBy: 'seed', invitedAt: now })
for (const { id, ...l } of locations) await put(`locations/${id}`, l)
for (const { id, ...b } of bins) await put(`bins/${id}`, b)
for (const { id, ...t } of tags) await put(`tags/${id}`, t)
for (const { id, ...c } of characters) await put(`characters/${id}`, c)
// One of the owner's own props (only the owner can see it).
items.push({ id: 'my-lamp', name: "Grandma's brass lamp", categoryId: 'set-dressing', quantity: 1, condition: 'good',
  replacementCost: 120, tags: [], photos: [], status: 'available', archived: false, collection: 'personal' })
for (const { id, ...i } of items) await put(`items/${id}`, { collection: 'company', ...i, ...meta })
await put('checkouts/co1', { label: 'Bar fight shoot', startedAt: now, itemIds: ['legacy-bottle'] })

// Gear: the owner's test gear (scripts/test-gear.json, also the live "Add test gear" button), plus a C-stand extra.
const testGear = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./test-gear.json', import.meta.url), 'utf8'))
const gearName = Object.fromEntries(testGear.items.map(i => [i.id, i.name]))
for (const { id, ...g } of testGear.items) await put(`gear_items/${id}`, { serial: null, value: null, notes: '', photos: [], archived: false, ...g, ...meta })
for (const { id, pieces, ...b } of testGear.bundles) await put(`gear_bundles/${id}`, { photos: [], archived: false, kind: 'bundle', ...b,
  pieces: pieces.map(([itemId, qty]) => ({ itemId, qty, name: gearName[itemId] })), ...meta })
await put('gear_items/g-cst', { name: 'C-stand', category: 'Grip', have: 4, serial: null, value: null, notes: '', photos: [], archived: false, ...meta })
await put('gear_bundles/x-cst', { name: 'C-stand', category: 'Grip', description: '', photos: [], archived: false,
  kind: 'extra', pieces: [{ itemId: 'g-cst', qty: 4, name: 'C-stand' }], ...meta })

// House schedule: Jana is in the priority group; a few shoots over the next days.
const dayOf = n => { const d = new Date(Date.now() + n * 86400000); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(d) }
await put('app_settings/schedule', { priority: [{ email: 'jana@example.com', name: 'Jana' }] })
const shoots = [
  { id: 'sh1', d: 1, place: 'cliff1', start: 660, email: 'jana@example.com', name: 'Jana', kind: 'monthly' },
  { id: 'sh2', d: 1, place: 'cliff1', start: 780, email: 'creator@example.com', name: 'Riley (Creator)', kind: 'monthly' },
  { id: 'sh3', d: 1, place: 'cliff1', start: 900, email: 'kyle@example.com', name: 'Kyle', kind: 'extra' },
  { id: 'sh4', d: 2, place: 'cliff2', start: 1140, email: 'creator@example.com', name: 'Riley (Creator)', kind: 'extra' },
  { id: 'sh5', d: 2, place: 'offsite', start: 900, email: 'kyle@example.com', name: 'Kyle', kind: 'offsite', where: 'Rosewood Park' },
  // Next week: Riley's shoot with time to add props and gear.
  { id: 'sh9', d: 8, place: 'cliff1', start: 900, email: 'creator@example.com', name: 'Riley (Creator)', kind: 'extra' },
  // ...and Kyle right after Riley (back to back: they can share one gear booking).
  { id: 'sh10', d: 8, place: 'cliff1', start: 1020, email: 'kyle@example.com', name: 'Kyle', kind: 'extra' },
  // Yesterday: Kyle never checked in (shows in Schedule team → Check-ins).
  { id: 'sh6', d: -1, place: 'cliff2', start: 780, email: 'kyle@example.com', name: 'Kyle', kind: 'extra' },
]
// Right now (if a slot is running): Riley at Cliff 2 can check in; Jana had the slot before (to report).
const nowMin = (([h, m]) => h * 60 + m)(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':').map(Number))
const slotNow = [420, 540, 660, 780, 900, 1020, 1140, 1260, 1380].find(t => t <= nowMin && nowMin < t + 120)
if (slotNow) {
  shoots.push({ id: 'sh7', d: 0, place: 'cliff2', start: slotNow, email: 'creator@example.com', name: 'Riley (Creator)', kind: 'extra' })
  if (slotNow > 420) shoots.push({ id: 'sh8', d: 0, place: 'cliff2', start: slotNow - 120, email: 'jana@example.com', name: 'Jana', kind: 'extra' })
}
const scheduleDays = {}
for (const x of shoots) {
  const date = dayOf(x.d), pad = n => String(n).padStart(2, '0'), hm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
  await put(`shoots/${x.id}`, { creatorEmail: x.email, creatorName: x.name, place: x.place, where: x.where ?? '', date, month: date.slice(0, 7),
    start: x.start, end: x.start + 120, from: `${date}T${hm(x.start)}`, to: `${date}T${hm(x.start + 120)}`, kind: x.kind, status: 'booked',
    bookedBy: x.email, createdAt: now, updatedAt: now, history: [{ at: now, by: x.email, action: 'booked', note: 'seed' }] })
  const day = scheduleDays[date] ??= { date }
  if (x.place === 'offsite') (day.offsite ??= []).push({ shootId: x.id, name: x.name, email: x.email, start: x.start, end: x.start + 120, where: x.where })
  else (day[x.place] ??= {})[String(x.start)] = { shootId: x.id, name: x.name, email: x.email, kind: x.kind }
}
scheduleDays[dayOf(1)].blocks = [{ id: 'blk1', house: 'cliff1', start: 420, end: 540, type: 'cleaners', note: 'Cleaners' }]
for (const [date, day] of Object.entries(scheduleDays)) await put(`schedule_days/${date}`, day)
await put('profiles/jana@example.com', { channel: '@janafilms' })
await put('profiles/kyle@example.com', { channel: 'Kyle Does Things' })
// Kyle asks Riley (the test creator) to swap: Riley's tomorrow 1 PM for Kyle's tomorrow 3 PM.
const t1 = dayOf(1)
await put('swap_requests/sw1', { fromShootId: 'sh3', toShootId: 'sh2', fromEmail: 'kyle@example.com', fromName: 'Kyle', toEmail: 'creator@example.com', toName: 'Riley (Creator)',
  from: { place: 'cliff1', date: t1, start: 900, end: 1020 }, to: { place: 'cliff1', date: t1, start: 780, end: 900 }, status: 'pending', createdAt: now })

console.log(`Seeded ${users.length} users, ${items.length} props, ${bins.length} bins into the local emulator.`)
