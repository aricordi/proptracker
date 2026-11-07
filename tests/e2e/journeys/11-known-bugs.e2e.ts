// Known app bugs, written as tests. Each is switched off (test.fixme) until the bug is fixed:
// fix the app, remove `.fixme`, and the test keeps it fixed.
import { test, expect, reseed, signIn, putDoc } from '../helpers'

test.beforeAll(() => reseed())

// FIXED (Nov 7, studioDayOf in src/lib/dates.ts): dates in a request's History (and "Signed by … on", "Returned …", Suggested edits, Activity day headers) take the
// day from the UTC timestamp (`at.slice(0, 10)`) but the time in Toronto time. From 7/8 PM until midnight in Toronto the
// date shows as TOMORROW: something done Jan 14 at 10:30 PM reads "Jan 15 10:30 p.m.".
// Code: src/screens/ReservationDetailScreen.tsx History (+ lines with `.at.slice(0, 10)`), src/components/ActivityList.tsx,
// src/components/Suggestions.tsx.
test('request history shows the Toronto day for something done late in the evening', async ({ page }) => {
  // Jan 15 03:30 UTC = Jan 14, 10:30 PM in Toronto.
  await putDoc('reservations/rs-evening', {
    title: 'Evening request', creatorEmail: 'creator@example.com', creatorName: 'Riley (Creator)',
    startDate: '2026-01-20', endDate: '2026-01-20', status: 'declined', lines: [{ itemId: 'chairs', itemName: 'Wooden dining chair', qty: 1 }],
    itemIds: ['chairs'], builds: [], createdAt: '2026-01-15T03:30:00.000Z', updatedAt: '2026-01-15T03:30:00.000Z',
    history: [{ status: 'requested', at: '2026-01-15T03:30:00.000Z', by: 'creator@example.com' }],
  })
  await signIn(page, 'arts')
  await page.goto('/reservations/rs-evening')
  await expect(page.getByRole('heading', { level: 1, name: 'Evening request' })).toBeVisible()
  await expect(page.getByText(/^Jan 14 10:30 p\.m\. · Requested by creator@example\.com/)).toBeVisible()
})
