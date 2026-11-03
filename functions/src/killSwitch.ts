// BILL LIMIT (owner, Nov 3, after the "$100K mistakes" reel: "alerts plus kill switch at 60 budget").
// Firebase can't cap what the website or the functions cost if someone floods them. Google Cloud can: a monthly budget
// (owner creates it once in Google Cloud → Billing → Budgets & alerts, $60, emails at 50 / 90 / 100 %) posts the current
// spend to the Pub/Sub topic BILL_TOPIC several times a day. This function reads each post and, once the spend reaches the
// budget, TURNS BILLING OFF for the project: everything paid stops at once (the app goes offline) so the bill can't keep
// climbing. The owner turns billing back on in Google Cloud → Billing → "Link a billing account".
// The data stays in the project; Google only deletes stopped resources if billing stays off for a long time.
import { onMessagePublished } from 'firebase-functions/v2/pubsub'
import { logger } from 'firebase-functions'
import { GoogleAuth } from 'google-auth-library'
import { db, OWNER_EMAIL } from './auth.js'
import { sendPush } from './push.js'
import { isPractice } from './practiceMode.js'

export const BILL_TOPIC = 'bill-limit'

export interface BudgetPost { costAmount?: number; budgetAmount?: number; currencyCode?: string; budgetDisplayName?: string; costIntervalStart?: string }

/** Cut billing only when this month's spend has reached the budget (and the post makes sense). */
export function shouldCut(p: BudgetPost): boolean {
  const cost = Number(p.costAmount), budget = Number(p.budgetAmount)
  return Number.isFinite(cost) && Number.isFinite(budget) && budget > 0 && cost >= budget
}

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-billing'] })

export const billLimit = onMessagePublished({ topic: BILL_TOPIC, retry: false }, async event => {
  const post = (event.data.message.json ?? {}) as BudgetPost
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || ''
  logger.info('Budget update', { ...post, project })
  await db.doc('app_settings/billLimit').set({ lastPost: post, lastAt: new Date().toISOString() }, { merge: true })
  if (!shouldCut(post) || !project || isPractice()) return

  const client = await auth.getClient()
  const name = `projects/${project}/billingInfo`
  const info = (await client.request<{ billingEnabled?: boolean }>({ url: `https://cloudbilling.googleapis.com/v1/${name}` })).data
  if (!info.billingEnabled) return   // already off

  const money = `${post.currencyCode ?? ''} ${Number(post.costAmount).toFixed(2)} of ${Number(post.budgetAmount).toFixed(2)}`.trim()
  logger.warn('Bill limit reached: turning billing off', { project, money })
  // Tell the owner FIRST (once billing is off, nothing else can run).
  await sendPush({ to: [OWNER_EMAIL], title: 'Bill limit reached', body: `This month's bill hit ${money}. The app is switching off to stop the bill. Turn billing back on in Google Cloud when you're ready.`, url: '/admin', tag: 'bill-limit' }).catch(() => 0)
  await db.doc('app_settings/billLimit').set({ cutAt: new Date().toISOString(), cutAtCost: post.costAmount ?? null }, { merge: true })
  await client.request({ url: `https://cloudbilling.googleapis.com/v1/${name}`, method: 'PUT', data: { billingAccountName: '' } })
})
