import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { OWNER_EMAIL } from '../config'
import { subscribeToUsers, inviteUser, updateUser, normalizeEmail } from '../services/users'
import BottomSheet from '../components/BottomSheet'
import { ROLE_LABELS } from './AccountScreen'
import type { AppUser, Role } from '../types'

const ROLE_ORDER: Role[] = ['owner', 'arts', 'creator']

export default function UsersScreen() {
  const navigate = useNavigate()
  const { isOwner, profile: me } = useSession()
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
          {!isOwner && ' You can invite and turn off creators; ask the owner to change arts department access.'}
        </p>

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

      <InviteSheet open={showInvite} onClose={() => setShowInvite(false)} isOwner={isOwner} />
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
  const options: Role[] = isOwner ? ['creator', 'arts', 'owner'] : ['creator']
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map(r => (
        <button key={r} type="button" onClick={() => onChange(r)}
          className={`px-4 py-2 rounded-full text-sm font-medium ${value === r ? 'bg-pt-accent text-stone-900' : 'bg-pt-bg border border-pt-border text-pt-muted'}`}>
          {ROLE_LABELS[r]}
        </button>
      ))}
    </div>
  )
}

const inputClass = 'w-full bg-pt-bg border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent'

function InviteSheet({ open, onClose, isOwner }: { open: boolean; onClose: () => void; isOwner: boolean }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('creator')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  function close() {
    setEmail(''); setName(''); setRole('creator'); setMessage(null); onClose()
  }

  async function submit() {
    setBusy(true); setMessage(null)
    try {
      const result = await inviteUser(email, role, name)
      if (result === 'already-exists') setMessage('That email is already on the list. Tap their name to change access.')
      else close()
    } catch {
      setMessage("Couldn't save the invite. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
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
        <p className="text-pt-muted text-xs">
          No email is sent yet. Tell them to open the app and sign in with Google using this address.
        </p>
        {message && <p className="text-amber-400 text-sm">{message}</p>}
        <button onClick={submit} disabled={!valid || busy}
          className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 active:opacity-80">
          {busy ? 'Saving…' : 'Add to list'}
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
