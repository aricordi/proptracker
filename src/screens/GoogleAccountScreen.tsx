// Owner only: connect the Prime Capitol Google account (e.g. bookings@primecapitol.ca) that the app uses for the
// shared calendar and for sending emails. Server side: functions/src/googleAccount.ts.
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { friendlyError } from '../lib/errors'
import { formatDay } from '../lib/dates'

interface Status {
  redirectUri: string; clientId: string; secret: string; server: string
  connected: { email: string; calendar: boolean; gmail: boolean; connectedAt: string; connectedBy: string; broken: string } | null
}
const googleAccountStatus = httpsCallable<Record<string, never>, Status>(functions, 'googleAccountStatus')
const saveGoogleClient = httpsCallable<{ clientId: string; clientSecret: string }, { ok: boolean }>(functions, 'saveGoogleClient')
const googleConnectStart = httpsCallable<{ origin: string; loginHint?: string }, { url: string }>(functions, 'googleConnectStart')
const googleDisconnect = httpsCallable<Record<string, never>, { ok: boolean }>(functions, 'googleDisconnect')

const CONSOLE = 'https://console.cloud.google.com/apis/credentials?project=proptracker-9732e'
const GMAIL_API = 'https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=proptracker-9732e'
const BACK_ERRORS: Record<string, string> = {
  expired: 'That sign-in took too long. Tap Connect again.',
  access_denied: 'Sign-in was cancelled on Google\'s page.',
  no_refresh: 'Google didn\'t give a lasting connection. Tap Connect again.',
  admin_policy_enforced: 'Prime Capitol\'s Google admin blocks this app. Ask IT to trust it (see below).',
}

export default function GoogleAccountScreen() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [s, setS] = useState<Status | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [hint, setHint] = useState('')
  const [copied, setCopied] = useState('')
  const back = params.get('connected') ? 'Connected ✓' : ''
  const backErr = params.get('error')

  const load = () => googleAccountStatus({}).then(r => { setS(r.data); setClientId(c => c || r.data.clientId) }).catch(e => setErr(friendlyError(e)))
  useEffect(() => { load() }, [])
  useEffect(() => { if (back || backErr) { const t = setTimeout(() => setParams({}, { replace: true }), 8000); return () => clearTimeout(t) } }, [back, backErr, setParams])

  async function run(what: string, f: () => Promise<unknown>) {
    setBusy(what); setErr('')
    try { await f(); await load() } catch (e) { setErr(friendlyError(e)) } finally { setBusy('') }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(''), 1500) } catch { /* shown anyway */ } }
  async function connect() {
    setBusy('connect'); setErr('')
    try { window.location.href = (await googleConnectStart({ origin: window.location.origin, loginHint: hint || undefined })).data.url }
    catch (e) { setErr(friendlyError(e)); setBusy('') }
  }

  const c = s?.connected
  const setupDone = !!s?.clientId && !!s?.secret
  const card = 'bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3'
  const field = 'w-full bg-pt-bg rounded-xl px-3 py-2.5 text-pt-text placeholder-pt-muted shadow-hairline focus:outline-none'
  const step = (n: number, done: boolean, title: string, body: React.ReactNode) => (
    <div className="flex gap-3">
      <span className={`w-6 h-6 rounded-full grid place-items-center text-xs font-bold shrink-0 ${done ? 'bg-green-500/20 text-green-400' : 'bg-pt-accent/20 text-pt-accent'}`}>{done ? '✓' : n}</span>
      <div className="flex-1 min-w-0 space-y-2"><p className="text-pt-text text-[15px] font-medium">{title}</p>{body}</div>
    </div>
  )
  const copyBox = (text: string) => (
    <button onClick={() => copy(text)} className="w-full text-left bg-pt-bg rounded-xl px-3 py-2 text-[13px] text-pt-text break-all">
      {text} <span className="text-pt-accent font-semibold">{copied === text ? ' Copied ✓' : ' Copy'}</span>
    </button>
  )

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-pt-text py-1 tap">‹</button>
        <h1 className="font-display text-xl text-pt-text">Google account</h1>
      </div>
      <div className="px-4 pt-2 pb-8 space-y-6">
        <p className="text-pt-muted text-sm">One Prime Capitol account (for example <b>bookings@primecapitol.ca</b>) that the app uses to update the shared calendar and to send its emails. It can only add/change events in calendars shared with it and send email. It can't read the inbox or anything else.</p>

        {back && <p className="text-green-400 text-sm font-medium">{back}</p>}
        {backErr && <p className="text-amber-300 text-sm">{BACK_ERRORS[backErr] ?? `Google said: ${backErr}. Try again.`}</p>}
        {err && <p className="text-amber-300 text-sm">{err}</p>}
        {!s && !err && <p className="text-pt-muted text-sm">Loading…</p>}

        {s && c && (
          <section className={card}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-pt-text font-semibold break-all">{c.email}</p>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold shrink-0 ${c.broken ? 'bg-red-500/15 text-red-300' : 'bg-green-500/15 text-green-400'}`}>{c.broken ? 'Needs reconnecting' : 'Connected'}</span>
            </div>
            {c.broken && <p className="text-red-300 text-sm">{c.broken}</p>}
            <p className="text-pt-muted text-sm">{c.calendar ? '✓' : '✕'} Shared calendar · {c.gmail ? '✓' : '✕'} Sending emails</p>
            {(!c.calendar || !c.gmail) && <p className="text-amber-300 text-xs">A box was unticked on Google's page. Connect again and leave both ticked.</p>}
            <p className="text-pt-muted text-xs">Connected {formatDay(c.connectedAt.slice(0, 10))} by {c.connectedBy}</p>
            <div className="flex gap-2">
              <button onClick={connect} disabled={!!busy || !setupDone} className="flex-1 bg-pt-bg rounded-xl py-2.5 text-pt-text text-sm font-medium disabled:opacity-40">{busy === 'connect' ? 'Opening Google…' : 'Connect again'}</button>
              <button onClick={() => { if (confirm('Disconnect? The calendar copies and emails stop until it is connected again.')) run('off', () => googleDisconnect({})) }} disabled={!!busy}
                className="flex-1 bg-pt-bg rounded-xl py-2.5 text-red-300 text-sm font-medium disabled:opacity-40">{busy === 'off' ? 'Disconnecting…' : 'Disconnect'}</button>
            </div>
            <p className="text-pt-muted text-xs">Next: share the shooting calendar with {c.email} (Schedule settings), and pick "Prime Capitol Google account" on the Email screen.</p>
          </section>
        )}

        {s && (
          <section className={`${card} space-y-4`}>
            <h2 className="text-pt-text font-semibold">{c ? 'Setup' : 'Set it up (once)'}</h2>
            {step(1, setupDone, 'Make the sign-in setup in your Google Cloud', <>
              <p className="text-pt-muted text-xs">Google Cloud → APIs & Services → <b>OAuth consent screen</b>: User type External, app name "Prime Capitol", your email, then <b>Publish app</b> (otherwise the connection stops after 7 days). Then <b>Credentials</b> → Create credentials → OAuth client ID → <b>Web application</b> → under "Authorized redirect URIs" add:</p>
              {copyBox(s.redirectUri)}
              <a href={CONSOLE} target="_blank" rel="noreferrer" className="inline-block text-pt-accent text-sm tap">Open Google Cloud ›</a>
              <p className="text-pt-muted text-xs">Also turn on the <a href={GMAIL_API} target="_blank" rel="noreferrer" className="text-pt-accent">Gmail API</a> (the Calendar API should already be on).</p>
            </>)}
            {step(2, setupDone, 'Paste the client ID and secret', <>
              <input value={clientId} onChange={e => setClientId(e.target.value.trim())} placeholder="1234-abc.apps.googleusercontent.com" className={field} autoCapitalize="none" />
              <input value={secret} onChange={e => setSecret(e.target.value.trim())} placeholder={s.secret ? `Secret saved (${s.secret}) · paste to replace` : 'Client secret'} className={field} autoCapitalize="none" autoComplete="off" />
              <button onClick={() => run('save', async () => { await saveGoogleClient({ clientId, clientSecret: secret }); setSecret('') })}
                disabled={!!busy || !clientId || (!secret && !s.secret) || (clientId === s.clientId && !secret)}
                className="bg-pt-accent text-stone-900 font-semibold rounded-xl px-4 py-2 text-sm disabled:opacity-40">{busy === 'save' ? 'Saving…' : 'Save'}</button>
              <p className="text-pt-muted text-xs">Kept on the server only. Phones never see the secret again.</p>
            </>)}
            {step(3, !!c && !c.broken, 'Sign in as the Prime Capitol account', <>
              <p className="text-pt-muted text-xs">Use the company account IT made, not your own. Google may say "Google hasn't verified this app": tap Advanced → Go to Prime Capitol (it's your own app). Leave both boxes ticked.</p>
              <input value={hint} onChange={e => setHint(e.target.value.trim())} placeholder="bookings@primecapitol.ca (optional)" className={field} autoCapitalize="none" type="email" />
              <button onClick={connect} disabled={!!busy || !setupDone} className="bg-pt-accent text-stone-900 font-semibold rounded-xl px-4 py-2 text-sm disabled:opacity-40">{busy === 'connect' ? 'Opening Google…' : c ? 'Connect again' : 'Connect with Google'}</button>
            </>)}
          </section>
        )}

        {s && (
          <section className={card}>
            <h2 className="text-pt-text font-semibold">For Prime Capitol's IT</h2>
            <p className="text-pt-muted text-xs">If Google says the admin blocks the app: Admin console → Security → Access and data control → API controls → Manage third-party app access → Configure new app → paste the client ID → <b>Trusted</b>. To cut the app off any time: remove it there, suspend the account, or unshare the calendar.</p>
            {s.clientId && copyBox(s.clientId)}
            {!c && s.server && <p className="text-pt-muted text-xs">Until it's connected, the calendar uses the app's server address: {s.server}</p>}
          </section>
        )}
      </div>
    </div>
  )
}
