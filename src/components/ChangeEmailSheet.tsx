// Owner only (Oct 27): move a person to a new email. Step 1 type it, step 2 see exactly what moves (and whether it
// joins an account that already exists at that email), step 3 move it. The server does the work (changeUserEmail).
import { useState } from 'react'
import BottomSheet from './BottomSheet'
import { changeUserEmail, normalizeEmail, type EmailMovePreview } from '../services/users'
import { friendlyError } from '../lib/errors'
import type { AppUser } from '../types'

export default function ChangeEmailSheet({ user, onClose, onDone }: { user: AppUser; onClose: () => void; onDone: () => void }) {
  const [to, setTo] = useState('')
  const [preview, setPreview] = useState<EmailMovePreview | null>(null)
  const [done, setDone] = useState<EmailMovePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const who = user.name || user.email

  async function run(apply: boolean) {
    setBusy(true); setError(null)
    try {
      const r = await changeUserEmail(user.email, to, apply)
      if (apply) setDone(r); else setPreview(r)
    } catch (e) { setError(friendlyError(e, "Couldn't do that. Check your connection and try again.")) }
    finally { setBusy(false) }
  }

  if (done) return (
    <BottomSheet open onClose={onDone} title="Email changed ✓">
      <div className="space-y-4">
        <p className="text-pt-text">{who} is now <span className="font-semibold break-all">{done.to}</span>.
          {done.merging ? ' Their two accounts are now one.' : ''}</p>
        <p className="text-pt-muted text-sm">The old email is deleted from People and can't sign in any more. Ask them to sign in with the new one, then turn
          notifications on again (Me → Notifications){done.phones ? '' : ' if they want them'}.</p>
        <button onClick={onDone} className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Done</button>
      </div>
    </BottomSheet>
  )

  return (
    <BottomSheet open onClose={onClose} title={`Change ${who}'s email`}>
      <div className="space-y-4">
        <p className="text-pt-muted text-sm break-all">Now: {user.email}</p>
        <div>
          <label className="text-pt-muted text-xs" htmlFor="newEmail">New email</label>
          <input id="newEmail" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={to}
            onChange={e => { setTo(e.target.value); setPreview(null); setError(null) }} placeholder="name@example.com"
            className="mt-1 w-full bg-pt-bg shadow-hairline rounded-xl px-3 py-3 text-pt-text" />
        </div>

        {!preview && (
          <button onClick={() => run(false)} disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) || normalizeEmail(to) === user.email}
            className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">
            {busy ? 'Checking…' : 'Check what will move'}
          </button>
        )}

        {preview && (
          <div className="space-y-3">
            {preview.merging && (
              <p className="bg-amber-500/15 text-amber-200 text-sm rounded-xl px-3 py-2">
                {preview.newName || preview.to} already has an account. The two will be joined into one person under the new email.
              </p>
            )}
            <div className="bg-pt-bg shadow-hairline rounded-xl px-3 py-3 text-sm space-y-1">
              <p className="text-pt-text font-medium">Moves to {preview.to}:</p>
              <p className="text-pt-muted">Their role{user.role === 'creator' ? ', app access' : ''} and name{preview.profile ? ', photo and channel name' : ''}</p>
              {preview.summary.length
                ? preview.summary.map(s => <p key={s.what} className="text-pt-muted">{s.count} {s.what}</p>)
                : <p className="text-pt-muted">No shoots or requests yet</p>}
            </div>
            <p className="text-pt-muted text-xs">The old email is then deleted from People. {preview.phones ? `Their ${preview.phones === 1 ? 'phone' : `${preview.phones} phones`} will need to turn notifications on again.` : ''}</p>
            <button onClick={() => run(true)} disabled={busy}
              className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">
              {busy ? 'Moving… (this can take a minute)' : `Move everything to ${preview.to}`}
            </button>
          </div>
        )}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button onClick={onClose} disabled={busy} className="w-full py-3 text-pt-muted">Cancel</button>
      </div>
    </BottomSheet>
  )
}
