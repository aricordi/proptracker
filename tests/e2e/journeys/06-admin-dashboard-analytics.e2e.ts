// Journey 6 — an admin checks the dashboard, walks every Analytics tab and opens a creator's record.
// The numbers depend on today's date, so this checks what is always there, not the counts.
import { test, expect, reseed, signIn } from '../helpers'

test.beforeAll(() => reseed())

test('admin: dashboard loads, every analytics tab opens, a creator record opens', async ({ page }) => {
  await signIn(page, 'admin')

  await test.step('the Dashboard loads', async () => {
    await expect(page.getByRole('heading', { level: 1, name: /^Dashboard/ })).toBeVisible()
    await expect(page.getByRole('tablist', { name: 'Date range' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'This month', selected: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Every creator' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Riley \(Creator\)/ }).first()).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Needs you now' })).toBeVisible()
  })

  await test.step('Open analytics', async () => {
    await page.getByRole('button', { name: 'Open analytics' }).click()
    await expect(page).toHaveURL(/\/analytics/)
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Creators', selected: true })).toBeVisible()
    await expect(page.getByRole('tablist', { name: 'Sort' })).toBeVisible()
  })

  const tabs: [string, (p: typeof page) => Promise<void>][] = [
    ['Flags', async p => { await expect(p.getByRole('heading', { level: 2, name: 'By type' })).toBeVisible() }],
    ['Teams', async p => {
      await expect(p.getByRole('heading', { level: 2, name: 'Right now' })).toBeVisible()
      await expect(p.getByRole('heading', { level: 2, name: 'Arts department' })).toBeVisible()
      await expect(p.getByRole('heading', { level: 2, name: 'Equipment team' })).toBeVisible()
    }],
    ['Trends', async p => {
      await expect(p.getByRole('tablist', { name: 'Pick what the chart shows' })).toBeVisible()
      await expect(p.getByRole('img', { name: /^Shoots filmed by (day|week|month)/ })).toBeVisible()
    }],
    ['Late returns', async p => { await expect(p.getByText(/Company rule: gear returned late carries a fee/)).toBeVisible() }],
    ['Creators', async p => { await expect(p.getByRole('tablist', { name: 'Sort' })).toBeVisible() }],
  ]
  for (const [name, check] of tabs) {
    await test.step(`the ${name} tab opens`, async () => {
      await page.getByRole('tab', { name, exact: true }).click()
      await expect(page.getByRole('tab', { name, exact: true, selected: true })).toBeVisible()
      await check(page)
    })
  }

  await test.step("open Riley's report card, then the full record", async () => {
    await page.getByRole('button', { name: /^\d+ Riley \(Creator\)/ }).click()
    await expect(page.getByRole('button', { name: 'Record ›' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Every shoot' })).toBeVisible()
    await page.getByRole('button', { name: 'Record ›' }).click()
    await expect(page).toHaveURL(/\/people\/creator%40example\.com|\/people\/creator@example\.com/)
    await expect(page.getByText('Riley (Creator)').first()).toBeVisible()
  })
})
