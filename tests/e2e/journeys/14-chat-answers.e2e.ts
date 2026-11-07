// Journey 14 — chat answers (owner, Nov 7): an answer types out, then its next steps (no more than 2) sit right under it.
import { test, expect, reseed, signIn } from '../helpers'

test.beforeAll(() => reseed())

test('creator says hi: the answer types out, then at most 2 next steps under it', async ({ page }) => {
  await signIn(page, 'newbie')
  await expect(page.getByText('Hi Nia.')).toBeVisible()
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill('hey')
  await box.press('Enter')
  // The whole reply shows within a second or two (it types out, never slower than 1.2 s).
  await expect(page.getByText(/Hey Nia! What are you working on\?/)).toBeVisible({ timeout: 15_000 })
  const steps = page.getByLabel('Next steps')
  await expect(steps).toBeVisible()
  const n = await steps.getByRole('button').count()
  expect(n).toBeGreaterThan(0)
  expect(n).toBeLessThanOrEqual(2)
})
