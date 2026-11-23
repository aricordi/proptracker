// Nov 23 (owner): the team log with Undo, people not on the app yet (Moe), and the repeating-event block bug
// (two instances of one Google series got the same block id, so removing the old time deleted the new block).
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const OWNER = 'alexisricordi@gmail.com', MAANIK = 'maanik@example.com', SAM = 'sam@example.com', VAL = 'val@example.com', ANA = 'ana@example.com'
const today = todayInStudio()
let MON = addDays(today, 8); while (weekday(MON) !== 1) MON = addDays(MON, 1)
const TZ = (() => {
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', timeZoneName: 'shortOffset' }).formatToParts(new Date(`${MON}T12:00:00Z`)).find(p => p.type === 'timeZoneName')!.value
  const m = off.match(/GMT([+-]\d+)/); const h = m ? Number(m[1]) : -5
  return `${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:00`
})()
const C2 = 'cliff2cal@group.calendar.google.com'
const key = (id: string) => `test_calendar/${id.replace(/[^a-zA-Z0-9]/g, '_')}`
const ev = (id: string, summary: string, start: string, end: string) => ({ id, summary, start: { dateTime: `${MON}T${start}:00${TZ}` }, end: { dateTime: `${MON}T${end}:00${TZ}` } })

const docs = async (col: string) => {
  const res = await fetch(`http://127.0.0.1:8080/v1/projects/demo-proptracker/databases/(default)/documents/${col}?pageSize=300`, { headers: { Authorization: 'Bearer owner' } })
  const list = (await res.json()).documents ?? []
  return Promise.all(list.map((d: { name: string }) => getDoc(d.name.split('/documents/')[1]))) as Promise<Record<string, any>[]>
}
const log = async () => (await docs('team_log')).sort((a, b) => String(a.at).localeCompare(String(b.at)))

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
  await put(`users/${SAM}`, { email: SAM, role: 'admin', active: true, name: 'Sam' })
  for (const [e, n] of [[VAL, 'Val'], [ANA, 'Ana']]) await put(`users/${e}`, { email: e, role: 'creator', active: true, name: n, access: 'full' })
})

describe('team log + undo', () => {
  it('logs an approval; Undo puts it back to waiting; a second Undo is refused', async () => {
    const r = await call('bookShoot', { place: 'cliff2', date: MON, start: 660 }, VAL)
    expect(r.result.status).toBe('requested')
    expect((await call('decideBooking', { id: r.result.id, approve: true }, MAANIK)).ok).toBe(true)
    const [e] = await log()
    expect(e).toMatchObject({ action: 'approved', by: MAANIK, who: VAL, undo: { kind: 'unapprove' } })
    expect(e.label).toMatch(/Approved Val · Cliff 2/)
    const ids = (await docs('team_log')).map((x: any) => x)
    const id = (await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-proptracker/databases/(default)/documents/team_log`, { headers: { Authorization: 'Bearer owner' } })).json()).documents[0].name.split('/').pop()
    expect(ids.length).toBe(1)
    const u = await call('undoTeamAction', { id }, SAM)
    expect(u.ok, u.message).toBe(true)
    expect(await getDoc(`shoots/${r.result.id}`)).toMatchObject({ status: 'requested' })
    expect((await getDoc(`schedule_days/${MON}`))!.cliff2['660']).toMatchObject({ shootId: r.result.id, pending: true })
    expect((await call('undoTeamAction', { id }, OWNER)).ok).toBe(false)
    expect((await log()).some(x => x.action === 'undone')).toBe(true)
  })

  it('a team move is logged and Undo moves it back; creators and arts can\'t undo', async () => {
    await put('app_settings/schedule', { instantBookers: [{ email: VAL, name: 'Val' }] })
    const r = await call('bookShoot', { place: 'cliff2', date: MON, start: 660 }, VAL)
    expect((await call('moveShoot', { id: r.result.id, place: 'cliff2', date: MON, start: 780 }, MAANIK)).ok).toBe(true)
    const list = await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-proptracker/databases/(default)/documents/team_log`, { headers: { Authorization: 'Bearer owner' } })).json()
    const id = list.documents[0].name.split('/').pop()
    expect((await getDoc(`team_log/${id}`))).toMatchObject({ action: 'moved', undo: { kind: 'move', start: 660 } })
    expect((await call('undoTeamAction', { id }, VAL)).error).toBe('PERMISSION_DENIED')
    expect((await call('undoTeamAction', { id }, MAANIK)).ok).toBe(true)
    expect(await getDoc(`shoots/${r.result.id}`)).toMatchObject({ start: 660 })
  })

  it('denied with a reason → Undo books the same time for them again', async () => {
    const r = await call('bookShoot', { place: 'cliff1', date: MON, start: 900 }, ANA)
    expect((await call('decideBooking', { id: r.result.id, approve: false, reason: 'Cleaners' }, MAANIK)).ok).toBe(true)
    const list = await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-proptracker/databases/(default)/documents/team_log`, { headers: { Authorization: 'Bearer owner' } })).json()
    const id = list.documents[0].name.split('/').pop()
    expect((await call('undoTeamAction', { id }, MAANIK)).ok).toBe(true)
    expect((await getDoc(`schedule_days/${MON}`))!.cliff1['900'].email).toBe(ANA)
  })
})

describe('people not on the app yet', () => {
  it('the owner adds Moe (no access); his calendar events become his own shoots; the team can book for him', async () => {
    expect((await call('addOffAppPerson', { name: 'Moe' }, VAL)).error).toBe('PERMISSION_DENIED')
    const a = await call('addOffAppPerson', { name: 'Moe' }, OWNER)
    expect(a.ok, a.message).toBe(true)
    expect(await getDoc('users/guest:moe')).toMatchObject({ name: 'Moe', active: false, offApp: true, role: 'creator' })
    expect((await call('addOffAppPerson', { name: 'moe' }, SAM)).ok).toBe(false)   // already there
    await put('app_settings/schedule', { googleCalendarId: 'app@group.calendar.google.com', calendarFeeds: [{ id: C2, name: 'Cliff 2', house: 'cliff2' }] })
    await put('test_calendar/events', { items: [] })
    await put(key(C2), { items: [ev('moe1', 'Moe - Stromedy Talent Filming', '11:00', '13:00')] })
    expect((await call('checkCalendarNow', {}, MAANIK)).result.failed).toEqual([])
    const slot = (await getDoc(`schedule_days/${MON}`))!.cliff2['660']
    expect(slot).toMatchObject({ email: 'guest:moe', name: 'Moe' })
    expect(await getDoc(`shoots/${slot.shootId}`)).toMatchObject({ creatorEmail: 'guest:moe', guest: true })
    const b = await call('bookShoot', { place: 'cliff2', date: MON, start: 900, forEmail: 'guest:moe' }, MAANIK)
    expect(b.ok, b.message).toBe(true)
    expect(await getDoc(`shoots/${b.result.id}`)).toMatchObject({ creatorEmail: 'guest:moe', guest: true, status: 'booked' })
    const people = await call('listSchedulePeople', {}, MAANIK)
    expect(people.result.people.some((p: any) => p.email === 'guest:moe')).toBe(true)
  })
})

describe('repeating Google event moved to a new time (Nov 22 bug)', () => {
  it('the old and the new instance get different blocks: removing the old time keeps the new block', async () => {
    await put('app_settings/schedule', { googleCalendarId: 'app@group.calendar.google.com', calendarFeeds: [{ id: C2, name: 'Cliff 2', house: 'cliff2' }] })
    await put('test_calendar/events', { items: [] })
    // Nobody named "Zed" uses the app → blocked time (outsider filming).
    await put(key(C2), { items: [ev('ser1_20991207T140000Z', 'Zed - Filming', '09:00', '11:00')] })
    await call('checkCalendarNow', {}, MAANIK)
    expect(((await getDoc(`schedule_days/${MON}`))!.blocks ?? []).length).toBe(1)
    // The series is shifted: Google makes a new instance at 11–1 and deletes the 9–11 one.
    await put(key(C2), { items: [ev('ser1_20991207T160000Z', 'Zed - Filming', '11:00', '13:00')] })
    await call('checkCalendarNow', {}, MAANIK)
    const blocks = (await getDoc(`schedule_days/${MON}`))!.blocks ?? []
    expect(blocks.map((b: any) => b.start)).toEqual([660])
    // So nobody can book over it.
    expect((await call('bookShoot', { place: 'cliff2', date: MON, start: 660 }, VAL)).ok).toBe(false)
  })
})
