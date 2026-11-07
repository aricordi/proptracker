// Journey 5 — the equipment team says yes to one booking request and no (with a reason) to another,
// then opens the Gear log and the Google Calendar tab.
import { test, expect, reseed, signIn, openTab, type Page } from '../helpers'

test.describe.configure({ mode: 'serial' })
test.beforeAll(() => reseed())

// One request card on the Requests screen (seed: Jana and Riley each asked for an evening slot in 3 days):
// the smallest box holding both the person's picture button and their "N of M filmed (30 days)" line.
const card = (page: Page, who: string) => page.locator('div')
  .filter({ has: page.getByRole('button', { name: `${who}'s record` }) })
  .filter({ has: page.getByText(/filmed \(30 days\)/) }).last()

test('equipment team approves one request, denies another with a reason, opens the Gear log and Google Calendar', async ({ page }) => {
  await signIn(page, 'gear')

  await test.step('starts on the Gear log', async () => {
    await expect(page.getByRole('heading', { level: 1, name: 'Gear log' })).toBeVisible()
  })

  await test.step('Requests shows the two waiting requests', async () => {
    await openTab(page, 'Requests')
    await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Bookings\s*2/, selected: true })).toBeVisible()
    await expect(page.getByText('2 waiting for a yes or no, soonest first.')).toBeVisible()
    await expect(card(page, 'Jana').getByText(/Cliff 1 · 7 PM–9 PM/)).toBeVisible()
    await expect(card(page, 'Riley (Creator)').getByText(/Cliff 1 · 9 PM–11 PM/)).toBeVisible()
  })

  await test.step("approve Jana's", async () => {
    await card(page, 'Jana').getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByRole('button', { name: "Jana's record" })).toHaveCount(0)
    await expect(page.getByText('1 waiting for a yes or no, soonest first.')).toBeVisible()
  })
  // BUG (reported): the card's "Approved ✓ Jana gets a notification." / "Denied. Riley gets your reason." confirmation
  // lives inside the request card, which disappears the moment the request is decided, so nobody ever sees it.
  await test.step.skip('BUG: a confirmation stays on screen after Approve / Deny', async () => {
    await expect(page.getByText('Approved ✓ Jana gets a notification.')).toBeVisible()
  })

  await test.step("deny Riley's with a reason", async () => {
    const riley = card(page, 'Riley (Creator)')
    await riley.getByRole('button', { name: 'Deny' }).click()
    const confirm = riley.getByRole('button', { name: 'Deny' })
    await expect(confirm).toBeDisabled()   // a reason is required
    await riley.getByPlaceholder(/Why\? Riley reads this/).fill('Robot test: please pick another time')
    await confirm.click()
    await expect(page.getByRole('button', { name: "Riley (Creator)'s record" })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Bookings', exact: true, selected: true })).toBeVisible()
  })

  await test.step('the Gear log opens', async () => {
    await openTab(page, 'Gear log')
    await expect(page.getByRole('heading', { level: 1, name: 'Gear log' })).toBeVisible()
    for (const t of [/^Today/, /^Out/, /^To check in/, /^Upcoming/, /^Past/]) await expect(page.getByRole('button', { name: t })).toBeVisible()
  })

  await test.step('the Google Calendar tab opens', async () => {
    await openTab(page, 'Requests')
    await page.getByRole('tab', { name: 'Google Calendar' }).click()
    await expect(page.getByRole('tab', { name: 'Google Calendar', selected: true })).toBeVisible()
    await expect(page).toHaveURL(/tab=calendar/)
    await expect(page.getByText(/^Google Calendar is checked every 15 minutes/)).toBeVisible()
    await expect(page.getByText('All checked ✓')).toBeVisible()   // nothing imported in the test data
    await expect(page.getByRole('button', { name: 'Check now' })).toBeVisible()
  })
})

test('the creator sees that the request was not approved, with the reason', async ({ page }) => {
  // Runs after the test above (same file, one worker): Riley's 9 PM request was denied with a reason.
  await signIn(page, 'creator')
  await expect(page).toHaveURL(/\/$/)
  const notice = page.getByText(/^Not approved: .*Cliff 1 · 9 PM–11 PM/)
  await expect(notice).toBeVisible()
  await expect(page.getByText('"Robot test: please pick another time"')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Find a new time' })).toBeVisible()
})
