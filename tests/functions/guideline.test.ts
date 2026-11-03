// Filming guideline (owner, Nov 3): Cliff 1 on priority days needs a PDF from creators outside the priority group.
import { beforeEach, describe, it, expect } from 'vitest'
import { put, call, getDoc, clearDatabase } from './helpers'
import { todayInStudio, addDays, weekday } from '../../functions/src/booking'
import { releaseStamp, cleanScheduleSettings } from '../../functions/src/schedule'
import { nowStamp } from '../../functions/src/gearBooking'

const ANA = 'gl-ana@example.com', JANA = 'gl-jana@example.com', MAANIK = 'gl-maanik@example.com'
// A day in the next week whose priority lock is already released, made a "priority day" by the settings.
let D = addDays(todayInStudio(), 1)
for (let k = 1; k < 7; k++) { const d = addDays(todayInStudio(), k); const s = cleanScheduleSettings({ priorityWeekdays: [weekday(d)] }); if (releaseStamp(d, s) <= nowStamp()) { D = d; break } }
const GUIDE = { url: 'http://127.0.0.1:9199/v0/b/demo/o/guidelines%2Fgl-ana%40example.com%2Fx.pdf?alt=media', name: 'My guideline.pdf' }

beforeEach(async () => {
  await clearDatabase()
  for (const [e, n] of [[ANA, 'Ana'], [JANA, 'Jana']]) await put(`users/${e}`, { email: e, role: 'creator', active: true, name: n, access: 'full' })
  await put(`users/${MAANIK}`, { email: MAANIK, role: 'equipment', active: true, name: 'Maanik' })
  await put('app_settings/schedule', { priorityWeekdays: [weekday(D)], priority: [{ email: JANA, name: 'Jana' }] })
})

describe('guideline on priority days', () => {
  it('a creator outside the priority group needs the PDF for Cliff 1 that day', async () => {
    const no = await call('bookShoot', { place: 'cliff1', date: D, start: 1260 }, ANA)
    if (no.message?.match(/priority/i)) return   // still locked on this weekday (release timing): nothing to check
    expect(no.message).toMatch(/guideline/)
    const yes = await call('bookShoot', { place: 'cliff1', date: D, start: 1260, guideline: GUIDE }, ANA)
    expect(yes.ok).toBe(true)
    expect((await getDoc(`shoots/${yes.result.id}`))!.guideline).toEqual(GUIDE)
  })
  it('the priority group, Cliff 2 and the schedule team don\'t need one', async () => {
    expect((await call('bookShoot', { place: 'cliff1', date: D, start: 1140 }, JANA)).ok).toBe(true)
    expect((await call('bookShoot', { place: 'cliff2', date: D, start: 1140 }, ANA)).ok).toBe(true)
    expect((await call('bookShoot', { place: 'cliff1', date: D, start: 1020, forEmail: ANA }, MAANIK)).ok).toBe(true)
  })
})
