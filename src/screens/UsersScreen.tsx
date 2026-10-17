import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { OWNER_EMAIL, LIVE_APP_URL } from '../config'
import { USING_EMULATORS } from '../firebase'
import { subscribeToUsers, inviteUser, updateUser, normalizeEmail } from '../services/users'
import BottomSheet from '../components/BottomSheet'
import { ROLE_LABELS } from './AccountScreen'
import type { AppUser, Role } from '../types'

const ROLE_ORDER: Role[] = ['owner', 'arts', 'equipment', 'creator']

// One line per role, shown under the picker so it's clear what each person will be able to do.
const ROLE_HELP: Record<Role, string> = {
  creator: 'Books props and gear for their shoots. Sees only their own bookings.',
  arts: 'Runs the props: adds and edits props, the props queue, check-ins. Can invite creators.',
  equipment: 'Runs the gear: gear list, bundles, the gear queue. Sees no props.',
  owner: 'Full control of everything, including people, settings and costs. Only give this to a partner.',
}

export default function UsersScreen() {
  const navigate = useNavigate()
  const { isOwner, profile: me, realRole, viewingAs, setViewAs } = useSession()
  const [users, setUsers] = useState<AppUser[]>([])
  useEffect(() => subscribeToUsers(setUsers), [])

  const [showInvite, setShowInvite] = useState(false)
  const [editing, setEditing] = useState<AppUser | null>(null)

  // Owner can manage anyone; arts department can only manage creators.
  const canManage = (u: AppUser) =>
    normalizeEmail(u.email) !== OWNER_EMAIL && (isOwner || u.role === 'creator')

  const grouped = useMemo(() => {
    const list = users.filter(u => normalizeEmail(u.email) !== OWNER_EMAIL)
    return ROLE_ORDER.map(role => ({
      role,
      people: list.filter(u => u.role === role)
        .sort((a, b) => Number(b.active) - Number(a.active) || a.email.localeCompare(b.email)),
    }))
  }, [users])

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between border-b border-pt-border">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-pt-text text-base font-medium active:text-pt-muted py-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 19-7-7 7-7" />
          </svg>
          Back
        </button>
        <h1 className="font-display text-xl text-pt-text">People</h1>
        <button onClick={() => setShowInvite(true)} className="text-pt-accent text-sm font-medium active:opacity-70 py-1">
          Invite
        </button>
      </div>

      <div className="p-4 space-y-5">
        <p className="text-pt-muted text-sm">
          Only people listed here can sign in. They sign in with Google using the exact email you invite.
          {!isOwner && !viewingAs && ' You can invite and turn off creators; ask the owner to invite arts department or equipment team people.'}
        </p>
        {realRole === 'owner' && viewingAs && (
          <div className="bg-sky-500/15 rounded-2xl px-4 py-3 text-sky-200 text-sm space-y-2">
            <p>You're previewing the app as {ROLE_LABELS[viewingAs]}, so you only see what they can do here (invite creators).</p>
            <button onClick={() => setViewAs(null)} className="font-semibold text-sky-100 underline">Exit preview to invite any role</button>
          </div>
        )}

        <Section title="Owner">
          <Row email={OWNER_EMAIL} name={OWNER_EMAIL === me.email ? 'You' : undefined} subtitle="Full admin" />
          {grouped[0].people.map(u => (
            <Row key={u.email} email={u.email} name={u.name} inactive={!u.active}
              onTap={canManage(u) ? () => setEditing(u) : undefined} />
          ))}
        </Section>

        {grouped.slice(1).map(({ role, people }) => (
          <Section key={role} title={ROLE_LABELS[role]} empty={people.length === 0 ? 'Nobody yet' : undefined}>
            {people.map(u => (
              <Row key={u.email} email={u.email} name={u.name} inactive={!u.active}
                onTap={canManage(u) ? () => setEditing(u) : undefined} />
            ))}
          </Section>
        ))}
      </div>

      <InviteSheet open={showInvite} onClose={() => setShowInvite(false)} isOwner={isOwner}
        onOpenExisting={e => { const u = users.find(x => normalizeEmail(x.email) === e); if (u && canManage(u)) setEditing(u) }} />
      <EditSheet user={editing} onClose={() => setEditing(null)} isOwner={isOwner} />
    </div>
  )
}

function Section({ title, empty, children }: { title: string; empty?: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">{title}</p>
      <div className="bg-pt-surface border border-pt-border rounded-2xl divide-y divide-pt-border overflow-hidden">
        {empty ? <p className="px-4 py-3 text-pt-muted text-sm">{empty}</p> : children}
      </div>
    </div>
  )
}

function Row({ email, name, subtitle, inactive, onTap }: {
  email: string; name?: string; subtitle?: string; inactive?: boolean; onTap?: () => void
}) {
  const body = (
    <>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${inactive ? 'text-pt-muted line-through' : 'text-pt-text'}`}>{name || email}</p>
        {name && <p className="text-pt-muted text-xs truncate">{email}</p>}
        {subtitle && <p className="text-pt-muted text-xs">{subtitle}</p>}
      </div>
      {inactive && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full shrink-0">Access off</span>}
      {onTap && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-pt-muted shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
        </svg>
      )}
    </>
  )
  return onTap
    ? <button onClick={onTap} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-pt-bg">{body}</button>
    : <div className="flex items-center gap-3 px-4 py-3">{body}</div>
}

function RolePicker({ value, onChange, isOwner }: { value: Role; onChange: (r: Role) => void; isOwner: boolean }) {
  const options: Role[] = isOwner ? ['creator', 'arts', 'equipment', 'owner'] : ['creator']
  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Access">
        {options.map(r => (
          <button key={r} type="button" role="radio" aria-checked={value === r} onClick={() => onChange(r)}
            className={`px-4 py-2 rounded-full text-sm font-medium ${value === r ? 'bg-pt-accent text-stone-900' : 'bg-pt-bg border border-pt-border text-pt-muted'}`}>
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>
      <p className={`text-sm ${value === 'owner' ? 'text-amber-300' : 'text-pt-muted'}`}>{value === 'owner' ? '⚠ ' : ''}{ROLE_HELP[value]}</p>
    </div>
  )
}

// The text the inviter sends: where to go and which Google account to use.
function inviteText(email: string, role: Role, name: string) {
  const hi = name.trim() ? `Hi ${name.trim().split(' ')[0]}! ` : ''
  return `${hi}You're invited to Prime Capitol as ${ROLE_LABELS[role]}.\n`
    + `1. Open ${USING_EMULATORS ? window.location.origin : LIVE_APP_URL}\n`
    + `2. Tap "Sign in with Google" and use ${email}\n`
    + `Tip: on iPhone, tap Share → "Add to Home Screen" to keep it like an app.`
}

const inputClass = 'w-full bg-pt-bg border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent'

function InviteSheet({ open, onClose, isOwner, onOpenExisting }: {
  open: boolean; onClose: () => void; isOwner: boolean; onOpenExisting: (email: string) => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('creator')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [exists, setExists] = useState(false)
  const [done, setDone] = useState<{ email: string; role: Role; name: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const clean = normalizeEmail(email)
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)

  function reset() {
    setEmail(''); setName(''); setRole('creator'); setMessage(null); setExists(false); setDone(null); setCopied(false)
  }
  function close() { reset(); onClose() }

  async function submit() {
    setBusy(true); setMessage(null); setExists(false)
    try {
      const result = await inviteUser(clean, role, name)
      if (result === 'already-exists') { setExists(true); setMessage('That email is already on the list.') }
      else setDone({ email: clean, role, name })
    } catch {
      setMessage(isOwner
        ? "Couldn't save the invite. Check your connection and try again."
        : "Couldn't save the invite. You can only invite creators; ask the owner for other roles.")
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    if (!done) return
    const text = inviteText(done.email, done.role, done.name)
    try {
      if (navigator.share) { await navigator.share({ text }); return }
    } catch { /* closed the share sheet, or not allowed: fall back to copying */ }
    try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false) }
  }

  if (done) {
    return (
      <BottomSheet open={open} onClose={close} title="Invited ✓">
        <div className="space-y-4">
          <p className="text-pt-text text-[15px]">
            <b>{done.name.trim() || done.email}</b> can now sign in as <b>{ROLE_LABELS[done.role]}</b>.
          </p>
          <p className="text-pt-muted text-sm">
            The app doesn't send emails yet, so send them this message (text, WhatsApp, email…):
          </p>
          <pre className="whitespace-pre-wrap bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text text-[13px] font-sans">{inviteText(done.email, done.role, done.name)}</pre>
          <button onClick={send} className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold active:opacity-80">
            {copied ? 'Copied ✓ Paste it in a message' : 'Send the invite message'}
          </button>
          <p className="text-pt-muted text-xs">
            They must sign in with a Google account that uses exactly {done.email}. A work email works too
            if it's set up as a Google account.
          </p>
          <div className="flex gap-2">
            <button onClick={reset} className="flex-1 py-3 rounded-xl bg-pt-bg border border-pt-border text-pt-text font-medium active:opacity-70">Invite another</button>
            <button onClick={close} className="flex-1 py-3 rounded-xl bg-pt-bg border border-pt-border text-pt-text font-medium active:opacity-70">Done</button>
          </div>
        </div>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet open={open} onClose={close} title="Invite someone">
      <div className="space-y-4">
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address *"
          type="email" inputMode="email" autoCapitalize="none" className={inputClass} />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" className={inputClass} />
        <div>
          <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Access</p>
          <RolePicker value={role} onChange={setRole} isOwner={isOwner} />
        </div>
        {message && <p className="text-amber-400 text-sm">{message}</p>}
        {exists && (
          <button onClick={() => { const e = clean; close(); onOpenExisting(e) }} className="text-pt-accent text-sm font-medium">
            Open their access settings ›
          </button>
        )}
        <button onClick={submit} disabled={!valid || busy}
          className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 active:opacity-80">
          {busy ? 'Saving…' : `Invite as ${ROLE_LABELS[role]}`}
        </button>
      </div>
    </BottomSheet>
  )
}

function EditSheet({ user, onClose, isOwner }: { user: AppUser | null; onClose: () => void; isOwner: boolean }) {
  const [role, setRole] = useState<Role>('creator')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => { if (user) { setRole(user.role); setError(null) } }, [user])

  if (!user) return null

  async function save(data: Partial<Pick<AppUser, 'role' | 'active'>>) {
    setBusy(true); setError(null)
    try { await updateUser(user!.email, data); onClose() }
    catch { setError("Couldn't save. Check your connection and try again.") }
    finally { setBusy(false) }
  }

  return (
    <BottomSheet open onClose={onClose} title={user.name || user.email}>
      <div className="space-y-4">
        {user.name && <p className="text-pt-muted text-sm break-all">{user.email}</p>}
        <button onClick={() => navigate(`/people/${encodeURIComponent(user.email)}`)}
          className="w-full py-3 rounded-xl bg-pt-bg border border-pt-border text-pt-text font-medium active:opacity-70">
          Bookings & history ›
        </button>
        {isOwner && (
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Access</p>
            <RolePicker value={role} onChange={setRole} isOwner={isOwner} />
            {role !== user.role && (
              <button onClick={() => save({ role })} disabled={busy}
                className="mt-3 w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 active:opacity-80">
                Change to {ROLE_LABELS[role]}
              </button>
            )}
          </div>
        )}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {user.active ? (
          <button onClick={() => save({ active: false })} disabled={busy}
            className="w-full py-3 rounded-xl bg-red-500/20 text-red-400 font-medium disabled:opacity-40 active:opacity-70">
            Turn off access
          </button>
        ) : (
          <button onClick={() => save({ active: true })} disabled={busy}
            className="w-full py-3 rounded-xl bg-green-500/20 text-green-400 font-medium disabled:opacity-40 active:opacity-70">
            Turn access back on
          </button>
        )}
        <p className="text-pt-muted text-xs">Turning access off signs them out right away. Their history is kept.</p>
      </div>
    </BottomSheet>
  )
}
