import { VideosMeRow } from '../components/CastParts'
import { useMyVideos } from '../services/cast'
import { ReportProblemRow } from '../components/BugReport'
import AiButton from '../components/AiButton'
import BrandMark from '../components/BrandMark'
import { Icon, type IconName } from '../components/Icon'
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

import { ROLE_LABELS } from '../lib/roleLabels'
import { APP_VERSION } from '../lib/version'
export { ROLE_LABELS }

export default function AccountScreen() {
  const { user, profile, realRole, role, setViewAs, shootFlow, isGearStaff, demo, previewingDemo, creatorMode, setCreatorMode } = useSession()
  const videos = useMyVideos(shootFlow || demo ? profile.email : undefined)
  const navigate = useNavigate()
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      {/* Same tab header as Chat, Calendar and Props: eagle + 30px title, 44px round buttons, centred. */}
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-2">
        <div className="flex items-center gap-2.5 py-2">
          <BrandMark className="w-8 text-pt-text" title="" />
          <h1 className="font-display text-[30px] leading-tight text-pt-text flex-1">{role === 'creator' && !demo ? 'More' : shootFlow || demo ? 'Me' : 'Account'}</h1>
          {shootFlow && <AiButton />}
        </div>
      </div>
      <div className="px-4 pt-2 pb-8 space-y-6">
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
        {(shootFlow || demo) && (
          <Group>
            <VideosMeRow rows={videos} bare />
            {shootFlow && <>
              <Row icon="calendar" tone="gold" title="My shoots" sub="When you're filming and what each shoot still needs" onClick={() => navigate('/shoots')} />
              <Row icon="box" tone="gold" title="My requests" sub="Every props request, grouped by shoot" onClick={() => navigate('/requests')} />
            </>}
          </Group>
        )}
        {(shootFlow || demo) && <Group><Row icon="sparkle" tone="gold" title="ChatGPT & Claude" sub="Book and find props by chatting with your AI" onClick={() => navigate('/ai')} /></Group>}
        {shootFlow && <StrikesRow email={profile.email} />}
        <Group><NotificationsCard bare /></Group>
        <LaptopLayoutCard />
        <Group title="Help & feedback">
          {(shootFlow || demo) && <Row icon="help" tone="grey" title="Help" sub={demo ? 'Sign-in trouble, notifications, how things work' : 'How do I…? Booking, props, check-in, sign-in'} onClick={() => navigate('/help')} />}
          {shootFlow && <Row icon="note" tone="grey" title="How it works" sub="Slots, cutoffs, check-ins, strikes" onClick={() => navigate('/schedule/how')} />}
          <ReportProblemRow bare />
        </Group>
        {!shootFlow && isGearStaff && (
          <Group title="Team">
            <Row icon="people" tone="gold" title="Equipment team tour" sub="Approve requests, the gear log, blocking time (5 min)" onClick={() => navigate('/tour/gear')} />
            <Row icon="help" tone="grey" title="Help" sub="How do I…? Booking, gear, check-in, sign-in" onClick={() => navigate('/help')} />
          </Group>
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
        <p className="text-center text-pt-muted text-xs pt-1">Prime Capitol · version {APP_VERSION}</p>
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

// More (Nov 23): one iOS-settings style list. Every row = 36px rounded icon tile · 16px semibold title · muted line · chevron.
function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section>
      {title && <h2 className="text-pt-muted text-[14px] font-semibold px-1 mb-2">{title}</h2>}
      <div className="bg-pt-surface shadow-hairline rounded-2xl overflow-hidden divide-y divide-white/[0.06]">{children}</div>
    </section>
  )
}

const TILE = { gold: 'bg-pt-accent/15 text-pt-accent', grey: 'bg-white/[0.08] text-pt-text', green: 'bg-green-500/15 text-green-300', amber: 'bg-amber-400/15 text-amber-300', red: 'bg-red-500/15 text-red-300' }
function Row({ icon, tone, title, sub, onClick, chevron = true }: { icon: IconName; tone: keyof typeof TILE; title: string; sub?: string; onClick?: () => void; chevron?: boolean }) {
  const inner = <>
    <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${TILE[tone]}`}><Icon name={icon} className="w-5 h-5" /></span>
    <span className="flex-1 min-w-0"><span className="block text-pt-text text-[16px] font-semibold">{title}</span>{sub && <span className="block text-pt-muted text-[14px]">{sub}</span>}</span>
    {onClick && chevron && <span className="text-pt-muted" aria-hidden>›</span>}
  </>
  const cls = 'w-full flex items-center gap-3 px-4 py-3 min-h-[60px] text-left'
  return onClick ? <button onClick={onClick} className={cls}>{inner}</button> : <div className={cls}>{inner}</div>
}

// Your standing, as one slim row: "No strikes ✓", the count, or the pause.
function StrikesRow({ email }: { email: string }) {
  const st = useMyStatus(email)
  const paused = !!st?.pausedUntil && st.pausedUntil > todayInStudio()
  const n = st?.strikes ?? 0
  return (
    <div className={`rounded-2xl overflow-hidden ${paused ? 'bg-red-500/10 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.4)]' : 'bg-pt-surface shadow-hairline'}`}>
      <Row icon={paused ? 'pause' : n ? 'alert' : 'check'} tone={paused ? 'red' : n ? 'amber' : 'green'}
        title={paused ? `Props paused until ${formatDay(st!.pausedUntil!)}` : n ? `${n} strike${n === 1 ? '' : 's'}` : 'No strikes ✓'}
        sub={paused ? 'You can still book house time.' : n ? 'From no-shows, late cancels or upheld reports.' : 'Keep showing up and finishing on time.'} />
    </div>
  )
}
