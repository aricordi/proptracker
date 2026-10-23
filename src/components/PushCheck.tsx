// Owner/admin (Oct 23: "Ariel isn't seeing notifications… can I send him one from my screen?"): on a person's page,
// shows which phones they have signed up for notifications and when each last opened the app, and sends them a test.
import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { Icon } from './Icon'

interface Device { platform: string; lastSeen: string }
interface Result { sent: number; phones: number; errors: string[]; devices: Device[] }
const testPushTo = httpsCallable<{ email: string; send?: boolean }, Result>(functions, 'testPushTo')

const PLATFORM: Record<string, string> = {
  'ios-app': 'iPhone (Home Screen app)', ios: 'iPhone (Safari)', 'android-app': 'Android (app)', android: 'Android (browser)',
  'desktop-app': 'Computer (app)', desktop: 'Computer (browser)',
}
const when = (iso: string) => {
  if (!iso) return 'never'
  const d = new Date(iso), days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  const t = d.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' })
  return days >= 1 ? `${t} (${days} day${days === 1 ? '' : 's'} ago)` : t
}

export function PushCheck({ email, name }: { email: string; name: string }) {
  const [info, setInfo] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const first = name.split(' ')[0]

  useEffect(() => { testPushTo({ email }).then(r => setInfo(r.data)).catch(() => setInfo(null)) }, [email])

  async function send() {
    setBusy(true); setMsg(null)
    try {
      const r = (await testPushTo({ email, send: true })).data
      setInfo(r)
      if (!r.phones) setMsg({ ok: false, text: `${first} has no phone signed up. Ask them to open the app from the Home Screen icon, go to Me → Notifications and tap Turn on.` })
      else if (r.sent) setMsg({ ok: true, text: `Google accepted it for ${r.sent} of ${r.phones} phone${r.phones === 1 ? '' : 's'}. If ${first} sees nothing within a minute, their phone is dropping it: ask them to turn notifications off and on again in Me → Notifications.` })
      else setMsg({ ok: false, text: `Their phone refused it${r.errors[0] ? ` (${r.errors[0]})` : ''}. The sign-up has gone stale: ask ${first} to turn notifications off and on again in Me → Notifications.` })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not send it.' })
    } finally { setBusy(false) }
  }

  return (
    <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-pt-text font-medium"><Icon name="bell" />Notifications</div>
      {info === null ? <p className="text-pt-muted text-sm">Checking…</p>
        : info.devices.length === 0 ? <p className="text-pt-muted text-sm">No phone signed up yet.</p>
        : (
          <ul className="space-y-1">
            {info.devices.map((d, i) => (
              <li key={i} className="text-sm"><span className="text-pt-text">{PLATFORM[d.platform] ?? (d.platform || 'Unknown phone')}</span>
                <span className="text-pt-muted"> · last opened {when(d.lastSeen)}</span></li>
            ))}
          </ul>
        )}
      <button onClick={send} disabled={busy} className="w-full min-h-[44px] rounded-xl bg-pt-raised shadow-hairline text-pt-accent font-medium disabled:opacity-50">
        {busy ? 'Sending…' : `Send ${first} a test notification`}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-300' : 'text-amber-300'}`}>{msg.text}</p>}
      <p className="text-pt-muted text-xs">"Last opened" updates each time they open the app with notifications on. If it's days old, they may be using Safari instead of the Home Screen icon.</p>
    </section>
  )
}
