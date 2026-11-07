// Journey 7 — the arts department tidies the closet: Clean up props hub, combine a group of doubles,
// combine from a prop page (⋯ → Find duplicates), remove a prop and undo it, then Prop insights.
// Seed: three rotary phones in bin A2 ("Rotary phone" ×2, "Rotary phones" ×1, "Red rotary phone" ×1).
import { test, expect, reseed, signIn, openTab, sheet, type Page } from '../helpers'

test.describe.configure({ mode: 'serial' })
test.beforeAll(() => reseed())

const tile = (page: Page, name: string) => page.locator('div')
  .filter({ has: page.getByText(name, { exact: true }) })
  .filter({ has: page.getByRole('button', { name: /^(✓ Same|Not this one)$/ }) }).last()

test('7a. Clean up props hub → combine a group of doubles (one unticked)', async ({ page }) => {
  await signIn(page, 'arts')

  await test.step('the Admin tab leads to Clean up props', async () => {
    await openTab(page, 'Admin')
    await page.getByRole('button', { name: /^Clean up props \d+ to check/ }).click()
    await expect(page).toHaveURL(/\/cleanup$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Clean up props' })).toBeVisible()
    await expect(page.getByText(/of \d+ props checked/)).toBeVisible()
    await page.getByRole('button', { name: 'Got it' }).click()   // the one-minute "How this works"
    await expect(page.getByRole('heading', { level: 2, name: 'Do it in this order' })).toBeVisible()
  })

  await test.step('step 1, Combine doubles, shows the three phones as one group', async () => {
    await page.getByRole('button', { name: /^1 Combine doubles/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Doubles' })).toBeVisible()
    await expect(page.getByText('Combine the 3 ticked?')).toBeVisible()
    for (const n of ['Rotary phone', 'Rotary phones', 'Red rotary phone']) await expect(tile(page, n)).toBeVisible()
  })

  await test.step('untick the red one and combine the other two as separate copies', async () => {
    await tile(page, 'Red rotary phone').getByRole('button', { name: '✓ Same' }).click()
    await expect(tile(page, 'Red rotary phone').getByRole('button', { name: 'Not this one' })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Combine 2' }).click()
    await expect(page.getByText(/How should the 2 become one\?/)).toBeVisible()
    await page.getByRole('button', { name: /We have two separate copies.*= 3/ }).click()
    await expect(page.getByText('Combined 2 into one ✓')).toBeVisible()
    await expect(page.getByText('No doubles left ✓')).toBeVisible()   // the red one was marked as not the same
  })

  await test.step('the kept prop now has all 3', async () => {
    await page.goto('/item/phone')
    await expect(page.getByRole('heading', { level: 1, name: 'Rotary phone' })).toBeVisible()
    await expect(page.getByText(/3 in stock/)).toBeVisible()
  })
})

test('7b. prop page ⋯ → Find duplicates → combine', async ({ page }) => {
  await signIn(page, 'arts')
  await page.goto('/item/imp-phone3')
  await expect(page.getByRole('heading', { level: 1, name: 'Red rotary phone' })).toBeVisible()

  await test.step('open the ⋯ menu and Find duplicates', async () => {
    await page.getByRole('button', { name: 'Manage this prop' }).click()
    await sheet(page, 'Manage this prop').getByRole('button', { name: /^Find duplicates/ }).click()
    await expect(sheet(page, 'Duplicates of this prop')).toBeVisible()
  })

  await test.step('search for the other phone, tick it, combine as copies', async () => {
    const dup = sheet(page, 'Duplicates of this prop')
    await dup.getByPlaceholder('Not listed? Search by name').fill('Rotary phone')
    await dup.getByRole('button', { name: 'Tick Rotary phone', exact: true }).first().click()
    await dup.getByRole('button', { name: /Combine 1 with this one/ }).click()
    const how = sheet(page, 'How should they be combined?')
    await expect(how.getByText('Keeps ✓')).toBeVisible()
    await how.getByRole('button', { name: /We have 2 separate copies.*= 4/ }).click()
    await expect(how).toHaveCount(0)
  })

  await test.step('this prop now counts 4', async () => {
    await expect(page.getByText(/4 in stock/)).toBeVisible()
  })
})

test('7c. remove a prop from its ⋯ menu, then Undo', async ({ page }) => {
  await signIn(page, 'arts')
  await page.goto('/item/imp-fan')
  await expect(page.getByRole('heading', { level: 1, name: 'Paper hand fan' })).toBeVisible()

  await test.step('Remove this prop → a reason', async () => {
    await page.getByRole('button', { name: 'Manage this prop' }).click()
    await sheet(page, 'Manage this prop').getByRole('button', { name: /^Remove this prop/ }).click()
    await sheet(page, /^Remove "Paper hand fan"\?/).getByRole('button', { name: 'Not a prop', exact: true }).click()
    await expect(page.getByRole('status').getByText('Removed "Paper hand fan"')).toBeVisible()
    await expect(page.getByText(/Removed in the clean-up/)).toBeVisible()
  })

  await test.step('Undo puts it back', async () => {
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText(/Removed in the clean-up/)).toHaveCount(0)
    await page.goto('/cleanup/removed')
    await expect(page.getByText('Paper hand fan')).toHaveCount(0)
  })
})

test('7d. Prop insights loads', async ({ page }) => {
  await signIn(page, 'arts')
  await openTab(page, 'Admin')
  await page.getByRole('button', { name: /^Prop insights/ }).click()
  await expect(page).toHaveURL(/\/insights/)
  await expect(page.getByRole('heading', { level: 1, name: 'Prop insights' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '30 days', selected: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Most booked' })).toBeVisible()
  await page.getByRole('tab', { name: 'All time' }).click()
  await expect(page.getByRole('tab', { name: 'All time', selected: true })).toBeVisible()
  // The phones were combined in 7a/7b: their requests now count on the kept prop; the chairs are untouched.
  await expect(page.getByRole('region', { name: 'Most booked' }).getByRole('button', { name: /^Wooden dining chair/ })).toBeVisible()
})
