// Email sending (practice mode) and the hourly late / at-risk check.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase, waitFor, PROJECT } from './helpers'
import { addDays, todayInStudio } from '../../functions/src/booking'

const OWNER = 'alexisricordi@gmail.com', ARTS = 'mail-arts@example.com'
const ALEX = 'alex@example.com', BLAIR = 'blair@example.com'
const day = (n: number) => addDays(todayInStudio(), n)
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`

async function outbox(): Promise<Record<string, any>[]> {
  const res = await fetch(`${FS}/outbox?pageSize=100`, { headers: { Authorization: 'Bearer owner' } })
  const docs = (await res.json()).documents ?? []
  return Promise.all(docs.map((d: { name: string }) => getDoc(d.name.split('/documents/')[1])))
}

beforeEach(async () => {
  await clearDatabase()
  for (const [email, role] of [[ARTS, 'arts'], [ALEX, 'creator'], [BLAIR, 'creator']]) {
    await put(`users/${email}`, { email, role, active: true, name: email.split('@')[0] })
  }
  await put('app_settings/booking', { leadTimeDays: 0, bufferDays: 1, maxDays: 7, closedWeekdays: [] })
  await put('app_settings/email', { enabled: true, host: 'fake', port: 465, user: 'props@example.com', fromName: 'Prop Tracker', fromAddress: 'props@example.com', appUrl: 'https://example.web.app' })
  await put('items/cop', { name: 'Cop costume', quantity: 1, condition: 'good', tags: [] })
})

describe('sending queued emails', () => {
  it('a new booking emails the arts department (everyone in it, plus the owner)', async () => {
    expect((await call('createReservation', { title: 'Diner', startDate: day(5), endDate: day(5), lines: [{ itemId: 'cop', qty: 1 }] }, ALEX)).ok).toBe(true)
    const ok = await waitFor(async () => (await outbox()).some(m => m.status === 'sent'))
    if (!ok) console.log('OUTBOX', JSON.stringify(await outbox(), null, 1))
    expect(ok).toBe(true)
    const mail = (await outbox()).find(m => m.to === 'arts-team')!
    expect(mail.sentTo.sort()).toEqual([ARTS, OWNER].sort())
  })
  it('nothing is sent while email is turned off', async () => {
    await put('app_settings/email', { enabled: false, host: 'fake' })
    await call('createReservation', { title: 'Diner', startDate: day(5), endDate: day(5), lines: [{ itemId: 'cop', qty: 1 }] }, ALEX)
    expect(await waitFor(async () => (await outbox()).some(m => m.status === 'skipped'))).toBe(true)
    expect((await outbox()).some(m => m.status === 'sent')).toBe(false)
  })
  it('only the owner can send a test email', async () => {
    expect((await call('sendTestEmail', {}, ARTS)).error).toBe('PERMISSION_DENIED')
    expect((await call('sendTestEmail', {}, OWNER)).ok).toBe(true)
    expect(await waitFor(async () => (await outbox()).some(m => m.status === 'sent' && m.sentTo?.[0] === OWNER))).toBe(true)
  })
})

describe('hourly late and at-risk check', () => {
  const lateBooking = async () => {
    await put('reservations/late1', { title: 'Old shoot', creatorEmail: ALEX, creatorName: 'Alex', status: 'collected', startDate: day(-3), endDate: day(-3), lines: [], itemIds: ['cop'] })
    await put('item_bookings/cop', { entries: [{ reservationId: 'late1', start: day(-3), end: day(-3), qty: 1, out: true }] })
  }
  it('emails a late creator and the arts department, once', async () => {
    await lateBooking()
    expect((await call('checkNoticesNow', {}, OWNER)).result).toMatchObject({ late: 1 })
    expect((await getDoc('reservations/late1'))!.lateNotifiedAt).toBeTruthy()
    const subjects = (await outbox()).map(m => `${m.to}: ${m.subject}`)
    expect(subjects).toContain(`${ALEX}: Late: please return the props from "Old shoot"`)
    expect((await call('checkNoticesNow', {}, OWNER)).result).toMatchObject({ late: 0 })
  })
  it('warns the next creator whose booking includes the late prop, once', async () => {
    // Blair booked the costume before it went late.
    await put('reservations/next1', { title: 'Next shoot', creatorEmail: BLAIR, creatorName: 'Blair', status: 'requested', startDate: day(4), endDate: day(4),
      lines: [{ itemId: 'cop', itemName: 'Cop costume', qty: 1 }], itemIds: ['cop'] })
    await lateBooking()
    await put('item_bookings/cop', { entries: [
      { reservationId: 'late1', start: day(-3), end: day(-3), qty: 1, out: true },
      { reservationId: 'next1', start: day(4), end: day(4), qty: 1 },
    ] })
    expect((await call('checkNoticesNow', {}, OWNER)).result).toMatchObject({ atRisk: 1 })
    expect((await getDoc('reservations/next1'))!.riskNotified).toEqual(['cop'])
    expect((await outbox()).some(m => m.to === BLAIR && /might not be ready/.test(m.subject))).toBe(true)
    expect((await call('checkNoticesNow', {}, OWNER)).result).toMatchObject({ atRisk: 0 })
  })
  it('only the owner can run it by hand', async () => {
    expect((await call('checkNoticesNow', {}, ARTS)).error).toBe('PERMISSION_DENIED')
  })
})
