// Owner (Oct 21): any piece can be "Creators can book" (single item) or "Internal only". Bundles stay the grab-and-go kits.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'

const GEAR = 'gs-team@example.com', ANA = 'ana@example.com'
let DAY = addDays(todayInStudio(), 4)
if (weekday(DAY) === 0) DAY = addDays(DAY, 1)
const book = (lines: unknown) => call('createGearBooking', { title: 'Shoot', date: DAY, start: 600, end: 900, lines }, ANA)
const saveMic = (extra: Record<string, unknown> = {}) => call('saveGearItem', { id: 'mic', name: 'Rode shotgun mic', category: 'Audio', have: 3, ...extra }, GEAR)

beforeEach(async () => {
  await clearDatabase()
  await put(`users/${GEAR}`, { email: GEAR, role: 'equipment', active: true })
  await put(`users/${ANA}`, { email: ANA, role: 'creator', active: true, name: 'Ana' })
  await put('gear_items/mic', { name: 'Rode shotgun mic', category: 'Audio', have: 3, archived: false })
})

describe('single items creators can book', () => {
  it('internal pieces are never offered; "Creators can book" offers the ones not in a bundle', async () => {
    expect((await saveMic()).ok).toBe(true)
    expect(await getDoc('gear_bundles/item-mic')).toBeNull()
    expect((await saveMic({ public: true })).ok).toBe(true)
    expect(await getDoc('gear_bundles/item-mic')).toMatchObject({ kind: 'item', itemId: 'mic', name: 'Rode shotgun mic', archived: false, pieces: [{ itemId: 'mic', qty: 3 }] })
    // Putting one in a kit leaves 2 to book on their own.
    expect((await call('saveGearBundle', { name: 'Sound kit', category: 'Audio', pieces: [{ itemId: 'mic', qty: 1 }] }, GEAR)).ok).toBe(true)
    expect((await getDoc('gear_bundles/item-mic'))!.pieces[0].qty).toBe(2)
    expect((await saveMic({ public: false })).ok).toBe(true)
    expect((await getDoc('gear_bundles/item-mic'))!.archived).toBe(true)
  })
  it('creators book them by count, like any gear (pickup check, holds, no double-booking)', async () => {
    await saveMic({ public: true })
    const r = await book([{ offerId: 'item-mic', qty: 2 }])
    expect(r.ok, r.message).toBe(true)
    expect((await getDoc(`gear_bookings/${r.result.id}`))!.lines[0]).toMatchObject({ offerId: 'item-mic', kind: 'extra', qty: 2, pieces: [{ itemId: 'mic', qty: 2 }] })
    expect((await book([{ offerId: 'item-mic', qty: 2 }])).message).toMatch(/Only 1 "Rode shotgun mic" free/)
  })
  it('the team cannot take away units creators have booked, or make a booked piece internal', async () => {
    await saveMic({ public: true })
    expect((await book([{ offerId: 'item-mic', qty: 2 }])).ok).toBe(true)
    const kit = await call('saveGearBundle', { name: 'Sound kit', category: 'Audio', pieces: [{ itemId: 'mic', qty: 2 }] }, GEAR)
    expect(kit.error).toBe('FAILED_PRECONDITION')
    expect(kit.message).toMatch(/Creators have 2 "Rode shotgun mic" booked/)
    expect((await call('saveGearBundle', { name: 'Sound kit', category: 'Audio', pieces: [{ itemId: 'mic', qty: 1 }] }, GEAR)).ok).toBe(true)
    expect((await saveMic({ have: 2, public: true })).message).toMatch(/only 1 would be left|in bundles/)
    expect((await saveMic({ public: false })).message).toMatch(/Creators have "Rode shotgun mic" booked/)
  })
})
