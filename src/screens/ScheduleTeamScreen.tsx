import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import Avatar from '../components/Avatar'
import { Pill } from '../components/GearUi'
import { PhotoStrip } from '../components/ProofPhotos'
import { formatDay } from '../lib/dates'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import {
  useScheduleSettings, useShootsSince, useOpenReports, useAllStatuses, decideShoot, reviewReport, liftPause, errorText,
  isMissed, fmtSlot, type Shoot,
} from '../services/schedule'

type Tab = 'checkins' | 'reports' | 'creators'

// Schedule team (owner + equipment): who filmed, missed check-ins, reports, strikes and pauses.
export default function ScheduleTeamScreen() {
  const navigate = useNavigate()
  const { isGearStaff, isAdmin, canManagePeople } = useSession()
  const canDecide = isGearStaff || isAdmin   // admins manage the creators too (owner, Oct 20)
  const s = useScheduleSettings()
  const today = todayInStudio(), now = nowStamp()
  const shoots = useShootsSince(addDays(today, -s.strikeDays), true)
  const reports = useOpenReports(true)
  const statuses = useAllStatuses(true)
  const [tab, setTab] = useState<Tab>('checkins')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  async function run(key: string, f: () => Promise<unknown>) { setBusy(key); setErr(''); try { await f() } catch (e) { setErr(errorText(e)) } finally { setBusy('') } }
  const where = (x: Shoot) => x.place === 'offsite' ? x.where : s.houses[x.place].name

  const all = shoots ?? []
  const missed = all.filter(x => isMissed(x, now)).sort((a, b) => a.from.localeCompare(b.from))
  const recent = all.filter(x => x.status === 'booked' && (x.date === today || x.date === addDays(today, -1)) && !isMissed(x, now)).sort((a, b) => a.from.localeCompare(b.from))
  const people = useMemo(() => {
    const m = new Map<string, { email: string; name: string; booked: number; filmed: number; missed: number }>()
    for (const x of all) {
      if (x.to > now && x.status === 'booked') continue                     // not happened yet
      if (x.status === 'cancelled' && !x.noShow) continue                    // free cancels don't count
      const p = m.get(x.creatorEmail) ?? { email: x.creatorEmail, name: x.creatorName, booked: 0, filmed: 0, missed: 0 }
      p.booked++
      if (x.checkin || x.outcome === 'filmed') p.filmed++
      else if (x.noShow || x.outcome === 'noshow') p.missed++
      m.set(x.creatorEmail, p)
    }
    for (const [email, st] of Object.entries(statuses)) if (!m.has(email) && (st.strikes || st.pausedUntil)) m.set(email, { email, name: st.name || email, booked: 0, filmed: 0, missed: 0 })
    return [...m.values()].sort((a, b) => (b.missed - a.missed) || a.name.localeCompare(b.name))
  }, [all, statuses, now])

  const tabs: [Tab, string][] = [['checkins', `Check-ins${missed.length ? ` (${missed.length})` : ''}`], ['reports', `Reports${reports.length ? ` (${reports.length})` : ''}`], ['creators', 'Creators']]
  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <div className="flex items-end gap-2 py-2">
          <button onClick={() => navigate('/schedule')} className="tap w-8 -ml-2 text-pt-accent text-[34px] font-light leading-none pb-1" aria-label="Back">‹</button>
          <h1 className="font-display text-[34px] text-pt-text">Schedule team</h1>
        </div>
        <div className="flex gap-2">
          {tabs.map(([v, l]) => <button key={v} onClick={() => setTab(v)} className={`px-3 py-1 rounded-full text-sm ${tab === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>{l}</button>)}
        </div>
      </div>
      <div className="p-4 space-y-2">
        {err && <p className="text-red-300 text-sm">{err}</p>}
        {shoots === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}

        {tab === 'checkins' && <>
          <h2 className="text-pt-text font-semibold">Needs a decision</h2>
          <p className="text-pt-muted text-sm">No check-in by the end of the slot. The creator has {s.explainHours} hours to explain; then you decide.</p>
          {missed.length === 0 && <p className="text-pt-muted text-sm">Nothing to decide.</p>}
          {missed.map(x => (
            <div key={x.id} className="bg-pt-surface rounded-2xl p-3 space-y-2">
              <div className="flex items-center gap-3"><Avatar email={x.creatorEmail} name={x.creatorName} />
                <div className="flex-1 min-w-0"><p className="text-pt-text font-semibold truncate">{x.creatorName}</p><p className="text-pt-muted text-xs">{formatDay(x.date)} · {where(x)} · {fmtSlot(x.start, x.end - x.start)}</p></div>
                <Pill tone="taken">No check-in</Pill></div>
              {x.explanation ? <p className="text-pt-text text-sm">“{x.explanation.text}”</p> : <p className="text-pt-muted text-xs">No explanation yet.</p>}
              {canDecide ? <div className="flex gap-2">
                <button disabled={!!busy} onClick={() => run(x.id, () => decideShoot({ id: x.id, outcome: 'filmed' }))} className="flex-1 bg-pt-border text-pt-text rounded-xl py-2 text-sm disabled:opacity-40">They filmed</button>
                <button disabled={!!busy} onClick={() => run(x.id, () => decideShoot({ id: x.id, outcome: 'noshow' }))} className="flex-1 bg-red-500/80 text-white font-semibold rounded-xl py-2 text-sm disabled:opacity-40">No-show · strike</button>
              </div> : <p className="text-pt-muted text-xs">Waiting for the schedule team to decide.</p>}
            </div>
          ))}
          <h2 className="text-pt-text font-semibold pt-3">Yesterday and today</h2>
          {recent.length === 0 && <p className="text-pt-muted text-sm">No shoots.</p>}
          {recent.map(x => (
            <div key={x.id} className="bg-pt-surface rounded-2xl p-3 space-y-2">
              <div className="flex items-center gap-3"><Avatar email={x.creatorEmail} name={x.creatorName} />
                <div className="flex-1 min-w-0"><p className="text-pt-text font-semibold truncate">{x.creatorName}</p>
                  <p className="text-pt-muted text-xs">{x.date === today ? 'Today' : 'Yesterday'} · {where(x)} · {fmtSlot(x.start, x.end - x.start)}{x.wrap ? ` · “${x.wrap.title}”` : ''}</p></div>
                {x.wrap ? <Pill tone="free">Filmed</Pill> : x.checkin ? <Pill tone="free">Checked in</Pill> : x.outcome === 'filmed' ? <Pill tone="free">Filmed</Pill> : <Pill tone="muted">Upcoming</Pill>}</div>
              {x.checkin && <PhotoStrip urls={x.checkin.photos} title="Set photo" />}
            </div>
          ))}
        </>}

        {tab === 'reports' && <>
          <p className="text-pt-muted text-sm">Sent by the next creator at check-in. {canDecide ? 'Dismiss, or uphold it to give that person a strike.' : 'The schedule team dismisses or upholds them.'}</p>
          {reports.length === 0 && <p className="text-pt-muted text-sm">No reports to review.</p>}
          {reports.map(r => (
            <div key={r.id} className="bg-pt-surface rounded-2xl p-3 space-y-2">
              <div className="flex items-center gap-3"><Avatar email={r.onEmail} name={r.onName} />
                <div className="flex-1 min-w-0"><p className="text-pt-text font-semibold truncate">{r.byName} reported {r.onName}</p>
                  <p className="text-pt-muted text-xs">{formatDay(r.date)} · {r.place === 'offsite' ? 'Offsite' : s.houses[r.place].name}</p></div>
                <Pill tone="warn">Report</Pill></div>
              <p className="text-pt-text text-sm">{[r.overMinutes ? `Ran over ${r.overMinutes} min` : '', r.mess ? 'Left the house a mess' : ''].filter(Boolean).join(' · ')}</p>
              {r.note && <p className="text-pt-text text-sm bg-pt-bg rounded-xl px-3 py-2">“{r.note}”</p>}
              {r.photos.length > 0 && <PhotoStrip urls={r.photos} title="Photos" />}
              {canDecide ? <div className="flex gap-2">
                <button disabled={!!busy} onClick={() => run(r.id, () => reviewReport({ id: r.id, uphold: false }))} className="flex-1 bg-pt-border text-pt-text rounded-xl py-2 text-sm disabled:opacity-40">Dismiss</button>
                <button disabled={!!busy} onClick={() => run(r.id, () => reviewReport({ id: r.id, uphold: true }))} className="flex-1 bg-red-500/80 text-white font-semibold rounded-xl py-2 text-sm disabled:opacity-40">Strike for {r.onName}</button>
              </div> : <p className="text-pt-muted text-xs">Waiting for the schedule team to review.</p>}
            </div>
          ))}
        </>}

        {tab === 'creators' && <>
          <p className="text-pt-muted text-sm">Last {s.strikeDays} days. {s.strikeCount} strikes pause prop and gear bookings for {s.pauseDays} days.</p>
          {people.map(p => {
            const st = statuses[p.email]
            const paused = !!st?.pausedUntil && st.pausedUntil > today
            return (
              <div key={p.email} onClick={() => canManagePeople && navigate(`/people/${encodeURIComponent(p.email)}`)} className={`bg-pt-surface rounded-2xl p-3 flex items-center gap-3 ${canManagePeople ? 'cursor-pointer' : ''}`}>
                <Avatar email={p.email} name={p.name} />
                <div className="flex-1 min-w-0"><p className="text-pt-text font-semibold truncate">{p.name}</p>
                  <p className="text-pt-muted text-xs">{p.filmed} of {p.booked} filmed{p.missed ? ` · ${p.missed} missed` : ''}{st?.strikes ? ` · ${st.strikes} strike${st.strikes === 1 ? '' : 's'}` : ''}</p></div>
                {paused && !canDecide ? <Pill tone="taken">Paused</Pill> : paused
                  ? <button disabled={!!busy} onClick={e => { e.stopPropagation(); run(p.email, () => liftPause({ email: p.email })) }} className="shrink-0 bg-red-500/15 text-red-300 rounded-lg px-3 py-2 text-xs disabled:opacity-40">Paused · Lift</button>
                  : st?.strikes ? <Pill tone="warn">{st.strikes} strike</Pill> : <Pill tone="free">Reliable</Pill>}
              </div>
            )
          })}
          {people.length === 0 && <p className="text-pt-muted text-sm">No finished shoots yet.</p>}
        </>}
      </div>
    </div>
  )
}
