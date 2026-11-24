// Journey 1 — a creator on the Full app asks for a filming time from the month calendar.
import { test, expect, reseed, signIn, openTab, plainDayAhead, sheet } from '../helpers'

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
    // The day may fall in next month (wait for the grid's month title first, then decide).
    await expect(page.getByRole('heading', { level: 2, name: /^[A-Z][a-z]+ \d{4}$/ })).toBeVisible()
    const heading = page.getByRole('heading', { level: 2, name: new RegExp(`${monthName} ${y}`) })
    if (!(await heading.isVisible())) await page.getByRole('button', { name: 'Next month' }).click()
    await expect(heading).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`^${date}: (lots of free time|a little free time)`) })).toBeEnabled()
  })

  await test.step('tap the day, then a free stretch at Cliff 2', async () => {
    await page.getByRole('button', { name: new RegExp(`^${date}:`) }).click()
    const day = sheet(page)
    await expect(day).toBeVisible()
    const free = day.locator('[data-testid="free-gap"][data-house="cliff2"]').first()
    await expect(free).toContainText('Free')
    await free.click()
  })

  await test.step('pick any start and end, then request it', async () => {
    const ask = sheet(page, 'Ask for this time')
    await expect(ask).toBeVisible()
    const pick = ask.getByTestId('time-pick')
    await pick.getByRole('combobox').first().selectOption({ label: '3:15 PM' })
    await pick.getByRole('combobox').nth(1).selectOption({ label: '5:15 PM' })
    await expect(ask.getByText('Up to 2 h with just you')).toBeVisible()
    await ask.getByRole('button', { name: /^Request 3:15 PM–5:15 PM/ }).click()
  })

  await test.step('the shoot is waiting for the equipment team', async () => {
    const shoot = sheet(page, 'Your shoot')
    await expect(shoot).toBeVisible()
    await expect(shoot.getByText('Waiting for approval')).toBeVisible()
    await expect(shoot.getByText(/Sent to the equipment team/)).toBeVisible()
  })

  await test.step('the chat lists it as "Waiting for approval"', async () => {
    await page.keyboard.press('Escape')
    await openTab(page, 'Chat')
    await expect(page.getByText(/Your next 1 shoot|Your next shoot/)).toBeVisible()
    await expect(page.getByText(/Cliff 2 · 3:15 PM–5:15 PM/)).toBeVisible()
    await expect(page.getByText(/Waiting for approval/)).toBeVisible()
  })
})

test('free time: a creator asks for 6 hours with two people on the same booking (Nov 24)', async ({ page }) => {
  await signIn(page, 'newbie')
  // Not the first test's day (one house booking a day, and that day's label says "you film this day").
  const date = plainDayAhead(5)
  await openTab(page, 'Calendar')
  const [y, m] = date.split('-').map(Number)
  const monthName = new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
  await expect(page.getByRole('heading', { level: 2, name: /^[A-Z][a-z]+ \d{4}$/ })).toBeVisible()
  const heading = page.getByRole('heading', { level: 2, name: new RegExp(`${monthName} ${y}`) })
  if (!(await heading.isVisible())) await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${date}: (lots of free time|a little free time)`) })).toBeEnabled()
  await page.getByRole('button', { name: new RegExp(`^${date}:`) }).click()
  const day = sheet(page)
  await day.locator('[data-testid="free-gap"][data-house="cliff2"]').first().click()
  const ask = sheet(page, 'Ask for this time')
  const pick = ask.getByTestId('time-pick')
  await pick.getByRole('combobox').first().selectOption('660')
  await pick.getByRole('combobox').nth(1).selectOption('1020')   // 5 PM (shown as "5 PM · add people" until there are 3)
  // 6 hours alone is too long: it says how many people to add.
  await expect(ask.getByRole('button', { name: /Add 2 more people or shorten it/ })).toBeDisabled()
  const who = ask.getByTestId('who-films')
  await who.getByRole('button', { name: /\+ Add someone filming with you/ }).click()
  await who.getByPlaceholder('Search by name or channel').fill('Kyle')
  await who.getByRole('button', { name: /^Kyle/ }).first().click()
  await who.getByRole('button', { name: /\+ Add someone filming with you/ }).click()
  await who.getByPlaceholder('Search by name or channel').fill('Bob Test')
  await who.getByRole('button', { name: /Add "Bob Test"/ }).click()
  await ask.getByRole('button', { name: /^Request 11 AM–5 PM · 3 people/ }).click()
  const shoot = sheet(page, 'Your shoot')
  await expect(shoot.getByText('Waiting for approval')).toBeVisible()
  await expect(shoot.getByText(/Filming on this booking · 3 people/)).toBeVisible()
})
