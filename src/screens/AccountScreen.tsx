import { ReportProblemRow } from '../components/BugReport'
import AiButton from '../components/AiButton'
import { MONTHS, daysIn, isBirthday, makeBirthday } from '../lib/birthdays'
import { useEffect, useRef, useState } from 'react'
import { NotificationsCard } from '../components/Notifications'
import { LaptopLayoutCard } from '../desk/LaptopLayoutCard'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { pushSignOut } from '../services/push'
import { useSession } from '../auth'
import Avatar from '../components/Avatar'
import { useProfiles, saveProfile, uploadProfilePhoto } from '../services/profiles'
import { useNavigate } from 'react-router-dom'
import { useMyStatus } from '../services/schedule'
import { todayInStudio } from '../../functions/src/booking'
import { formatDay } from '../lib/dates'
import { friendlyError } from '../lib/errors'

export const ROLE_LABELS: Record<string, string> = {
  owner:   'Owner',
  arts:    'Arts department',
  creator: 'Creator',
  equipment: 'Equipment team',
  admin:   'Admin',
}

export default function AccountScreen() {
  const { user, profile, realRole, role, setViewAs, shootFlow, isGearStaff, demo, previewingDemo, creatorMode, setCreatorMode } = useSession()
  const navigate = useNavigate()
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <h1 className="font-display text-[34px] text-pt-text py-2 flex items-center gap-3"><span className="flex-1">{shootFlow || demo ? 'Me' : 'Account'}</span>{shootFlow && <AiButton />}</h1>
      </div>
      <div className="px-4 pt-4 pb-8 space-y-6">
        <ProfileCard name={profile.name || user.displayName || profile.email} email={profile.email} roleLabel={ROLE_LABELS[realRole]} />
        {realRole === 'owner' && (
          // Owner, Nov 4: an everyday switch (not a preview). Creator mode = the whole app is the creator app until switched off here.
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3" data-testid="app-mode">
            <div>
              <p className="text-pt-text font-medium">Use the app as</p>
              <p className="text-pt-muted text-sm">{creatorMode
                ? 'Creator mode is on: you get the same app as every creator. Switch back here any time.'
                : 'Switch to the creator app for your own shoots. It stays that way on this device until you switch back here.'}</p>
            </div>
            <div className="flex bg-pt-bg rounded-full p-1 gap-1" role="radiogroup" aria-label="Use the app as">
              {([['owner', 'Owner'], ['creator', 'Creator']] as const).map(([k, l]) => {
                const on = (k === 'creator') === creatorMode
                return (
                  <button key={k} role="radio" aria-checked={on} onClick={() => { if (!on) { setCreatorMode(k === 'creator'); navigate('/') } }}
                    className={`flex-1 min-h-[44px] rounded-full text-[15px] font-semibold ${on ? 'bg-pt-accent text-stone-900' : 'text-pt-muted'}`}>{l}</button>
                )
              })}
            </div>
          </div>
        )}
        {demo && (
          // Test launch (owner, Oct 27): what this mode is, and that booking comes later.
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-1">
            <p className="text-pt-text font-medium">Sneak peek</p>
            <p className="text-pt-muted text-sm">For now you can search and look through everything in the Prime Capitol prop room. Booking shoots and props opens up soon; we'll let you know.</p>
            <p className="text-pt-muted text-sm">Something wrong with a prop? Open it and tap <b className="text-pt-text">Suggest an edit</b>.</p>
          </div>
        )}
        <NotificationsCard />
        <LaptopLayoutCard />
        <ReportProblemRow />
        {shootFlow && <CreatorLinks email={profile.email} />}
        {demo && (
          <button onClick={() => navigate('/help')} className="w-full flex items-center gap-3 px-4 py-3 text-left bg-pt-surface shadow-hairline rounded-2xl">
            <span className="flex-1 min-w-0"><span className="block text-pt-text">Help</span><span className="block text-pt-muted text-xs">Sign-in trouble, notifications, how things work</span></span><span className="text-pt-muted">›</span>
          </button>
        )}
        {!shootFlow && isGearStaff && (
          <div className="bg-pt-surface shadow-hairline rounded-2xl divide-y divide-white/[0.06]">
            {([['Gear team tour', 'Practise the gear room: kits, the queue, check-ins, the schedule', '/tour/gear'], ['Help', 'How do I…? Booking, gear, check-in, sign-in', '/help']] as const).map(([t, d, to]) => (
              <button key={to} onClick={() => navigate(to)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <span className="flex-1 min-w-0"><span className="block text-pt-text">{t}</span><span className="block text-pt-muted text-xs">{d}</span></span><span className="text-pt-muted">›</span>
              </button>
            ))}
          </div>
        )}
        {realRole === 'owner' && !creatorMode && (
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
            <p className="text-pt-text font-medium">View the app as…</p>
            <p className="text-pt-muted text-sm">
              See exactly which screens and buttons each role gets. This only changes what you see.
              The server still knows you're the owner, so to test what a role is truly blocked from,
              use a second Google account invited with that role.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['owner', 'admin', 'arts', 'equipment', 'creator'] as const).map(r => (
                <button key={r} onClick={() => setViewAs(r === 'owner' ? null : r)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium ${role === r && !previewingDemo ? 'bg-sky-500 text-stone-900' : 'bg-pt-bg shadow-hairline text-pt-muted'}`}>
                  {ROLE_LABELS[r]}{r === 'creator' ? ' (full app)' : ''}
                </button>
              ))}
              <button onClick={() => setViewAs('demo')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium ${previewingDemo ? 'bg-sky-500 text-stone-900' : 'bg-pt-bg shadow-hairline text-pt-muted'}`}>
                Creator (props only)
              </button>
            </div>
          </div>
        )}
        <button
          onClick={async () => { await pushSignOut(); await signOut(auth) }}
          className="w-full py-3 rounded-xl bg-pt-surface shadow-hairline text-pt-text text-sm font-medium active:opacity-70"
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
    try { await f(); setMsg(done) } catch (e) { setMsg(friendlyError(e, 'That did not work. Try again.')) } finally { setBusy('') }
  }
  const dirty = channel.trim() !== (mine?.channel ?? '')
  return (
    <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-4">
        <button onClick={() => file.current?.click()} className="relative" aria-label="Change your photo">
          <Avatar email={email} name={name} size={72} />
          <span className="absolute -bottom-1 -right-1 bg-pt-accent text-stone-900 rounded-full w-7 h-7 grid place-items-center text-sm">✎</span>
        </button>
        <div className="min-w-0">
          <p className="text-pt-text font-semibold truncate">{name}</p>
          {mine?.channel && <p className="text-pt-muted text-sm truncate">{mine.channel}</p>}
          <p className="text-pt-muted text-xs break-all">{email}</p>
          <p className="text-pt-accent text-sm pt-0.5 tap">{roleLabel}</p>
        </div>
      </div>
      <input ref={file} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run('photo', () => uploadProfilePhoto(email, f), 'Photo updated ✓') }} />
      <div className="flex gap-2">
        <button disabled={!!busy} onClick={() => file.current?.click()} className="flex-1 bg-pt-bg shadow-hairline rounded-xl min-h-[44px] text-sm text-pt-text disabled:opacity-40">{busy === 'photo' ? 'Uploading…' : 'Change photo'}</button>
        {mine?.photoURL && <button disabled={!!busy} onClick={() => run('reset', () => saveProfile(email, { photoURL: '' }), 'Back to your Google photo')} className="flex-1 bg-pt-bg shadow-hairline rounded-xl py-2 text-sm text-pt-muted disabled:opacity-40">Use Google photo</button>}
      </div>
      <label className="block"><span className="block text-pt-muted text-xs mb-1">Channel name</span>
        <div className="flex gap-2">
          <input value={channel} onChange={e => setChannel(e.target.value.slice(0, 60))} placeholder="e.g. @yourchannel"
            className="flex-1 min-w-0 bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent" />
          {dirty && <button disabled={!!busy} onClick={() => run('channel', () => saveProfile(email, { channel: channel.trim() }), 'Saved ✓')} className="shrink-0 bg-pt-accent text-stone-900 font-semibold rounded-xl px-4 disabled:opacity-40">Save</button>}
        </div></label>
      <BirthdayField email={email} name={name} saved={mine?.birthday ?? ''} busy={!!busy} run={run} />
      {msg && <p className="text-sm text-pt-muted">{msg}</p>}
    </div>
  )
}

// Your birthday (month + day, no year): the app throws you a little party on the day and tells the team.
function BirthdayField({ email, name, saved, busy, run }: { email: string; name: string; saved: string; busy: boolean; run: (label: string, f: () => Promise<unknown>, done: string) => void }) {
  const [m, setM] = useState(0), [d, setD] = useState(0)
  useEffect(() => { setM(isBirthday(saved) ? Number(saved.slice(0, 2)) : 0); setD(isBirthday(saved) ? Number(saved.slice(3)) : 0) }, [saved])
  const next = m && d ? makeBirthday(m, Math.min(d, daysIn(m))) : ''
  const sel = 'flex-1 min-w-0 bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent'
  return (
    <div><span className="block text-pt-muted text-xs mb-1">Birthday <span className="text-pt-muted">(just the day, no year)</span></span>
      <div className="flex gap-2">
        <select value={m} onChange={e => setM(Number(e.target.value))} className={sel} aria-label="Birthday month">
          <option value={0}>Month</option>{MONTHS.map((x, i) => <option key={x} value={i + 1}>{x}</option>)}
        </select>
        <select value={d} onChange={e => setD(Number(e.target.value))} className={`${sel} max-w-[96px]`} aria-label="Birthday day">
          <option value={0}>Day</option>{Array.from({ length: m ? daysIn(m) : 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
        </select>
        {next && next !== saved && <button disabled={busy} onClick={() => run('bday', () => saveProfile(email, { birthday: next, name }), 'Saved ✓ We\'ll celebrate on the day.')} className="shrink-0 bg-pt-accent text-stone-900 font-semibold rounded-xl px-4 disabled:opacity-40">Save</button>}
      </div>
      {saved && <button disabled={busy} onClick={() => run('bday', () => saveProfile(email, { birthday: '' }), 'Birthday removed.')} className="tap text-pt-muted text-xs mt-1">Remove my birthday</button>}
    </div>
  )
}

// Creators: your requests, your standing (strikes), and the rules.
function CreatorLinks({ email }: { email: string }) {
  const navigate = useNavigate()
  const st = useMyStatus(email)
  const paused = !!st?.pausedUntil && st.pausedUntil > todayInStudio()
  const rows: [string, string, string][] = [
    ['My shoots', 'When you\'re filming, soonest first, and what each shoot still needs', '/shoots'],
    ['My requests', 'Every props request, grouped by shoot, with where each one is', '/requests'],
    ['Help', 'How do I…? Booking, props, gear, check-in, sign-in', '/help'],
    ['How it works', 'Slots, cutoffs, check-ins, strikes', '/schedule/how'],
  ]
  return (
    <>
      <div className={`rounded-2xl p-4 text-sm ${paused ? 'bg-red-500/10 border border-red-500/40' : 'bg-pt-surface shadow-hairline'}`}>
        <p className="text-pt-text font-semibold">{paused ? `Props paused until ${formatDay(st!.pausedUntil!)}` : st?.strikes ? `${st.strikes} strike${st.strikes === 1 ? '' : 's'}` : 'No strikes'}</p>
        <p className="text-pt-muted">{paused ? 'You can still book house time.' : 'Strikes come from no-shows, late cancels and upheld reports.'}</p>
      </div>
      <div className="bg-pt-surface shadow-hairline rounded-2xl divide-y divide-white/[0.06]">
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
