// The activity log: prop changes and booking steps, written by the server.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase, waitFor } from './helpers'
import { addDays, todayInStudio } from '../../functions/src/booking'

const ARTS = 'log-arts@example.com', ALEX = 'alex@example.com'
const day = (n: number) => addDays(todayInStudio(), n)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${ARTS}`, { email: ARTS, role: 'arts', active: true, name: 'Sam' })
  await put(`users/${ALEX}`, { email: ALEX, role: 'creator', active: true, name: 'Alex' })
  await put('app_settings/booking', { leadTimeDays: 0, bufferDays: 1, maxDays: 7, closedWeekdays: [] })
})

describe('prop changes', () => {
  it('records who changed what, from → to', async () => {
    await put('items/cop', { name: 'Cop costume', quantity: 1, condition: 'good', tags: [], updatedBy: ARTS, updatedAt: '2026-10-13T10:00:00Z' })
    await put('items/cop', { name: 'Cop costume', quantity: 2, condition: 'damaged', tags: [], updatedBy: ARTS, updatedAt: '2026-10-13T11:00:00Z' })
    // Two records: "added", then "edited" with the two changes.
    const find = async (action: string) => {
      const res = await fetch(`http://127.0.0.1:8080/v1/projects/demo-proptracker/databases/(default)/documents/activity?pageSize=50`, { headers: { Authorization: 'Bearer owner' } })
      const docs = (await res.json()).documents ?? []
      const all = await Promise.all(docs.map((d: { name: string }) => getDoc(d.name.split('/documents/')[1])))
      return all.find(a => a?.action === action)
    }
    expect(await waitFor(async () => !!(await find('edited')))).toBe(true)
    expect(await find('added')).toMatchObject({ by: ARTS, itemName: 'Cop costume' })
    const e = (await find('edited'))!
    expect(e).toMatchObject({ kind: 'prop', by: ARTS, itemIds: ['cop'], itemName: 'Cop costume' })
    expect(e.changes).toEqual(expect.arrayContaining([
      { field: 'quantity', from: 1, to: 2 },
      { field: 'condition', from: 'good', to: 'damaged' },
    ]))
  })
})

describe('booking steps', () => {
  it('each step of a booking becomes a record, once', async () => {
    await put('items/chairs', { name: 'Wooden chair', quantity: 10, condition: 'good', tags: [] })
    const r = await call('createReservation', { title: 'Diner', startDate: day(2), endDate: day(2), lines: [{ itemId: 'chairs', qty: 2 }] }, ALEX)
    const id = r.result.id
    expect(await waitFor(async () => !!(await getDoc(`activity/${id}_h0`)))).toBe(true)
    expect(await getDoc(`activity/${id}_h0`)).toMatchObject({
      kind: 'booking', action: 'requested', by: ALEX, creatorEmail: ALEX, title: 'Diner', itemIds: ['chairs'],
    })
    await call('setLinePick', { id, itemId: 'chairs', state: 'unavailable', reason: 'Two are broken' }, ARTS)
    expect(await waitFor(async () => !!(await getDoc(`activity/${id}_h1`)))).toBe(true)
    expect((await getDoc(`activity/${id}_h1`))!.action).toBe('preparing')
  })
})
