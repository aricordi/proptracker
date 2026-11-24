// Journey 3 — shoot day with NO check-in (owner, Nov 24): the creator just films (no selfie card, the chat says there's
// nothing to do); the equipment team opens the shoot once it has started and marks it filmed (or a no-show, a strike).
// The test data's own shoots only line up with "now" during the day, so this file writes a shoot that is on
// RIGHT NOW (started 30 minutes ago) for Nia at Cliff 1, with Jana's shoot just before it, whatever the hour.
import { test, expect, reseed, signIn, putDoc, getDoc } from '../helpers'

test.describe.configure({ mode: 'serial' })

const TZ = 'America/Toronto'
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function studio(ms: number) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, stamp: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`, min: Number(p.hour) * 60 + Number(p.minute) }
}
const dayBefore = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
const MIN = 60_000

const SHOOT = 'sh-now', BEFORE = 'sh-before'

async function putRunningShoots() {
  const fromMs = Date.now() - 30 * MIN
  const from = studio(fromMs)
  // The shoot belongs to the day it starts. Just after midnight Jana's slot (2 hours earlier) would fall on the day before,
  // so then the shoot is filed under yesterday as a late slot (start past 24:00), the way the 11 PM slot runs past midnight.
  let date = from.date, start = from.min
  if (start < 150) { date = dayBefore(from.date); start += 1440 }
  const base = { place: 'cliff1', where: '', date, month: date.slice(0, 7), kind: 'extra', status: 'booked', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  await putDoc(`shoots/${BEFORE}`, { ...base, creatorEmail: 'jana@example.com', creatorName: 'Jana', bookedBy: 'jana@example.com', start: start - 120, end: start,
    from: studio(fromMs - 120 * MIN).stamp, to: from.stamp, history: [{ at: new Date().toISOString(), by: 'jana@example.com', action: 'booked', note: 'robot test' }] })
  await putDoc(`shoots/${SHOOT}`, { ...base, creatorEmail: 'newbie@example.com', creatorName: 'Nia', bookedBy: 'newbie@example.com', start, end: start + 120,
    from: from.stamp, to: studio(fromMs + 120 * MIN).stamp, history: [{ at: new Date().toISOString(), by: 'newbie@example.com', action: 'booked', note: 'robot test' }] })
  // Keep whatever the test data already has on that day; add both slots at Cliff 1.
  const day = (await getDoc<Record<string, unknown>>(`schedule_days/${date}`)) ?? { date }
  const cliff1 = { ...((day.cliff1 as Record<string, unknown>) ?? {}),
    [String(start - 120)]: { shootId: BEFORE, name: 'Jana', email: 'jana@example.com', kind: 'extra' },
    [String(start)]: { shootId: SHOOT, name: 'Nia', email: 'newbie@example.com', kind: 'extra' } }
  await putDoc(`schedule_days/${date}`, { ...day, cliff1 })
}

test.beforeAll(async () => {
  reseed()
  await putRunningShoots()
})

test('creator: no check-in card on shoot day; "I\'m here" says there is nothing to do', async ({ page }) => {
  await signIn(page, 'newbie')
  await expect(page.getByText('Hi Nia.')).toBeVisible()
  await expect(page.getByText(/You're up · check in/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Check-in selfie' })).toHaveCount(0)
  const box = page.getByRole('textbox').last()
  await box.fill("I'm here")
  await box.press('Enter')
  await expect(page.getByText(/no check-in needed, just film/)).toBeVisible()
  await page.goto(`/schedule?shoot=${SHOOT}`)
  await expect(page.getByText('Your shoot').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^Check in/ })).toHaveCount(0)
})

test('equipment team: marks the running shoot as filmed on its card', async ({ page }) => {
  await signIn(page, 'gear')
  await page.goto(`/schedule?shoot=${SHOOT}`)
  await expect(page.getByText('Did they film?')).toBeVisible()
  await page.getByRole('button', { name: 'They filmed', exact: true }).click()
  await expect(page.getByText('Marked as filmed ✓')).toBeVisible()
  expect((await getDoc<Record<string, unknown>>(`shoots/${SHOOT}`))!.outcome).toBe('filmed')
})
