// Real-time calendar sync (owner, Nov 24): Google pings calendarPush when a watched calendar changes; only our own channels
// (id + secret token) are accepted, and the ping runs the same check as the 30-minute timer.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, getDoc, waitFor, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const URL_ = 'http://127.0.0.1:5001/demo-proptracker/northamerica-northeast1/calendarPush'
const ANA = 'ana@example.com'
const CH = '0b6c3a4e-1111-4222-8333-944455556666'
let FRI = addDays(todayInStudio(), 8); while (weekday(FRI) !== 5) FRI = addDays(FRI, 1)
const TZ = (() => {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${FRI}T12:00:00Z`)).find(x => x.type === 'timeZoneName')!.value
  return `-0${name.replace('GMT-', '')}:00`
})()

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put('app_settings/schedule', { googleCalendarId: 'test@group.calendar.google.com' })
  await put(`calendar_watches/${CH}`, { calendarId: 'test@group.calendar.google.com', name: 'App calendar', channelId: CH, resourceId: 'r1', token: 'secret-1', expiration: Date.now() + 86400_000 })
})

const ping = (headers: Record<string, string>) => fetch(URL_, { method: 'POST', headers })

describe('live calendar sync', () => {
  it('refuses pings that are not from our channels', async () => {
    expect((await ping({ 'X-Goog-Channel-ID': CH, 'X-Goog-Channel-Token': 'wrong', 'X-Goog-Resource-State': 'exists' })).status).toBe(404)
    expect((await ping({ 'X-Goog-Channel-ID': '0b6c3a4e-0000-4222-8333-944455556666', 'X-Goog-Channel-Token': 'secret-1', 'X-Goog-Resource-State': 'exists' })).status).toBe(404)
    expect((await fetch(URL_)).status).toBe(404)
    // The first "sync" message when a channel opens is just a hello.
    expect((await ping({ 'X-Goog-Channel-ID': CH, 'X-Goog-Channel-Token': 'secret-1', 'X-Goog-Resource-State': 'sync' })).status).toBe(200)
    expect(await getDoc(`calendar_ping/${CH}`)).toBeNull()
  })

  it('a change in Google Calendar reaches the schedule straight away (no waiting for the timer)', async () => {
    await put('test_calendar/events', { items: [{ id: 'live1', summary: 'Ana - Cliff 2 Filming', location: '2371 Cliff Road', start: { dateTime: `${FRI}T13:15:00${TZ}` }, end: { dateTime: `${FRI}T15:15:00${TZ}` } }] })
    expect((await ping({ 'X-Goog-Channel-ID': CH, 'X-Goog-Channel-Token': 'secret-1', 'X-Goog-Resource-State': 'exists' })).status).toBe(200)
    await waitFor(async () => !!(await getDoc('calendar_imports/live1')), 25000)
    const day = (await getDoc(`schedule_days/${FRI}`))!
    expect(day.cliff2['795']).toMatchObject({ name: 'Ana', email: ANA, time: { start: 795, end: 915 } })
    await waitFor(async () => !!(await getDoc('app_settings/calendarLive'))?.lastSynced, 15000)
  })
})
