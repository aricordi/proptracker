// PRACTICE SITE (owner, Nov 3: "a test mode that doesn't actually book anything or send anything to the arts or equipment
// teams, but I can test their workflows for all the different versions of the app"; owner picked a separate practice site).
//
// The practice site is a SEPARATE Firebase project (its own database, files, functions and web address) filled with a copy
// of the real props + practice people and shoots. Nothing done there can reach the real app.
// This file only works there: `isPractice()` needs PRACTICE=1, which the practice deploy writes into functions/.env.<project>
// (never committed, never on the live project), AND a project that isn't the live one. On the live app every call is refused.
//
// `practiceSwitch` lets the owner become any practice person (creator, arts, equipment, admin…) for real: the server signs the
// app in as that person, so every screen, rule and server check is the genuine one for that role.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import { db, CALLABLE, OWNER_EMAIL } from './auth.js'

import { isPractice } from './practiceMode.js'
export { isPractice, LIVE_PROJECT } from './practiceMode.js'

export interface PracticePerson { email: string; name: string; role: string; access?: string }

/** Who you can switch to: the owner + everyone in the practice project's people list. */
async function practicePeople(): Promise<PracticePerson[]> {
  const snap = await db.collection('users').get()
  const people = snap.docs.filter(d => d.get('active') === true).map(d => ({
    email: d.id, name: String(d.get('name') || d.id), role: String(d.get('role') || ''), ...(d.get('access') ? { access: String(d.get('access')) } : {}),
  }))
  return [{ email: OWNER_EMAIL, name: 'You (owner)', role: 'owner' }, ...people.filter(p => p.email !== OWNER_EMAIL)]
}

export const practiceSwitch = onCall({ ...CALLABLE }, async req => {
  if (!isPractice()) throw new HttpsError('permission-denied', 'This only works on the practice site.')
  const me = req.auth?.token?.email?.toLowerCase()
  if (!me || req.auth?.token?.email_verified !== true) throw new HttpsError('unauthenticated', 'Sign in first.')
  const people = await practicePeople()
  // Only the owner (signed in with Google) or someone they switched into can switch.
  if (!people.some(p => p.email === me)) throw new HttpsError('permission-denied', 'Not allowed')
  if (req.data?.list) return { people }
  const to = String(req.data?.email ?? '').toLowerCase()
  const person = people.find(p => p.email === to)
  if (!person) throw new HttpsError('not-found', 'That practice person is not on the list.')
  const auth = getAuth()
  const user = await auth.getUserByEmail(to).catch(async () =>
    auth.createUser({ email: to, emailVerified: true, displayName: person.name }))
  if (!user.emailVerified) await auth.updateUser(user.uid, { emailVerified: true })
  return { token: await auth.createCustomToken(user.uid), person }
})
