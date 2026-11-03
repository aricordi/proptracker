// Give it to Kyle (owner, Nov 2: "Kyle / Stromedy always wins"). The schedule team gives a slot someone holds to a person
// with top priority: the holder is moved to another free time that day (props and gear follow) or cancelled (sorry note,
// their next request goes first). ClashList shows events from Google Calendar that landed on someone else's slot.
import { useEffect, useMemo, useState } from 'react'
import { formatDay } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { todayInStudio } from '../../functions/src/booking'
import { nowStamp } from '../../functions/src/gearBooking'
import BottomSheet from './BottomSheet'
import Avatar from './Avatar'
import {
  useScheduleSettings, useScheduleDays, giveSlot, listSchedulePeople, slotState, fmtSlot, HOUSES,
  type House, type ScheduleDay, type ScheduleSettings,
} from '../services/schedule'

export interface GiveTarget { date: string; house: House; start: number; holder: { name: string; email: string }; clash?: { shootId: string; name: string; email?: string } }

export function GiveSlotSheet({ t, onClose }: { t: GiveTarget; onClose: () => void }) {
  const s = useScheduleSettings()
  const days = useScheduleDays(t.date, t.date)
  const day = days?.[t.date]
  const now = nowStamp()
  const [people, setPeople] = useState<{ email: string; name: string }[]>([])
  const [q, setQ] = useState('')
  const [to, setTo] = useState<{ email: string; name: string } | null>(t.clash ? { email: t.clash.email ?? '', name: t.clash.name } : s.instantBookers[0] ?? null)
  const [move, setMove] = useState<{ house: House; start: number } | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  useEffect(() => { if (!t.clash) listSchedulePeople({}).then(r => setPeople(r.data.people)).catch(() => setPeople([])) }, [t.clash])
  useEffect(() => { if (!to && !t.clash && s.instantBookers[0]) setTo(s.instantBookers[0]) }, [s.instantBookers, to, t.clash])
  const first = t.holder.name.split(' ')[0]
  // Free times that day (both houses), soonest first, for moving the holder.
  const free = useMemo(() => HOUSES.flatMap(h => s.slots.filter(st => !(h === t.house && st === t.start))
    .filter(st => slotState(day, t.date, h, st, s, t.holder.email, now, true).t === 'free').map(st => ({ house: h, start: st }))
  ).sort((a, b) => Math.abs(a.start - t.start) - Math.abs(b.start - t.start) || a.house.localeCompare(b.house)).slice(0, 6), [day, s, t, now])
  const matches = q.trim().length < 2 ? [] : people.filter(p => `${p.name} ${p.email}`.toLowerCase().includes(q.trim().toLowerCase()) && p.email !== t.holder.email).slice(0, 5)

  async function go() {
    if (!to || move === undefined) return
    setBusy(true); setErr('')
    try {
      const r = await giveSlot({ date: t.date, house: t.house, start: t.start, ...(t.clash ? { clashShootId: t.clash.shootId } : { toEmail: to.email }), moveTo: move })
      setDone(r.data.moved ? `Done ✓ ${to.name} has it. ${first} moved and got a notification.` : `Done ✓ ${to.name} has it. ${first}'s shoot was cancelled; they got a sorry note and their next request goes first.`)
    } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }

  return (
    <BottomSheet open onClose={onClose} title={`Give this slot to ${t.clash ? t.clash.name : 'someone'}`}>
      <div className="space-y-4">
        <p className="text-pt-text text-[15px]">{s.houses[t.house].name} · {formatDay(t.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtSlot(t.start, s.slotMinutes)}
          <span className="block text-pt-muted text-[13px]">{t.holder.name} has it now.</span></p>
        {done ? <><p className="text-green-400 font-semibold">{done}</p><button onClick={onClose} className="w-full min-h-[44px] rounded-xl bg-pt-border">Close</button></> : <>
          {!t.clash && (
            <div className="space-y-2">
              <p className="text-pt-muted text-xs font-semibold">Who gets it</p>
              <div className="flex flex-wrap gap-2">
                {[...s.instantBookers, ...(to && !s.instantBookers.some(p => p.email === to.email) ? [to] : [])].map(p => (
                  <button key={p.email} onClick={() => setTo(p)} className={`flex items-center gap-2 rounded-full pl-1 pr-3 min-h-[40px] ${to?.email === p.email ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-border text-pt-text'}`}>
                    <Avatar email={p.email} name={p.name} size={30} />{p.name}</button>))}
              </div>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Someone else? Type a name" className="w-full min-h-[44px] rounded-xl bg-pt-bg text-pt-text px-3 text-[16px]" />
              {matches.map(p => <button key={p.email} onClick={() => { setTo(p); setQ('') }} className="w-full text-left px-3 py-2 rounded-xl bg-pt-bg text-pt-text">{p.name}</button>)}
            </div>
          )}
          <div className="space-y-2">
            <p className="text-pt-muted text-xs font-semibold">What happens to {first}?</p>
            {free.map(f => (
              <button key={`${f.house}${f.start}`} onClick={() => setMove(f)} className={`w-full text-left px-3 min-h-[44px] rounded-xl ${move && move.house === f.house && move.start === f.start ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-bg text-pt-text'}`}>
                Move them to {s.houses[f.house].name} · {fmtSlot(f.start, s.slotMinutes)}</button>))}
            {!free.length && <p className="text-pt-muted text-[13px]">No other free time that day.</p>}
            <button onClick={() => setMove(null)} className={`w-full text-left px-3 min-h-[44px] rounded-xl ${move === null ? 'bg-red-500/20 text-red-200 font-semibold' : 'bg-pt-bg text-pt-text'}`}>
              Cancel their shoot (sorry note, their next request goes first)</button>
            <p className="text-pt-muted text-xs">Moving keeps their props and gear. Cancelling lets go of anything not picked up yet. No strike either way.</p>
          </div>
          {err && <p className="text-red-300 text-sm">{err}</p>}
          <button disabled={busy || !to || move === undefined} onClick={go} className="w-full min-h-[48px] rounded-xl bg-pt-accent text-stone-900 font-bold disabled:opacity-40">
            {busy ? 'Giving it…' : !to ? 'Pick who gets it' : move === undefined ? `Pick what happens to ${first}` : `Give it to ${to.name.split(' ')[0]}`}</button>
        </>}
      </div>
    </BottomSheet>
  )
}

/** Events from Google Calendar (e.g. Kyle's) that landed on a slot someone else already has. */
export function useCalendarClashes(days: Record<string, ScheduleDay> | null, s: ScheduleSettings): GiveTarget[] {
  const today = todayInStudio()
  return useMemo(() => {
    const out: GiveTarget[] = []
    for (const [date, day] of Object.entries(days ?? {})) {
      if (date < today) continue
      const seen = new Set<string>()
      for (const c of day.clashes ?? []) {
        if (c.blockId || !c.shootId) continue
        const holder = day[c.house]?.[c.slot]
        if (!holder?.shootId || holder.hold || holder.shootId === c.shootId) continue
        const k = `${c.shootId}|${c.house}|${holder.shootId}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ date, house: c.house, start: Number(c.slot), holder: { name: holder.name, email: holder.email ?? '' }, clash: { shootId: c.shootId, name: c.name, email: c.email } })
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
  }, [days, s, today])   // eslint-disable-line react-hooks/exhaustive-deps
}

export function ClashList({ items, s, onGive }: { items: GiveTarget[]; s: ScheduleSettings; onGive: (t: GiveTarget) => void }) {
  if (!items.length) return null
  return (
    <section className="rounded-2xl p-3 space-y-2 bg-red-500/[0.08] shadow-[inset_0_0_0_1px_rgba(248,113,113,0.35)]">
      <p className="text-red-200 font-semibold text-[15px]">From Google Calendar, on someone's slot ({items.length})</p>
      {items.map(t => (
        <div key={`${t.date}${t.house}${t.start}${t.clash!.shootId}`} className="flex items-center gap-2">
          <p className="flex-1 min-w-0 text-[13px] text-pt-text leading-snug"><b>{t.clash!.name}</b> · {formatDay(t.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {s.houses[t.house].name} · {fmtSlot(t.start, s.slotMinutes)}
            <span className="block text-pt-muted">{t.holder.name} has it in the app</span></p>
          <button onClick={() => onGive(t)} className="shrink-0 rounded-xl px-3 min-h-[40px] bg-pt-accent text-stone-900 text-[13px] font-bold">Give it to {t.clash!.name.split(' ')[0]}</button>
        </div>
      ))}
    </section>
  )
}

