// Journey 3 — shoot day, in the Chat: the creator checks in with one selfie, reports the slot before them
// (house left a mess, with a photo and a note), wraps ("what did you film?"); then the equipment team sees the
// check-in and the report in Schedule team.
// The test data's own shoots only line up with "now" during the day, so this file writes a shoot that is on
// RIGHT NOW (started 30 minutes ago) for Nia at Cliff 1, with Jana's shoot just before it, whatever the hour.
import { test, expect, reseed, signIn, putDoc, getDoc, testPhoto, esc } from '../helpers'

test.describe.configure({ mode: 'serial' })

const TZ = 'America/Toronto'
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function studio(ms: number) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, stamp: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`, min: Number(p.hour) * 60 + Number(p.minute) }
}
const dayBefore = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
const MIN = 60_000

const SHOOT = 'sh-now', BEFORE = 'sh-before', TITLE = 'Robot test: haunted house tour', NOTE = 'Dishes left in the sink'

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

test('creator checks in with a selfie, reports the slot before, and wraps', async ({ page }) => {
  await signIn(page, 'newbie')

  await test.step('the Chat says "You\'re up" with one selfie button', async () => {
    await expect(page.getByText("You're up · check in")).toBeVisible()
    await expect(page.getByText(/^Cliff 1 · /).first()).toBeVisible()
    await expect(page.getByText("One selfie with your camera and you're checked in.")).toBeVisible()
  })

  await test.step('take the selfie', async () => {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Check-in selfie' }).click()
    await (await chooser).setFiles(testPhoto('selfie.png'))
  })

  await test.step("someone filmed just before: report Jana's slot (mess + photo + a note)", async () => {
    await expect(page.getByText("All good with Jana's slot?")).toBeVisible()
    await page.getByRole('button', { name: 'Report it', exact: true }).click()
    await page.getByRole('button', { name: 'House was a mess', exact: true }).click()
    const send = page.getByRole('button', { name: /Check in and tell the team|Add a photo of the mess|Tap what happened/ })
    await expect(send).toHaveText('Add a photo of the mess')
    await expect(send).toBeDisabled()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Photo of the mess', exact: true }).click()
    await (await chooser).setFiles(testPhoto('mess.png'))
    await page.getByPlaceholder('Anything to add? (optional)').fill(NOTE)
    await expect(send).toHaveText('Check in and tell the team')
    await send.click()
  })

  await test.step('checked in: "Filming now", then wrap with what was filmed', async () => {
    await expect(page.getByText(/^Filming now · Cliff 1 · /)).toBeVisible()
    const wrap = page.getByRole('button', { name: 'Wrap', exact: true })
    await expect(wrap).toBeDisabled()
    await page.getByRole('textbox', { name: 'What did you film?' }).fill(TITLE)
    await wrap.click()
    await expect(page.getByText(/^Filming now/)).toHaveCount(0)
  })

  await test.step('the shoot page shows the check-in, the set photo and the video', async () => {
    await page.goto(`/schedule?shoot=${SHOOT}`)
    await expect(page.getByText(new RegExp(`^Checked in .* · filmed “${esc(TITLE)}”$`))).toBeVisible()
    await expect(page.getByText('Set photo').first()).toBeVisible()
  })
})

test('equipment team sees the check-in and the report in Schedule team', async ({ page }) => {
  await signIn(page, 'gear')
  await page.goto('/schedule/team')
  await expect(page.getByRole('heading', { level: 1, name: 'Schedule team' })).toBeVisible()

  await test.step('Check-ins: Nia filmed, with the video name', async () => {
    // The row: Nia's name, the slot line with the video name, and the "Filmed" pill.
    const row = page.locator('div').filter({ has: page.getByText('Nia', { exact: true }) }).filter({ hasText: `“${TITLE}”` })
      .filter({ has: page.getByText('Filmed', { exact: true }) }).last()
    await expect(row).toBeVisible()
  })

  await test.step('Reports: Nia reported Jana, mess + note + photo, Dismiss / Strike', async () => {
    await page.getByRole('button', { name: 'Reports (1)' }).click()
    await expect(page.getByText('Nia reported Jana')).toBeVisible()
    await expect(page.getByText('Left the house a mess')).toBeVisible()
    await expect(page.getByText(`“${NOTE}”`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Strike for Jana' })).toBeVisible()
  })

  await test.step('Dismiss it', async () => {
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByText('No reports to review.')).toBeVisible()
  })
})
