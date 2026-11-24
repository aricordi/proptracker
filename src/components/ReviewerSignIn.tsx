// OpenAI's app reviewers sign in here with the demo account the owner made (More → ChatGPT & Claude → Demo account).
// Only shown on the ChatGPT/Claude sign-in link (/connect), under the Google button. The demo account sees a practice copy
// of the studio: real props, made-up people and bookings; nothing it does reaches the studio team or the calendars.
import { useState } from 'react'
import { approveConnectorReviewer } from '../services/connector'
import { friendlyError } from '../lib/errors'

export default function ReviewerSignIn() {
  const req = new URLSearchParams(window.location.search).get('req') ?? ''
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  if (!req) return null
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    try { window.location.href = (await approveConnectorReviewer({ req, email: email.trim(), password })).data.redirect }
    catch (e2) { setErr(friendlyError(e2)); setBusy(false) }
  }
  if (!open) return <button onClick={() => setOpen(true)} className="mt-8 text-pt-muted text-sm underline underline-offset-4">App reviewer? Use the demo account</button>
  return (
    <form onSubmit={go} className="mt-8 w-full max-w-xs space-y-2" aria-label="Demo account sign-in">
      <p className="text-pt-text text-sm font-semibold text-center">Demo account (app review)</p>
      <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" required
        className="w-full min-h-[44px] rounded-xl bg-pt-surface text-pt-text px-3 text-[16px] shadow-hairline" />
      <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required
        className="w-full min-h-[44px] rounded-xl bg-pt-surface text-pt-text px-3 text-[16px] shadow-hairline" />
      <button disabled={busy || !email || !password} className="w-full min-h-[48px] rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">{busy ? 'Signing in…' : 'Sign in and allow'}</button>
      <p className="text-pt-muted text-xs text-center">Practice copy of the studio: nothing you do is sent to the team.</p>
      {err && <p className="text-amber-300 text-sm text-center">{err}</p>}
    </form>
  )
}
