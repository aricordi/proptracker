import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import {
  subscribeToEmailSettings, saveEmailSettings, subscribeToOutbox, sendTestEmail,
  EMPTY_EMAIL_SETTINGS, type EmailSettings, type OutboxEmail,
} from '../services/email'
import { formatDay } from '../lib/dates'

// Ready-made settings for the services we've talked about. Switching later
// (e.g. Gmail → Resend) = pick the service, change the login, update the secret.
const SERVICES = [
  { key: 'gmail',  label: 'Gmail / Workspace', host: 'smtp.gmail.com',       port: 465, user: '',       hint: 'Login = the Gmail address. Password = a Google app password.' },
  { key: 'icloud', label: 'iCloud',            host: 'smtp.mail.me.com',     port: 587, user: '',       hint: 'Login = your full @icloud.com address. Password = an Apple app-specific password.' },
  { key: 'yahoo',  label: 'Yahoo',             host: 'smtp.mail.yahoo.com',  port: 465, user: '',       hint: 'Login = your Yahoo address. Password = a Yahoo app password.' },
  { key: 'resend', label: 'Resend',            host: 'smtp.resend.com',      port: 465, user: 'resend', hint: 'Login = resend. Password = your Resend API key. Needs a verified domain.' },
  { key: 'brevo',  label: 'Brevo',             host: 'smtp-relay.brevo.com', port: 587, user: '',       hint: 'Login + password = your Brevo SMTP login and key. Needs a verified domain.' },
]

const googleAccountStatus = httpsCallable<Record<string, never>, { connected: { email: string; gmail: boolean; broken: string } | null }>(functions, 'googleAccountStatus')

const STATUS_STYLE: Record<string, string> = {
  sent: 'text-green-400', skipped: 'text-pt-muted', failed: 'text-red-300',
}

export default function EmailSettingsScreen() {
  const navigate = useNavigate()
  const [saved, setSaved] = useState<EmailSettings>(EMPTY_EMAIL_SETTINGS)
  const [form, setForm] = useState<EmailSettings>(EMPTY_EMAIL_SETTINGS)
  const [outbox, setOutbox] = useState<OutboxEmail[]>([])
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle')
  const [testState, setTestState] = useState<string | null>(null)

  useEffect(() => subscribeToEmailSettings(s => {
    setSaved(s)
    setForm({ ...s, appUrl: s.appUrl || window.location.origin })
  }), [])
  useEffect(() => subscribeToOutbox(setOutbox), [])
  // The connected Prime Capitol Google account (Admin → Google account), if any.
  const [google, setGoogle] = useState<{ email: string; gmail: boolean; broken: string } | null | undefined>(undefined)
  useEffect(() => { googleAccountStatus({}).then(r => setGoogle(r.data.connected)).catch(() => setGoogle(null)) }, [])
  const viaGoogle = form.service === 'google'
  const googleOk = !!google && google.gmail && !google.broken

  const service = SERVICES.find(s => s.host === form.host)
  const set = (patch: Partial<EmailSettings>) => { setForm(f => ({ ...f, ...patch })); setState('idle') }
  const changed = JSON.stringify(form) !== JSON.stringify(saved)
  const ready = viaGoogle ? googleOk : !!form.host && !!form.user && /@/.test(form.fromAddress || form.user)

  async function save() {
    setState('busy')
    try {
      await saveEmailSettings({ ...form, fromAddress: form.fromAddress || (viaGoogle ? '' : form.user) })
      setState('saved')
    } catch { setState('error') }
  }

  async function test() {
    setTestState('Sending…')
    try {
      await sendTestEmail()
      setTestState('Queued. Watch "Recent emails" below; check your inbox (and spam).')
    } catch { setTestState("Couldn't queue the test. Try again.") }
  }

  const input = 'w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent'
  const label = 'text-pt-muted text-[13px]'

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-pt-text py-1">‹</button>
        <h1 className="font-display text-xl text-pt-text">Email</h1>
      </div>
      <div className="px-4 pt-4 pb-8 space-y-6">
        <Link to="/connections" className="block bg-pt-accent/10 text-pt-accent text-sm rounded-2xl px-4 py-3">The simple way: turn emails on in <b>Calendar &amp; email</b> ›. This page is for the recent-emails list and other email services.</Link>
        <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-pt-text font-medium">Send emails</span>
              <span className="block text-pt-muted text-sm">Booking updates, late notices and at-risk warnings. While off, nothing is sent.</span>
            </span>
            <input type="checkbox" checked={form.enabled} onChange={e => set({ enabled: e.target.checked })}
              disabled={!ready && !form.enabled} className="w-6 h-6 accent-amber-500 shrink-0" />
          </label>
        </div>

        <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
          <p className="text-pt-text font-medium">Send with</p>
          <div className="grid grid-cols-2 gap-2">
            {([['google', 'Prime Capitol Google account'], ['smtp', 'An email service + password']] as const).map(([k, l]) => (
              <button key={k} onClick={() => set({ service: k })}
                className={`px-3 py-2.5 rounded-xl text-sm text-left ${form.service === k ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-bg shadow-hairline text-pt-muted'}`}>{l}</button>
            ))}
          </div>
          {viaGoogle ? <>
            {google === undefined ? <p className="text-pt-muted text-xs">Checking the account…</p>
              : googleOk ? <p className="text-green-400 text-sm">Emails go out from {google!.email} ✓</p>
              : <p className="text-amber-300 text-sm">{google ? (google.broken || 'The account is connected but "send emails" was unticked.') : 'No Prime Capitol Google account connected yet.'} <Link to="/connections" className="text-pt-accent">Set it up ›</Link></p>}
            <label className="block space-y-1">
              <span className={label}>Send from (address people see)</span>
              <input value={form.fromAddress} onChange={e => set({ fromAddress: e.target.value.trim() })} placeholder={google?.email ?? 'the connected account'} className={input} autoCapitalize="none" />
              <span className="block text-pt-muted text-xs">Leave empty to use the account itself. Another address (like an alias) must first be added in that account's Gmail → Settings → Accounts → "Send mail as".</span>
            </label>
          </> : <>
          <div className="flex gap-2 flex-wrap">
            {SERVICES.map(s => (
              <button key={s.key} onClick={() => set({ host: s.host, port: s.port, user: s.user || (form.user === 'resend' ? '' : form.user) })}
                className={`px-3 py-2 rounded-full text-sm ${service?.key === s.key ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-bg shadow-hairline text-pt-muted'}`}>
                {s.label}
              </button>
            ))}
          </div>
          {service && <p className="text-pt-muted text-xs">{service.hint}</p>}
          <label className="block space-y-1">
            <span className={label}>Login</span>
            <input value={form.user} onChange={e => set({ user: e.target.value.trim() })} placeholder="you@icloud.com" className={input} autoCapitalize="none" />
          </label>
          <label className="block space-y-1">
            <span className={label}>Send from (address people see)</span>
            <input value={form.fromAddress} onChange={e => set({ fromAddress: e.target.value.trim() })} placeholder={form.user.includes('@') ? form.user : 'same as login'} className={input} autoCapitalize="none" />
          </label>
          <details className="text-pt-muted text-xs">
            <summary>Advanced</summary>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <input value={form.host} onChange={e => set({ host: e.target.value.trim() })} className={`${input} col-span-2`} aria-label="Server" />
              <select value={form.port} onChange={e => set({ port: Number(e.target.value) })} className={input} aria-label="Port">
                <option value={465}>465</option><option value={587}>587</option>
              </select>
            </div>
          </details>
          <p className="text-pt-muted text-xs">The password isn't stored here. It's kept in Google Secret Manager as <b>SMTP_PASSWORD</b>.</p>
          </>}
          <label className="block space-y-1">
            <span className={label}>Sender name</span>
            <input value={form.fromName} onChange={e => set({ fromName: e.target.value })} className={input} />
          </label>
          <label className="block space-y-1">
            <span className={label}>Link in emails</span>
            <input value={form.appUrl} onChange={e => set({ appUrl: e.target.value.trim() })} className={input} autoCapitalize="none" />
          </label>
        </div>

        <button onClick={save} disabled={!changed || state === 'busy'}
          className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">
          {state === 'busy' ? 'Saving…' : state === 'saved' && !changed ? 'Saved ✓' : 'Save'}
        </button>
        {state === 'error' && <p className="text-red-400 text-sm">Couldn't save. Try again.</p>}

        <button onClick={test} disabled={!saved.enabled || changed}
          className="w-full py-3 rounded-2xl bg-pt-surface shadow-hairline text-pt-text font-medium disabled:opacity-40">
          Send me a test email
        </button>
        {testState && <p className="text-pt-muted text-sm">{testState}</p>}

        <div className="space-y-2">
          <p className={label}>Recent emails</p>
          {outbox.length === 0 && <p className="text-pt-muted text-sm">None yet.</p>}
          {outbox.map(m => (
            <div key={m.id} className="bg-pt-surface shadow-hairline rounded-xl px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-pt-text text-sm min-w-0 truncate">{m.subject}</p>
                <span className={`text-xs shrink-0 ${STATUS_STYLE[m.status ?? ''] ?? 'text-amber-300'}`}>{m.status ?? 'queued'}</span>
              </div>
              <p className="text-pt-muted text-xs truncate">
                {formatDay(m.createdAt.slice(0, 10))} · to {m.sentTo?.join(', ') ?? (m.to === 'arts-team' ? 'arts department' : m.to)}
                {m.error ? ` · ${m.error}` : m.note ? ` · ${m.note}` : ''}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
