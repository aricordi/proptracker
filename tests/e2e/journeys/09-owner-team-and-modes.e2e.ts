// Journey 9 — the owner: Team page groups fold open, the Settings sheet, and the everyday
// "Use the app as: Owner | Creator" switch (and back).
import { test, expect, reseed, signIn, openTab, tabs } from '../helpers'

test.beforeAll(() => reseed())

test('owner: Team groups open, Settings sheet, switch to the creator app and back', async ({ page }) => {
  await signIn(page, 'owner')

  await test.step('owner tabs include Team', async () => {
    for (const name of ['Chat', 'Calendar', 'Props', 'Me', 'Team']) await expect(tabs(page).getByRole('link', { name })).toBeVisible()
  })

  await test.step('Team page: groups fold open', async () => {
    await openTab(page, 'Team')
    await expect(page.getByRole('heading', { level: 1, name: /^Team/ })).toBeVisible()
    const people = page.getByRole('button', { name: /^Creators & people/ })
    await expect(people).toHaveAttribute('aria-expanded', 'false')
    await people.click()
    await expect(people).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('button', { name: /^People & access/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Analytics/ })).toBeVisible()
    await people.click()
    await expect(page.getByRole('button', { name: /^People & access/ })).toHaveCount(0)
    const rules = page.getByRole('button', { name: /^Rules & settings/ })
    await rules.click()
    await expect(rules).toHaveAttribute('aria-expanded', 'true')
  })

  await test.step('Settings sheet', async () => {
    await page.getByRole('button', { name: /^Settings sheet Every rule/ }).click()
    await expect(page).toHaveURL(/\/rules-sheet/)
    await expect(page.getByRole('heading', { level: 1, name: 'Settings sheet' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Props' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Gear' })).toBeVisible()
    await expect(page.getByText('Props we have: notice')).toBeVisible()
    await expect(page.getByText(/^\d+ open days?$/).first()).toBeVisible()
  })

  await test.step('switch to the creator app', async () => {
    await openTab(page, 'Me')
    const mode = page.getByRole('radiogroup', { name: 'Use the app as' })
    await expect(mode.getByRole('radio', { name: 'Owner' })).toHaveAttribute('aria-checked', 'true')
    await mode.getByRole('radio', { name: 'Creator' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(tabs(page).getByRole('link', { name: 'More' })).toBeVisible()
    await expect(tabs(page).getByRole('link', { name: 'Team' })).toHaveCount(0)
  })

  await test.step('…and back to the owner app', async () => {
    await openTab(page, 'More')
    const mode = page.getByRole('radiogroup', { name: 'Use the app as' })
    await expect(mode.getByRole('radio', { name: 'Creator' })).toHaveAttribute('aria-checked', 'true')
    await mode.getByRole('radio', { name: 'Owner' }).click()
    await expect(tabs(page).getByRole('link', { name: 'Team' })).toBeVisible()
    await expect(tabs(page).getByRole('link', { name: 'Me' })).toBeVisible()
  })
})
