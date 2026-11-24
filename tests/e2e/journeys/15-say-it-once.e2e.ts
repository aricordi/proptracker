// Journey 15 — option A (owner, Nov 24): props ideas, finding times and planning happen in the person's own ChatGPT/Claude
// (the Prime Capitol connector). The app's chat hands those off with the message typed in, and the ✦ AI button opens the
// launcher (setup the first time, then "Open ChatGPT"). The emulator has no AI, so the chat's reading is faked here.
import { test, expect, reseed, signIn, openTab, type Page } from '../helpers'

test.beforeAll(() => reseed())

async function fakeChat(page: Page, action: string, query: string) {
  await page.route('**/askChat', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ result: { action, reply: 'Love it!', query, steps: [], screens: [], chips: [], links: [] } }),
  }))
}

test('a time and props ask is handed to ChatGPT/Claude with the message ready', async ({ page }) => {
  await signIn(page, 'newbie')
  await openTab(page, 'Chat')
  await fakeChat(page, 'times', 'Thursday at 1pm at Cliff 2')
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill('Thursday 1pm at Cliff 2, I need a cop costume')
  await box.press('Enter')
  await expect(page.getByText(/ChatGPT or Claude finds and requests a time/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /Open (ChatGPT|Claude)/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open the Calendar' })).toBeVisible()
  // Nothing was booked from the app's chat.
  await expect(page.getByRole('button', { name: 'Request', exact: true })).toHaveCount(0)
})

test('the ✦ AI button opens the ChatGPT / Claude launcher; how-to questions still work in the chat', async ({ page }) => {
  await signIn(page, 'kyle')
  await openTab(page, 'Calendar')
  await page.getByRole('button', { name: 'Open ChatGPT or Claude' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText(/Use Prime Capitol in ChatGPT or Claude|Ask your AI/)).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^Open ChatGPT/ })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^Open Claude/ })).toBeVisible()
  await sheet.getByRole('button', { name: 'How does the app work?' }).click()
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
})
