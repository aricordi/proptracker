// Flags you can act on (owner, Oct 21: "press the flag cards to see a list of all flags… remediation options for each one…
// so they can go as deep as they want"). A list with "To do / Handled / Excused / All" filters, and a sheet per flag with
// what happened (the evidence: times, set photos, the report and its photos, return photos, what came back damaged),
// what was already done about it, and what you can do now:
//  - decide it (missed check-in: they filmed / no-show · strike; report: dismiss / uphold · strike)
//  - send them a note (phone notification), give a strike for it, excuse it (stops counting), mark it handled
//  - remove the strike that came with it
import { lateFor, stampLabel, valueLabel, fmtMoney, LATE_FEE_PERCENT } from '../../lib/lateReturns'
import { useState } from 'react'
import Avatar from '../Avatar'
import BottomSheet from '../BottomSheet'
import { PhotoStrip } from '../ProofPhotos'
import { formatDay } from '../../lib/dates'
import { KIND, type Incident } from '../../lib/analytics'
import { flagState, stillOut, warnText, STATE_LABEL, type FlagState } from '../../lib/flagState'
import { HOUSE_LABEL } from '../../lib/insights'
import { decideShoot, reviewReport, removeStrike, reviewFlag, errorText, type FlagReview, type FlagAction, type Shoot, type ScheduleReport, type Strike } from '../../services/schedule'
import { fmtHours, type GearBooking } from '../../services/gear'
import type { Reservation } from '../../services/reservations'

export interface FlagCtx {
  reviews: Map<string, FlagReview>; excused: Incident[]; staffName: (e: string) => string; navigate: (to: string) => void
  raw: { shoots: Map<string, Shoot>; reports: Map<string, ScheduleReport>; props: Map<string, Reservation>; gear: Map<string, GearBooking>; strikes: Map<string, Strike> }
}
export type FlagFilter = 'todo' | 'handled' | 'excused' | 'all'

export const STATE_STYLE: Record<FlagState, string> = {
  decide: 'bg-amber-500/15 text-amber-200', todo: 'bg-pt-accent/15 text-pt-accent', handled: 'bg-green-500/15 text-green-300', excused: 'bg-pt-border text-pt-muted' }
const mins = (stamp: string) => Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16))
const hoursOf = (x: { from: string; to: string }) => fmtHours(mins(x.from), mins(x.to))
const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' })

// Each flag with where it stands, for a list that includes the excused ones.
export function withState(list: Incident[], excused: Incident[], reviews: Map<string, FlagReview>) {
  return [...list.map(i => ({ i, s: flagState(i, reviews.get(i.id)) })), ...excused.map(i => ({ i, s: 'excused' as FlagState }))]
    .sort((x, y) => y.i.date.localeCompare(x.i.date))
}
export function countStates(xs: { s: FlagState }[]) {
  const n = { todo: 0, handled: 0, excused: 0, all: xs.length, decide: 0 }
  for (const x of xs) { if (x.s === 'decide' || x.s === 'todo') n.todo++; if (x.s === 'decide') n.decide++; if (x.s === 'handled') n.handled++; if (x.s === 'excused') n.excused++ }
  return n
}
// Flags since `from` that nobody has decided or done anything about (for "Needs you now"; decisions are counted there separately).
export const notLookedAt = (incidents: Incident[], reviews: Map<string, FlagReview>, from: string) =>
  incidents.filter(i => i.date >= from && flagState(i, reviews.get(i.id)) === 'todo').length
const matches = (f: FlagFilter) => (x: { s: FlagState }) => f === 'all' || (f === 'todo' ? x.s === 'decide' || x.s === 'todo' : x.s === f)

export function FlagFilters({ xs, f, onF, tourId, serious }: { xs: { s: FlagState }[]; f: FlagFilter; onF: (f: FlagFilter) => void; tourId?: string
  serious?: { on: boolean; toggle: () => void } }) {
  const n = countStates(xs)
  const chips: [FlagFilter, string, number][] = [['todo', 'To do', n.todo], ['handled', 'Handled', n.handled], ['excused', 'Excused', n.excused], ['all', 'All', n.all]]
  return (
    <div data-tour={tourId} className="flex gap-2 overflow-x-auto no-scrollbar">
      {chips.map(([v, l, k]) => <button key={v} onClick={() => onF(v)} className={`shrink-0 px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${f === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface text-pt-muted'}`}>{l} · {k}</button>)}
      {serious && <button onClick={serious.toggle} className={`shrink-0 px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${serious.on ? 'bg-red-500/20 text-red-300 font-medium' : 'bg-pt-surface text-pt-muted'}`}>Serious only{serious.on ? ' ×' : ''}</button>}
    </div>
  )
}

// The list itself. Tapping a row opens the flag sheet.
export function FlagList({ xs, f, ctx, showWho, limit, tourId }: { xs: { i: Incident; s: FlagState }[]; f: FlagFilter; ctx: FlagCtx; showWho: boolean; limit?: number; tourId?: string }) {
  const [open, setOpen] = useState<Incident | null>(null)
  const [all, setAll] = useState(false)
  const shown = xs.filter(matches(f))
  const list = limit && !all ? shown.slice(0, limit) : shown
  return <>
    <div data-tour={tourId} className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
      {shown.length === 0 && <p className="text-pt-muted text-sm px-3 py-4">{f === 'todo' ? 'Nothing to do here. Nice.' : 'None in this view.'}</p>}
      {list.map(({ i, s }) => (
        <button key={i.id} onClick={() => setOpen(i)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
          {showWho && <Avatar email={i.email} name={i.name} size={32} />}
          <span className="flex-1 min-w-0">
            <span className="block text-pt-text text-[15px] truncate">{showWho ? `${i.name} · ` : ''}{KIND[i.kind].label}</span>
            <span className="block text-pt-muted text-xs truncate">{formatDay(i.date)} · {i.late ? `${lateFor(i.late.minutes)} late${i.kind === 'late-gear' && i.late.value ? ` · ${fmtMoney(i.late.value)}` : ''} · ` : ''}{i.text}</span>
          </span>
          <span className="flex flex-col items-end gap-1 shrink-0">
            <span className={`text-xs rounded-full px-2 py-1 ${STATE_STYLE[s]}`}>{STATE_LABEL[s]}</span>
            {stillOut(i) && <span className="text-xs rounded-full px-2 py-0.5 bg-red-500/15 text-red-300">Still out</span>}
          </span>
        </button>
      ))}
    </div>
    {limit && !all && shown.length > limit && <button onClick={() => setAll(true)} className="w-full py-3 rounded-2xl bg-pt-surface text-pt-accent text-[15px]">Show all {shown.length}</button>}
    <FlagSheet flag={open} ctx={ctx} onClose={() => setOpen(null)} excused={!!open && ctx.excused.some(x => x.id === open.id)} />
  </>
}

type Form = null | { action: FlagAction | 'remove-strike' | 'noshow' | 'uphold'; note: string }

export function FlagSheet({ flag, ctx, onClose, excused }: { flag: Incident | null; ctx: FlagCtx; onClose: () => void; excused: boolean }) {
  const [form, setForm] = useState<Form>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const close = () => { setForm(null); setErr(''); setDone(''); onClose() }
  if (!flag) return <BottomSheet open={false} onClose={close} title="">{null}</BottomSheet>
  const i = flag, review = ctx.reviews.get(i.id), state = flagState(i, review, excused)
  const first = i.name.split(' ')[0]
  const strike = i.strikeId ? ctx.raw.strikes.get(i.strikeId) : undefined
  const hasStrike = !!strike && !strike.removedAt
  const report = i.src.type === 'report' ? ctx.raw.reports.get(i.src.id) : undefined

  async function run(f: () => Promise<string>) {
    setBusy(true); setErr('')
    try { setDone(await f()); setForm(null) } catch (e) { setErr(errorText(e)) } finally { setBusy(false) }
  }
  const flagCall = (action: FlagAction, note: string) => reviewFlag({ flagId: i.id, action, note, email: i.email, kind: i.kind,
    label: `${KIND[i.kind].label} · ${formatDay(i.date)}`, shootId: i.shootId })
  async function submit() {
    if (!form) return
    const note = form.note.trim()
    await run(async () => {
      switch (form.action) {
        case 'noshow': { await decideShoot({ id: i.src.id, outcome: 'noshow' }); return `Marked as a no-show. ${first} got a strike.` }
        case 'uphold': { await reviewReport({ id: report!.id, uphold: true }); return `Report upheld. ${first} got a strike.` }
        case 'remove-strike': { const r = await removeStrike({ id: i.strikeId!, note }); return `Strike removed.${r.data.lifted ? ` ${first}'s pause is lifted too.` : ''}` }
        case 'strike': { const r = await flagCall('strike', note); return r.data.strike?.paused ? `Strike given. ${first} now has ${r.data.strike.strikes}, so their prop and gear bookings are paused.` : `Strike given. ${first} has ${r.data.strike?.strikes ?? 1} right now.` }
        case 'warn': { await flagCall('warn', note); return `Note sent to ${first}'s phone.` }
        case 'excuse': { await flagCall('excuse', note); return "Excused. It won't count any more." }
        case 'handled': { await flagCall('handled', note); return 'Marked as handled.' }
        default: return ''
      }
    })
  }
  const quick = (f: () => Promise<unknown>, msg: string) => run(async () => { await f(); return msg })

  const NEEDS_REASON: Record<string, string> = { strike: 'Why? It goes on their record and they get a notification.', warn: 'What should they read? It goes to their phone.',
    excuse: "Why doesn't it count? (for the record)", 'remove-strike': 'Why does the strike come off? (for the record)', handled: 'Anything to note? (optional, only admins see it)' }
  const FORM_BUTTON: Record<string, [string, string]> = { strike: ['Give the strike', 'bg-red-500/80 text-white'], warn: ['Send the note', 'bg-pt-accent text-stone-900'],
    excuse: ['Excuse it', 'bg-pt-border text-pt-text'], 'remove-strike': ['Remove the strike', 'bg-pt-border text-pt-text'], handled: ['Mark as handled', 'bg-green-500/80 text-white'],
    noshow: ['Confirm no-show · strike', 'bg-red-500/80 text-white'], uphold: [`Uphold · strike for ${first}`, 'bg-red-500/80 text-white'] }
  const needsNote = form && ['strike', 'warn', 'excuse', 'remove-strike'].includes(form.action)
  const action = (label: string, onClick: () => void, tone = 'bg-white/[0.07] text-pt-text') =>
    <button key={label} disabled={busy} onClick={onClick} className={`w-full py-3 rounded-xl text-[15px] font-semibold disabled:opacity-40 ${tone}`}>{label}</button>

  return (
    <BottomSheet open onClose={close} title={KIND[i.kind].label}>
      <div className="space-y-4 pb-4">
        <div className="flex items-center gap-3">
          <Avatar email={i.email} name={i.name} size={44} />
          <span className="flex-1 min-w-0"><b className="block text-pt-text text-[17px] truncate">{i.name}</b>
            <span className="block text-pt-muted text-sm">{formatDay(i.date, { weekday: 'long', month: 'short', day: 'numeric' })}{i.house ? ` · ${HOUSE_LABEL[i.house]}` : ''}</span></span>
          <span className={`text-xs rounded-full px-2 py-1 shrink-0 ${STATE_STYLE[state]}`}>{STATE_LABEL[state]}</span>
        </div>
        <div className="bg-pt-surface rounded-2xl p-3 space-y-1">
          <p className="text-pt-text text-[15px]">{i.text}</p>
          {!KIND[i.kind].means.startsWith(i.text.slice(0, 12)) && <p className="text-pt-muted text-sm">{KIND[i.kind].means}</p>}
          {stillOut(i) && <p className="text-red-300 text-sm">Still out right now.</p>}
        </div>

        <Evidence i={i} ctx={ctx} />

        {(review?.actions?.length || hasStrike) ? <div>
          <p className="text-pt-muted text-sm mb-2">What was done</p>
          <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
            {hasStrike && i.kind !== 'strike' && <p className="px-3 py-2.5 text-sm text-pt-text">Strike on their record{strike!.by ? ` · by ${ctx.staffName(strike!.by)}` : ''} · {when(strike!.at)}</p>}
            {(review?.actions ?? []).map((a, n) => <div key={n} className="px-3 py-2.5">
              <p className="text-sm text-pt-text">{ACTION_LABEL[a.action]} by {ctx.staffName(a.by)} · {when(a.at)}</p>
              {a.note && <p className="text-pt-muted text-sm">“{a.note}”</p>}
            </div>)}
          </div>
        </div> : null}

        {done ? <div className="space-y-3 text-center">
          <p className="text-pt-text text-[15px]">{done}</p>
          <button onClick={close} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Done</button>
        </div> : form ? <div className="space-y-3">
          {form.action === 'noshow' || form.action === 'uphold'
            ? <p className="text-pt-muted text-sm">{first} gets a strike. It counts toward the automatic pause, and they get a notification.</p>
            : <><p className="text-pt-muted text-sm">{NEEDS_REASON[form.action]}</p>
              <textarea autoFocus value={form.note} onChange={e => setForm({ ...form, note: e.target.value.slice(0, 300) })} rows={3}
                className="w-full bg-pt-bg rounded-xl px-3 py-3 text-pt-text shadow-hairline resize-none focus:outline-none focus:ring-1 focus:ring-pt-accent" /></>}
          {err && <p className="text-red-300 text-sm">{err}</p>}
          <button disabled={busy || (!!needsNote && form.note.trim().length < 3)} onClick={submit} className={`w-full py-4 rounded-2xl font-semibold disabled:opacity-40 ${FORM_BUTTON[form.action][1]}`}>{busy ? 'Saving…' : FORM_BUTTON[form.action][0]}</button>
          <button onClick={() => { setForm(null); setErr('') }} className="w-full py-2 text-pt-muted text-sm">Back</button>
        </div> : <div className="space-y-2">
          {err && <p className="text-red-300 text-sm">{err}</p>}
          {/* Decide first: these are waiting on the team. */}
          {state === 'decide' && i.kind === 'missed-checkin' && <>
            <p className="text-pt-muted text-sm">Did {first} film? {i.shootId && ctx.raw.shoots.get(i.shootId)?.explanation ? 'Read what they explained above.' : "They haven't explained yet."}</p>
            {action('They filmed', () => quick(() => decideShoot({ id: i.src.id, outcome: 'filmed' }), `Marked as filmed. The flag is gone.`), 'bg-green-500/80 text-white')}
            {action('No-show · strike', () => setForm({ action: 'noshow', note: '' }), 'bg-red-500/15 text-red-300')}
          </>}
          {state === 'decide' && report && <>
            <p className="text-pt-muted text-sm">{report.byName || 'The next creator'} reported this. Check what they wrote and their photos above, then decide.</p>
            {action('Dismiss the report', () => quick(() => reviewReport({ id: report.id, uphold: false }), 'Report dismissed. The flag is gone.'))}
            {action(`Uphold · strike for ${first}`, () => setForm({ action: 'uphold', note: '' }), 'bg-red-500/15 text-red-300')}
          </>}
          {state !== 'decide' && state !== 'excused' && <>
            {i.kind !== 'strike' && action(`Send ${first} a note`, () => setForm({ action: 'warn', note: warnText(i) }), 'bg-pt-accent text-stone-900 shadow-gold')}
            {i.kind !== 'strike' && !hasStrike && action('Give a strike for this', () => setForm({ action: 'strike', note: '' }), 'bg-red-500/15 text-red-300')}
            {hasStrike && action(i.kind === 'strike' ? 'Remove this strike' : 'Remove the strike that came with it', () => setForm({ action: 'remove-strike', note: '' }))}
            {i.kind !== 'strike' && action("Excuse it (doesn't count)", () => setForm({ action: 'excuse', note: '' }))}
            {state === 'todo' && action('Mark as handled', () => setForm({ action: 'handled', note: '' }))}
          </>}
          {state === 'excused' && action('Count it again', () => quick(() => flagCall('unexcuse', ''), 'It counts again.'))}
          {i.to && <button onClick={() => { close(); ctx.navigate(i.to!) }} className="w-full py-3 text-pt-accent text-[15px]">Open the {i.src.type === 'props' ? 'props request' : i.src.type === 'gear' ? 'gear booking' : 'shoot'} ›</button>}
        </div>}
      </div>
    </BottomSheet>
  )
}

const ACTION_LABEL: Record<FlagAction, string> = { excuse: 'Excused', unexcuse: 'Counted again', warn: 'Note sent', strike: 'Strike given', handled: 'Marked handled' }

// What happened, from the records behind the flag.
function Evidence({ i, ctx }: { i: Incident; ctx: FlagCtx }) {
  const rows: [string, string][] = []
  let photos: { urls: string[]; title: string }[] = []
  const shoot = i.shootId ? ctx.raw.shoots.get(i.shootId) : undefined
  if (shoot) {
    rows.push(['Shoot', `${shoot.place === 'offsite' ? shoot.where || 'Offsite' : HOUSE_LABEL[shoot.place]} · ${hoursOf(shoot)}`])
    if (shoot.checkin) { rows.push(['Checked in', when(shoot.checkin.at)]); photos.push({ urls: shoot.checkin.photos, title: 'Set photo' }) }
    if (shoot.wrap) rows.push(['Filmed', `“${shoot.wrap.title}”`])
    if (shoot.explanation) rows.push(['They explained', `“${shoot.explanation.text}”`])
    const cancel = shoot.history?.find(h => h.action === 'cancelled')
    if (shoot.status === 'cancelled' && cancel) rows.push(['Cancelled', when(cancel.at)])
    const decided = shoot.history?.find(h => h.action === 'no-show')
    if (decided) rows.push(['Marked no-show by', ctx.staffName(decided.by)])
  }
  if (i.src.type === 'report') {
    const r = ctx.raw.reports.get(i.src.id)
    if (r) {
      rows.push(['Reported by', `${r.byName || 'The next creator'} (next slot)`])
      if (r.overMinutes) rows.push(['Ran over', `${r.overMinutes} min`])
      if (r.note) rows.push(['Their note', `“${r.note}”`])
      photos.push({ urls: r.photos, title: 'Report photos' })
    }
  }
  if (i.src.type === 'props') {
    const r = ctx.raw.props.get(i.src.id)
    if (r) {
      rows.push(['Request', `“${r.title}”`])
      if (r.returnInfo) { rows.push(['Brought back', when(r.returnInfo.at)]); if (r.returnInfo.note) rows.push(['Their note', `“${r.returnInfo.note}”`]); photos.push({ urls: r.returnInfo.photos, title: 'Return photos' }) }
      for (const l of r.lines ?? []) if (l.checkIn && l.checkIn.result !== 'ok') rows.push([l.itemName, `${l.checkIn.result}${l.checkIn.note ? `: ${l.checkIn.note}` : ''}`])
    }
  }
  if (i.src.type === 'gear') {
    const g = ctx.raw.gear.get(i.src.id)
    if (g) {
      rows.push(['Booking', `“${g.title}” · ${hoursOf(g)}`])
      if (g.pickup) rows.push(['Picked up by', ctx.staffName(g.pickup.by)])
      // returnedAt is a studio time 'YYYY-MM-DDTHH:MM' (not a UTC timestamp); the late rows below already show it.
      if (g.returnedAt && !i.late) rows.push(['Brought back', stampLabel(g.returnedAt)])
      if (g.usedByNames?.length) rows.push(['Used by', g.usedByNames.join(', ')])
      if (g.checkIn?.note) rows.push(['Check-in note', `“${g.checkIn.note}”`])
      if (g.return) photos.push({ urls: g.return.photos, title: 'Return photo' })
    }
  }
  if (i.late) {
    // Late return fee (owner, Oct 27): admins see exactly how late, to decide on exceptions.
    rows.push(['Due back', stampLabel(i.late.dueAt) + (i.kind === 'late-gear' ? ' (late from 30 min after)' : '')])
    rows.push([i.late.still ? 'Still out' : 'Came back', i.late.still ? `${lateFor(i.late.minutes)} so far` : `${i.late.backAt ? stampLabel(i.late.backAt) + ' · ' : ''}${lateFor(i.late.minutes)} late`])
    if (i.kind === 'late-gear') {
      rows.push(['Last had it', i.name])
      rows.push(['Value', valueLabel(i.late)])
      rows.push(['Late fee', `Applies: ${LATE_FEE_PERCENT}% of the value (not charged by the app). Excuse it to make an exception.`])
    } else rows.push(['Late fee', 'No fee for props for now (logged only)'])
  }
  if (i.src.type === 'strike') {
    const s = ctx.raw.strikes.get(i.src.id)
    if (s) { rows.push(['Given by', s.by ? ctx.staffName(s.by) : 'The app']); if (s.note) rows.push(['Reason', `“${s.note}”`]) }
  }
  photos = photos.filter(p => p.urls?.length)
  if (!rows.length && !photos.length) return null
  return <div className="space-y-3">
    {rows.length > 0 && <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
      {rows.map(([k, v], n) => <div key={n} className="flex gap-3 px-3 py-2.5 text-sm"><span className="text-pt-muted w-28 shrink-0">{k}</span><span className="text-pt-text flex-1 min-w-0 break-words">{v}</span></div>)}
    </div>}
    {photos.map(p => <PhotoStrip key={p.title} urls={p.urls} title={p.title} />)}
  </div>
}
