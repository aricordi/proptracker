// Journey 1 — a creator on the Full app asks for a filming time from the month calendar.
import { test, expect, reseed, signIn, openTab, plainDayAhead, sheet, slotRow } from '../helpers'

test.beforeAll(() => reseed())

test('creator lands on the chat, picks a free time on the calendar and it waits for approval', async ({ page }) => {
  // Nia: a Full app creator with nothing booked yet (so the one-slot-a-day rule never gets in the way).
  await signIn(page, 'newbie')

  await test.step('lands on the Chat', async () => {
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Hi Nia.')).toBeVisible()
    await expect(page.getByText('What are we making today?')).toBeVisible()
    for (const name of ['Chat', 'Calendar', 'Props', 'More']) await expect(page.getByRole('navigation').getByRole('link', { name })).toBeVisible()
  })

  // A weekday a few days out that isn't a Cliff 1 priority day (Thu/Sat) or a no-crew Sunday.
  const date = plainDayAhead(3)
  const [y, m] = date.split('-').map(Number)
  const monthName = new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })

  await test.step('Calendar tab shows the month grid', async () => {
    await openTab(page, 'Calendar')
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'Which house' })).toBeVisible()
    // The day may fall in next month.
    const heading = page.getByRole('heading', { level: 2, name: new RegExp(`${monthName} ${y}`) })
    if (!(await heading.isVisible())) await page.getByRole('button', { name: 'Next month' }).click()
    await expect(heading).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`^${date}: \\d+ free`) })).toBeEnabled()
  })

  await test.step('tap the day, then a free time at Cliff 2', async () => {
    await page.getByRole('button', { name: new RegExp(`^${date}:`) }).click()
    const day = sheet(page)
    await expect(day).toBeVisible()
    const cliff2 = slotRow(day, '3 PM').getByRole('button').nth(1)
    await expect(cliff2).toHaveText('Free')
    await cliff2.click()
  })

  await test.step('request it', async () => {
    const ask = sheet(page, 'Ask for this slot')
    await expect(ask).toBeVisible()
    await expect(ask.getByText(/Cliff 2 · 3 PM–5 PM/)).toBeVisible()
    await expect(ask.getByRole('button', { name: 'Just me' })).toBeVisible()
    await ask.getByRole('button', { name: 'Request this time' }).click()
  })

  await test.step('the shoot is waiting for the equipment team', async () => {
    const shoot = sheet(page, 'Your shoot')
    await expect(shoot).toBeVisible()
    await expect(shoot.getByText('Waiting for approval')).toBeVisible()
    await expect(shoot.getByText(/Sent to the equipment team/)).toBeVisible()
  })

  await test.step('the chat lists it as "Waiting for OK"', async () => {
    await page.keyboard.press('Escape')
    await openTab(page, 'Chat')
    await expect(page.getByText(/Your next 1 shoot|Your next shoot/)).toBeVisible()
    await expect(page.getByText(/Cliff 2 · 3 PM–5 PM/)).toBeVisible()
    await expect(page.getByText(/Waiting for OK/)).toBeVisible()
  })
})
