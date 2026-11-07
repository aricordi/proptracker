// Journey 12 — "wanted but booked" (owner, Nov 7): a creator opens a prop that's booked out on their shoot's day. The
// creator sees nothing new (just "Not available"); the app notes it quietly and the arts department sees it on Prop insights.
import { createHash } from 'node:crypto'
import { test, expect, reseed, signIn, openTab, sheet, getDoc, putDoc, esc, dayLabel as labelOf } from '../helpers'

test.describe.configure({ mode: 'serial' })
// Riley's shoot next week (seed sh9: Cliff 1, 8 days out, 3–5 PM). Someone else holds the only police costume that day.
let shootDay = ''
test.beforeAll(async () => {
  reseed()
  shootDay = (await getDoc<{ date: string }>('shoots/sh9'))!.date
  await putDoc('item_bookings/cop', { entries: [{ reservationId: 'someone-else', start: shootDay, end: shootDay, qty: 1 }] })
})
const wantDoc = () => `prop_wants/cop_${shootDay}_${createHash('sha1').update('creator@example.com').digest('hex').slice(0, 16)}`

test('creator opens a booked-out prop for their shoot: nothing to do, the arts team is told quietly', async ({ page }) => {
  await signIn(page, 'creator')
  const dayLabel = await labelOf(page, shootDay)
  await openTab(page, 'Props')
  await page.getByRole('button', { name: 'Change which shoot you are adding to' }).click()
  await sheet(page, 'Which shoot?').getByRole('button', { name: new RegExp(`Cliff 1 · ${esc(dayLabel)} · 3 PM–5 PM`) }).click()
  await page.getByRole('textbox', { name: 'Search props' }).fill('police')
  await page.getByRole('button', { name: /Police officer costume/ }).first().click()
  await expect(page).toHaveURL(/\/item\/cop$/)
  await expect(page.getByText('Not available on this day')).toBeVisible()
  await expect.poll(() => getDoc(wantDoc()), { timeout: 15_000 }).toMatchObject({ itemId: 'cop', day: shootDay, email: 'creator@example.com' })
})

test('arts: Prop insights shows it under Often unavailable', async ({ page }) => {
  await signIn(page, 'arts')
  await page.goto('/insights')
  const card = page.getByRole('region', { name: 'Often unavailable' })
  await expect(card.getByText(/1 person wanted it while booked out/)).toBeVisible()
})
