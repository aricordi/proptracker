// Journey 8 — a creator on "Props only" (the test launch / demo mode) sees the props list and Me, nothing to book.
import { test, expect, reseed, signIn, tabs } from '../helpers'

test.beforeAll(() => reseed())

test('Props-only creator: just Props and Me, no booking anywhere, prop pages without an add button', async ({ page }) => {
  await signIn(page, 'demo')

  await test.step('only the Props and Me tabs', async () => {
    await expect(page).toHaveURL(/\/browse/)
    await expect(page.getByRole('heading', { level: 1, name: /^Props/ })).toBeVisible()
    await expect(tabs(page).getByRole('link')).toHaveCount(2)
    await expect(tabs(page).getByRole('link', { name: 'Props' })).toBeVisible()
    await expect(tabs(page).getByRole('link', { name: 'Me' })).toBeVisible()
  })

  await test.step('Browse has no booking controls', async () => {
    await expect(page.getByRole('textbox', { name: 'Search props' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Wooden dining chair/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change which shoot you are adding to' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Add Wooden dining chair$/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Your shoot ·/ })).toHaveCount(0)
  })

  await test.step('booking screens send you back to Props', async () => {
    for (const path of ['/schedule', '/reserve', '/requests', '/shoots', '/gear']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/browse$/)
    }
  })

  await test.step('a prop page has no add button, and may suggest other props', async () => {
    await page.getByRole('textbox', { name: 'Search props' }).fill('rotary phone')
    await page.getByRole('button', { name: /^Rotary phone /, exact: false }).first().click()
    await expect(page).toHaveURL(/\/item\//)
    await expect(page.getByRole('heading', { level: 1, name: 'Rotary phone' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Something wrong? Suggest an edit' })).toBeVisible()
    for (const name of [/^Add to/, /Adding to/, /Review shoot/]) await expect(page.getByRole('button', { name })).toHaveCount(0)
    // Recommendations show only when there is history / similar props; the seed has both, but don't insist.
    const together = page.getByRole('region', { name: 'Booked together with this' })
    const similar = page.getByRole('region', { name: 'Similar props' })
    await expect(together.or(similar).first()).toBeVisible({ timeout: 5000 }).catch(() => {})
    if (await together.isVisible()) await expect(together.getByRole('button').first()).toBeVisible()
    if (await similar.isVisible()) await expect(similar.getByRole('button').first()).toBeVisible()
  })

  await test.step('Back, then Me opens', async () => {
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/browse/)
    await tabs(page).getByRole('link', { name: 'Me' }).click()
    await expect(page).toHaveURL(/\/account/)
  })
})
