// Journey 13 — "Snap a photo, find it in the closet" (Nov 7): a creator taps the camera in the Props search box, picks a
// photo, and the closest props show at the top under "Looks like your photo". Test mode: the AI always sees a red rotary phone.
import { test, expect, reseed, signIn, openTab, testPhoto } from '../helpers'

test.beforeAll(() => reseed())

test('creator searches the closet with a photo, then clears it', async ({ page }) => {
  await signIn(page, 'creator')
  await openTab(page, 'Props')
  await expect(page.getByRole('button', { name: 'Search with a photo' })).toBeVisible()
  await page.getByTestId('photo-search-input').setInputFiles(testPhoto())
  const found = page.getByTestId('photo-results')
  await expect(found.getByText('Looks like your photo')).toBeVisible({ timeout: 30_000 })
  await expect(found.getByText('A red rotary phone')).toBeVisible()
  await expect(found.getByRole('button', { name: /Rotary phone/ }).first()).toBeVisible()
  // Open a match, come Back: the photo results are still there (no second AI use).
  await found.getByRole('button', { name: /Rotary phone/ }).first().click()
  await expect(page).toHaveURL(/\/item\//)
  await page.goBack()
  await expect(page.getByTestId('photo-results').getByText('Looks like your photo')).toBeVisible()
  await found.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByTestId('photo-results')).toHaveCount(0)
})

// The same photo search from the Chat (Nov 7): the camera next to the mic, the answer shows like prop ideas (tick + Add).
test('creator sends the chat a photo: "Looks like…" + props to tick', async ({ page }) => {
  await signIn(page, 'creator')
  await openTab(page, 'Props')
  await expect(page.locator('img').first()).toBeVisible({ timeout: 15_000 })   // the props list is loaded
  await openTab(page, 'Chat')
  await expect(page.getByRole('button', { name: 'Find props like a photo' })).toBeVisible()
  await page.getByTestId('chat-photo-input').setInputFiles(testPhoto())
  await expect(page.getByText('Find props like this photo')).toBeVisible()
  await expect(page.getByText(/Looks like a red rotary phone/)).toBeVisible({ timeout: 30_000 })
  const tick = page.getByRole('button', { name: /^Tick .*Rotary phone/ }).first()
  await expect(tick).toBeVisible({ timeout: 15_000 })
  await tick.click()
  await expect(page.getByRole('button', { name: /^Untick .*Rotary phone/ }).first()).toBeVisible()
})
