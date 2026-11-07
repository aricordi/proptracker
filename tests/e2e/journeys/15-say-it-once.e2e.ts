// Journey 15 — say it once, confirm once (owner, Nov 7): one message with a time AND props → one gold card with the free
// time and the props ticked → "Do it" asks for the time and sends the props. "Change something" = the usual two answers.
// The emulator has no AI, so the chat's reading of the message is faked here (the time and prop finders run for real).
import { test, expect, reseed, signIn, openTab, plainDayAhead, type Page } from '../helpers'

test.beforeAll(() => reseed())

// A plain weekday ~10 days out (well before the props cutoff, not a Cliff 1 priority day), at Cliff 2.
const date = plainDayAhead(10)
const month = new Date(`${date}T12:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
const when = `${month} ${Number(date.slice(8))} at 1pm at Cliff 2`
// The second test asks for a different time: the first one's request holds 1 PM, and an exact time that isn't free
// shows the separate answers instead of the one card.
const later = `${month} ${Number(date.slice(8))} at 5pm at Cliff 2`

// The props list loads in the background after sign-in; open Props once so the chat can show them (like a person would).
async function warmProps(page: Page) {
  await openTab(page, 'Props')
  await expect(page.getByRole('searchbox').or(page.getByRole('textbox')).first()).toBeVisible()
  await expect(page.locator('img').first()).toBeVisible({ timeout: 15_000 })
  await openTab(page, 'Chat')
}

async function fakeChat(page: Page, q = when) {
  await page.route('**/askChat', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ result: { action: 'times', reply: 'Love it, a cop prank!', query: q, also: { action: 'props', query: 'cop costume and handcuffs' }, steps: [], screens: [], chips: [], links: [] } }),
  }))
}

test('a time and props in one message: one card, untick one, Do it', async ({ page }) => {
  await signIn(page, 'newbie')
  await warmProps(page)
  await fakeChat(page)
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill(`${when}, I need a cop costume and handcuffs`)
  await box.press('Enter')

  const card = page.locator('div.rounded-\\[22px\\]').filter({ hasText: 'Ready to request' })
  await test.step('one card with the time and the props ticked', async () => {
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card.getByText(/1 PM–3 PM/)).toBeVisible()
    await expect(card.getByText(/Cliff 2/).first()).toBeVisible()
    await expect(card.getByRole('button', { name: 'Do it' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Change something' })).toBeVisible()
    // Not two separate answers: no Request buttons from the time list.
    await expect(page.getByRole('button', { name: 'Request', exact: true })).toHaveCount(0)
  })

  const ticks = card.getByRole('button', { name: /^Untick / })
  const n = await ticks.count()
  expect(n).toBeGreaterThan(0)
  await test.step('untick one prop', async () => {
    await ticks.first().click()
    await expect(card.getByRole('button', { name: /^Untick / })).toHaveCount(n - 1)
  })

  await test.step('Do it: time requested, props sent', async () => {
    await card.getByRole('button', { name: n > 1 ? 'Do it' : 'Request the time only' }).click()
    const done = page.locator('div.rounded-\\[22px\\]').filter({ hasText: 'Requested ✓' })
    await expect(done).toBeVisible({ timeout: 30_000 })
    if (n > 1) await expect(done.getByText(`${n - 1} prop${n - 1 === 1 ? '' : 's'} sent`)).toBeVisible()
    await expect(done.getByRole('button', { name: 'Open the shoot' })).toBeVisible()
  })
})

test('"Change something" shows the usual separate answers', async ({ page }) => {
  await signIn(page, 'kyle')
  await warmProps(page)
  await fakeChat(page, later)
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill(`${later}, cop costume and handcuffs`)
  await box.press('Enter')
  const card = page.locator('div.rounded-\\[22px\\]').filter({ hasText: /Ready to (request|book)/ })
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.getByRole('button', { name: 'Change something' }).click()
  await expect(card).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^(Request|Book)$/ }).first()).toBeVisible({ timeout: 15_000 })
})
