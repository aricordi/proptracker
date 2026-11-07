// Journeys 2–4 — one props request from start to finish, through the real screens:
//   2. a creator finds a prop, adds it to a shoot and sends the request
//   3. the arts department picks it, takes a pack photo and marks it packed
//   4. the creator signs for the pickup and returns it with a photo; arts checks it in with one prop damaged
// The steps build on each other (serial). The file starts from fresh test data.
import { test, expect, reseed, signIn, openTab, sheet, testPhoto, getDoc, esc, dayLabel as labelOf } from '../helpers'

test.describe.configure({ mode: 'serial' })
// Riley's shoot next week (seed sh9: Cliff 1, 8 days out, 3–5 PM): always early enough to add props.
// Its date is read back from the test data, so the run can't trip over midnight between seeding and testing.
let shootDay = ''
test.beforeAll(async () => {
  reseed()
  shootDay = (await getDoc<{ date: string }>('shoots/sh9'))!.date
})

const TITLE = `Robot test ${Date.now().toString(36)}`

test('2. creator: search the props, add one to a shoot, send the request', async ({ page }) => {
  await signIn(page, 'creator')
  const dayLabel = await labelOf(page, shootDay)
  await openTab(page, 'Props')
  await expect(page).toHaveURL(/\/browse/)

  await test.step('pick the shoot to add to', async () => {
    await page.getByRole('button', { name: 'Change which shoot you are adding to' }).click()
    const which = sheet(page, 'Which shoot?')
    await which.getByRole('button', { name: new RegExp(`Cliff 1 · ${esc(dayLabel)} · 3 PM–5 PM`) }).click()
    await expect(page.getByRole('button', { name: 'Change which shoot you are adding to' })).toContainText(`${dayLabel} · 3 PM–5 PM`)
  })

  await test.step('search for it', async () => {
    await page.getByRole('textbox', { name: 'Search props' }).fill('rotary')
    await expect(page.getByRole('button', { name: /^Rotary phone .*free/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Wooden dining chair/ })).toHaveCount(0)
  })

  await test.step('open the prop and add 2 to the shoot', async () => {
    await page.getByRole('button', { name: /^Rotary phone .*free/ }).click()
    await expect(page).toHaveURL(/\/item\/phone$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Rotary phone' })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`Adding to Cliff 1 · ${esc(dayLabel)}`) })).toBeVisible()
    await expect(page.getByText('2 of 2 free on this day')).toBeVisible()
    await page.getByRole('button', { name: '+', exact: true }).click()
    await page.getByRole('button', { name: 'Add to this shoot' }).click()
    await expect(page.getByRole('button', { name: /Review shoot \(\d+\)/ })).toBeVisible()
  })

  await test.step('back on Browse, quick-add a chair with the + on its photo', async () => {
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/browse/)
    await page.getByRole('textbox', { name: 'Search props' }).fill('chair')
    await page.getByRole('button', { name: 'Add Wooden dining chair' }).click()
    await page.getByRole('button', { name: /Your shoot · \d+ props?.*Review/ }).click()
  })

  await test.step('review: the send button says what is missing, then name the video and send', async () => {
    await expect(page).toHaveURL(/\/reserve/)
    await expect(page.getByText('Rotary phone').first()).toBeVisible()
    await expect(page.getByText('Wooden dining chair').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Type a video name to send' })).toBeDisabled()
    await page.getByPlaceholder('Shoot or video name *').fill(TITLE)
    await page.getByRole('button', { name: 'Send the props' }).click()
  })

  await test.step('the request shows on the shoot', async () => {
    await expect(page).toHaveURL(/\/schedule/)
    const shoot = sheet(page, 'Your shoot')
    await expect(shoot.getByText('Sent ✓')).toBeVisible()
    await expect(shoot.getByText(TITLE)).toBeVisible()
  })

  await test.step('…and in My requests', async () => {
    await page.goto('/requests')
    await expect(page.getByText(TITLE).first()).toBeVisible()
  })
})

test('3. arts: open the request from the props queue, tick everything, pack photo, packed', async ({ page }) => {
  await signIn(page, 'arts')
  await expect(page.getByRole('heading', { level: 1, name: 'Props queue' })).toBeVisible()

  await test.step('find it under To prepare: the card says which shoot it is for', async () => {
    const dayLabel = await labelOf(page, shootDay)
    const shootLine = `Cliff 1 · ${dayLabel} · 3–5 PM · Riley (Creator)`
    await page.getByRole('button', { name: /^To prepare \(\d+\)/ }).click()
    const card = page.getByRole('button', { name: new RegExp(TITLE) })
    await expect(card.getByText(shootLine)).toBeVisible()
    // …and none of it is cut off on a phone-width card (it may take two lines; toBeVisible alone passes on cut text)
    const line = card.locator('[data-shoot-line]')
    expect(await line.evaluate(el => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await card.click()
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(page.getByText(shootLine)).toBeVisible()   // …and so does the top of the request page
    await expect(page.getByText('Picking list')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark packed & ready for pickup' })).toBeDisabled()
  })

  await test.step('tick each prop as picked', async () => {
    const ticks = page.getByRole('button', { name: 'Tick as picked' })
    await expect(ticks).toHaveCount(2)
    await ticks.first().click()
    await expect(page.getByRole('button', { name: 'Untick' })).toHaveCount(1)
    await page.getByRole('button', { name: 'Tick as picked' }).click()
    await expect(page.getByRole('button', { name: 'Untick' })).toHaveCount(2)
    await expect(page.getByText('2 of 2 done')).toBeVisible()
  })

  await test.step('take the pack photo', async () => {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Take photo' }).click()
    await (await chooser).setFiles(testPhoto('pack.png'))
    await expect(page.getByRole('button', { name: 'Mark packed & ready for pickup' })).toBeEnabled()
  })

  await test.step('mark it packed', async () => {
    await page.getByRole('button', { name: 'Mark packed & ready for pickup' }).click()
    await expect(page.getByText('Packed & ready').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark packed & ready for pickup' })).toHaveCount(0)
  })
})

test('4a. creator: signs for the pickup, then returns everything with one photo', async ({ page }) => {
  await signIn(page, 'creator')

  await test.step('open the packed request from My requests', async () => {
    await page.goto('/requests')
    await page.getByRole('button', { name: /Props & costumes · 2 props Packed & ready/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(page.getByText('Ready for pickup!')).toBeVisible()
    // The creator sees their shoot at the top too, without their own name.
    await expect(page.getByText(`Cliff 1 · ${await labelOf(page, shootDay)} · 3–5 PM`, { exact: true })).toBeVisible()
  })

  await test.step('sign off the pickup', async () => {
    await page.getByRole('button', { name: "✓ I've got everything" }).click()
    await expect(page.getByText('Collected').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Return these props' })).toBeVisible()
  })

  await test.step('return: what comes back, nothing broken, one photo, send', async () => {
    await page.getByRole('button', { name: 'Return these props' }).click()
    await expect(page).toHaveURL(/\/return\?ref=props:/)
    await expect(page.getByText('What are you bringing back?')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Return everything' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Props & costumes · 2 Rotary phone ×2, Wooden dining chair/, pressed: true })).toBeVisible()
    await page.getByRole('button', { name: 'No, all good' }).click()
    await expect(page.getByRole('button', { name: 'Take the photo first' })).toBeDisabled()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Take photo' }).click()
    await (await chooser).setFiles(testPhoto('return.png'))
    await page.getByRole('button', { name: 'Send the return' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'All returned' })).toBeVisible()
  })

  await test.step('the request now waits for the arts check-in', async () => {
    await page.getByRole('button', { name: 'See my requests' }).click()
    await expect(page.getByRole('button', { name: /Props & costumes · 2 props Returned, being checked/ })).toBeVisible()
  })
})

test('4b. arts: checks the return in with one prop damaged, and the prop shows Damaged', async ({ page }) => {
  await signIn(page, 'arts')

  await test.step('find it under Returns', async () => {
    await page.getByRole('button', { name: /^Returns \(1\)/ }).click()
    await page.getByRole('button', { name: new RegExp(TITLE) }).click()
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(page.getByText('Check in', { exact: true })).toBeVisible()
  })

  await test.step('phone damaged (with a note), chair fine', async () => {
    const card = (name: string) => page.locator('div')
      .filter({ has: page.getByText(name, { exact: true }) })
      .filter({ has: page.getByRole('button', { name: 'Damaged' }) }).last()
    await expect(page.getByRole('button', { name: 'Complete check-in' })).toBeDisabled()
    await card('Rotary phone').getByRole('button', { name: 'Damaged' }).click()
    await card('Rotary phone').getByPlaceholder('What happened? (required)').fill('Dial cracked in the robot test')
    await card('Wooden dining chair').getByRole('button', { name: '✓ Fine' }).click()
    await page.getByRole('button', { name: 'Complete check-in' }).click()
    await expect(page.getByText('Returned').first()).toBeVisible()
    await expect(page.getByText(/^Rotary phone: damaged/)).toBeVisible()
  })

  await test.step('the prop page says Damaged', async () => {
    await page.goto('/item/phone')
    await expect(page.getByRole('heading', { level: 1, name: 'Rotary phone' })).toBeVisible()
    await expect(page.getByText('Damaged', { exact: true }).first()).toBeVisible()
  })
})
