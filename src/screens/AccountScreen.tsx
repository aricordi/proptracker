import { useEffect, useRef, useState } from 'react'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useSession } from '../auth'
import Avatar from '../components/Avatar'
import { useProfiles, saveProfile, uploadProfilePhoto } from '../services/profiles'
import { useNavigate } from 'react-router-dom'
import { useMyStatus } from '../services/schedule'
import { todayInStudio } from '../../functions/src/booking'
import { formatDay } from '../lib/dates'

export const ROLE_LABELS: Record<string, string> = {
  owner:   'Owner',
  arts:    'Arts department',
  creator: 'Creator',
  equipment: 'Equipment team',
}

export default function AccountScreen() {
  const { user, profile, realRole, role, setViewAs } = useSession()
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <h1 className="font-display text-3xl text-pt-text py-2">{role === 'creator' ? 'Me' : 'Account'}</h1>
      </div>
      <div className="p-4 space-y-4">
        <ProfileCard name={profile.name || user.displayName || profile.email} email={profile.email} roleLabel={ROLE_LABELS[realRole]} />
        {role === 'creator' && <CreatorLinks email={profile.email} />}
        {realRole === 'owner' && (
          <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
            <p className="text-pt-text font-medium">View the app as…</p>
            <p className="text-pt-muted text-sm">
              See exactly which screens and buttons each role gets. This only changes what you see.
              The server still knows you're the owner, so to test what a role is truly blocked from,
              use a second Google account invited with that role.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['owner', 'arts', 'equipment', 'creator'] as const).map(r => (
                <button key={r} onClick={() => setViewAs(r === 'owner' ? null : r)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium ${role === r ? 'bg-sky-500 text-stone-900' : 'bg-pt-bg border border-pt-border text-pt-muted'}`}>
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={() => signOut(auth)}
          className="w-full py-3 rounded-xl bg-pt-surface border border-pt-border text-pt-text text-sm font-medium active:opacity-70"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

// Your face and channel name, shown on the schedule and to the teams.
function ProfileCard({ name, email, roleLabel }: { name: string; email: string; roleLabel: string }) {
  const mine = useProfiles()[email]
  const [channel, setChannel] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => { setChannel(mine?.channel ?? '') }, [mine?.channel])
  async function run(label: string, f: () => Promise<unknown>, done: string) {
    setBusy(label); setMsg('')
    try { await f(); setMsg(done) } catch (e) { setMsg((e as Error).message || 'That did not work. Try again.') } finally { setBusy('') }
  }
  const dirty = channel.trim() !== (mine?.channel ?? '')
  return (
    <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-4">
        <button onClick={() => file.current?.click()} className="relative" aria-label="Change your photo">
          <Avatar email={email} name={name} size={72} />
          <span className="absolute -bottom-1 -right-1 bg-pt-accent text-stone-900 rounded-full w-7 h-7 grid place-items-center text-sm">✎</span>
        </button>
        <div className="min-w-0">
          <p className="text-pt-text font-semibold truncate">{name}</p>
          {mine?.channel && <p className="text-pt-muted text-sm truncate">{mine.channel}</p>}
          <p className="text-pt-muted text-xs break-all">{email}</p>
          <p className="text-pt-accent text-sm pt-0.5">{roleLabel}</p>
        </div>
      </div>
      <input ref={file} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run('photo', () => uploadProfilePhoto(email, f), 'Photo updated ✓') }} />
      <div className="flex gap-2">
        <button disabled={!!busy} onClick={() => file.current?.click()} className="flex-1 bg-pt-bg border border-pt-border rounded-xl py-2 text-sm text-pt-text disabled:opacity-40">{busy === 'photo' ? 'Uploading…' : 'Change photo'}</button>
        {mine?.photoURL && <button disabled={!!busy} onClick={() => run('reset', () => saveProfile(email, { photoURL: '' }), 'Back to your Google photo')} className="flex-1 bg-pt-bg border border-pt-border rounded-xl py-2 text-sm text-pt-muted disabled:opacity-40">Use Google photo</button>}
      </div>
      <label className="block"><span className="block text-pt-muted text-xs mb-1">Channel name</span>
        <div className="flex gap-2">
          <input value={channel} onChange={e => setChannel(e.target.value.slice(0, 60))} placeholder="e.g. @yourchannel"
            className="flex-1 min-w-0 bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent" />
          {dirty && <button disabled={!!busy} onClick={() => run('channel', () => saveProfile(email, { channel: channel.trim() }), 'Saved ✓')} className="shrink-0 bg-pt-accent text-stone-900 font-semibold rounded-xl px-4 disabled:opacity-40">Save</button>}
        </div></label>
      {msg && <p className="text-sm text-pt-muted">{msg}</p>}
    </div>
  )
}

// Creators: your requests, your standing (strikes), and the rules.
function CreatorLinks({ email }: { email: string }) {
  const navigate = useNavigate()
  const st = useMyStatus(email)
  const paused = !!st?.pausedUntil && st.pausedUntil > todayInStudio()
  const rows: [string, string, string][] = [
    ['My prop requests', 'Every props request and where it is', '/reservations'],
    ['My gear', 'Gear held, picked up and returned', '/gear/bookings'],
    ['Help', 'How do I…? Booking, props, gear, check-in, sign-in', '/help'],
    ['How it works', 'Slots, monthly picks, cutoffs, check-ins, strikes', '/schedule/how'],
  ]
  return (
    <>
      <div className={`rounded-2xl p-4 text-sm ${paused ? 'bg-red-500/10 border border-red-500/40' : 'bg-pt-surface border border-pt-border'}`}>
        <p className="text-pt-text font-semibold">{paused ? `Props and gear paused until ${formatDay(st!.pausedUntil!)}` : st?.strikes ? `${st.strikes} strike${st.strikes === 1 ? '' : 's'}` : 'No strikes'}</p>
        <p className="text-pt-muted">{paused ? 'You can still book house time.' : 'Strikes come from no-shows, late cancels and upheld reports.'}</p>
      </div>
      <div className="bg-pt-surface border border-pt-border rounded-2xl divide-y divide-pt-border">
        {rows.map(([t, d, to]) => (
          <button key={to} onClick={() => navigate(to)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
            <span className="flex-1 min-w-0"><span className="block text-pt-text">{t}</span><span className="block text-pt-muted text-xs">{d}</span></span>
            <span className="text-pt-muted">›</span>
          </button>
        ))}
      </div>
    </>
  )
}
