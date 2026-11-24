import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fmtTime } from '../../functions/src/gearBooking'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { useScheduleSettings, saveScheduleSettings, listSchedulePeople, errorText, houseOpen, houseClose, HOUSES, type ScheduleSettings, type House } from '../services/schedule'
import { PageHeader } from '../components/PageHeader'

const field = 'w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30)
const CLOSE_TIMES = Array.from({ length: 56 }, (_, i) => i * 30)   // up to 3:30 AM the next day
/** The stored grid from open/close: starts every `len` minutes, and the last one ends exactly at `close`. */
function hoursGrid(open: number, close: number, len: number) {
  const out: number[] = []
  for (let t = open; t + len <= close && t < 1440; t += len) out.push(t)
  const last = close - len
  if (last >= open && last < 1440 && last % 30 === 0 && !out.includes(last)) out.push(last)
  return out.length ? out.sort((a, b) => a - b) : [open]
}

// Schedule team (owner + equipment): houses, house hours, monthly slots, priority group.
export default function ScheduleSettingsScreen() {
  const navigate = useNavigate()
  const live = useScheduleSettings()
  const [s, setS] = useState<ScheduleSettings | null>(null)
  const [people, setPeople] = useState<{ email: string; name: string; role: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { if (!s) setS(live) }, [live, s])
  useEffect(() => { listSchedulePeople({}).then(r => setPeople(r.data.people)).catch(() => setPeople([])) }, [])
  if (!s) return null
  const set = (patch: Partial<ScheduleSettings>) => { setS({ ...s, ...patch }); setMsg('') }
  const setHouse = (h: House, k: 'name' | 'address', v: string) => set({ houses: { ...s.houses, [h]: { ...s.houses[h], [k]: v } } })
  const inGroup = (email: string) => s.priority.some(p => p.email === email)
  const toggle = (p: { email: string; name: string }) =>
    set({ priority: inGroup(p.email) ? s.priority.filter(x => x.email !== p.email) : [...s.priority, { email: p.email, name: p.name }] })
  const isInstant = (email: string) => s.instantBookers.some(p => p.email === email)
  const isLong = (email: string) => (s.longBookers ?? []).some(p => p.email === email)
  const toggleLong = (p: { email: string; name: string }) =>
    set({ longBookers: isLong(p.email) ? s.longBookers.filter(x => x.email !== p.email) : [...(s.longBookers ?? []), { email: p.email, name: p.name }] })
  const toggleInstant = (p: { email: string; name: string }) =>
    set({ instantBookers: isInstant(p.email) ? s.instantBookers.filter(x => x.email !== p.email) : [...s.instantBookers, { email: p.email, name: p.name }] })
  const outsiders = s.priority.filter(p => !people.some(x => x.email === p.email))

  async function save() {
    setBusy(true); setMsg('')
    try { const r = await saveScheduleSettings(s!); setS(r.data); setMsg('Saved ✓') }
    catch (e) { setMsg(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full bg-pt-bg pb-40">
      <PageHeader title="Schedule settings" sub="These rules apply to everyone right away, and the How it works page updates to match." onBack={() => navigate('/schedule')} />
      <div className="px-4 pt-2 pb-8 space-y-6">

        <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
          <h2 className="text-pt-text font-semibold">Houses</h2>
          {HOUSES.map(h => (
            <div key={h} className="grid grid-cols-[1fr_1.6fr] gap-2">
              <input value={s.houses[h].name} onChange={e => setHouse(h, 'name', e.target.value)} className={field} aria-label="House name" />
              <input value={s.houses[h].address} onChange={e => setHouse(h, 'address', e.target.value)} className={field} aria-label="Address" />
            </div>
          ))}
        </section>

        <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
          {/* Free time (Nov 24): creators pick any start/end, so the grid only says when the houses open and close. */}
          <h2 className="text-pt-text font-semibold">House hours</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="block text-pt-muted text-xs mb-1">Open from</span>
              <select value={houseOpen(s)} onChange={e => set({ slots: hoursGrid(Number(e.target.value), Math.max(houseClose(s), Number(e.target.value) + s.slotMinutes), s.slotMinutes) })} className={field}>
                {HALF_HOURS.filter(t => t + s.slotMinutes <= 1440 + s.slotMinutes - 30).map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
              </select></label>
            <label className="block"><span className="block text-pt-muted text-xs mb-1">Until</span>
              <select value={houseClose(s)} onChange={e => set({ slots: hoursGrid(houseOpen(s), Number(e.target.value), s.slotMinutes) })} className={field}>
                {CLOSE_TIMES.filter(t => t >= houseOpen(s) + s.slotMinutes && t - s.slotMinutes < 1440).map(t => <option key={t} value={t}>{fmtTime(t % 1440)}{t > 1440 ? ' (next day)' : ''}</option>)}
              </select></label>
          </div>
          <p className="text-pt-muted text-xs">Creators book any start and end inside these hours, in 15-minute steps, up to {s.slotMinutes / 60} hours per person on the booking. Existing bookings keep their time.</p>
        </section>

        <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
          <h2 className="text-pt-text font-semibold">Monthly slots at {s.houses.cliff1.name}</h2>
          <div className="flex items-center gap-3">
            <button onClick={() => set({ monthlySlots: Math.max(0, s.monthlySlots - 1) })} className="w-11 h-11 rounded-xl bg-pt-bg text-pt-text text-xl">−</button>
            <span className="text-pt-text text-lg font-semibold tabular-nums w-8 text-center">{s.monthlySlots}</span>
            <button onClick={() => set({ monthlySlots: Math.min(31, s.monthlySlots + 1) })} className="w-11 h-11 rounded-xl bg-pt-bg text-pt-text text-xl">+</button>
            <span className="text-pt-muted text-sm">per creator, per month</span>
          </div>
          <p className="text-pt-muted text-sm">The equipment team puts the guaranteed slots in the Google Calendar; the app brings them in by itself.</p>
        </section>

        <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
          <h2 className="text-pt-text font-semibold">House bookings a day</h2>
          <div className="flex items-center gap-3">
            <button onClick={() => set({ slotsPerDay: Math.max(1, s.slotsPerDay - 1) })} className="w-11 h-11 rounded-xl bg-pt-bg text-pt-text text-xl">−</button>
            <span className="text-pt-text text-lg font-semibold tabular-nums w-8 text-center">{s.slotsPerDay}</span>
            <button onClick={() => set({ slotsPerDay: Math.min(9, s.slotsPerDay + 1) })} className="w-11 h-11 rounded-xl bg-pt-bg text-pt-text text-xl">+</button>
            <span className="text-pt-muted text-sm">per creator, both houses (as booker or collaborator)</span>
          </div>
          <p className="text-pt-muted text-xs">Need more for someone? Book it for them yourself (Book for → their name). Offsite shoots don't count.</p>
        </section>

        <CalendarSetup savedId={live.googleCalendarId} onImport={() => navigate('/schedule/import')} onApprove={() => navigate('/schedule/calendar')} />

        <section className="bg-pt-surface rounded-2xl p-4 space-y-2">
          <h2 className="text-pt-text font-semibold">Check-ins and strikes</h2>
          {([
            ['checkinBefore', 'minutes before the shoot, check-in opens', 0, 240, 5],
            ['explainHours', 'hours to explain a missed check-in', 0, 168, 1],
            ['strikeCount', 'strikes…', 1, 20, 1],
            ['strikeDays', '…within this many days…', 1, 365, 1],
            ['pauseDays', '…pause prop bookings for this many days', 0, 365, 1],
          ] as const).map(([k, label, min, max, stepBy]) => (
            <div key={k} className="flex items-center gap-3">
              <button onClick={() => set({ [k]: Math.max(min, s[k] - stepBy) } as Partial<ScheduleSettings>)} className="w-9 h-9 rounded-xl bg-pt-bg text-pt-text text-lg">−</button>
              <span className="text-pt-text font-semibold tabular-nums w-9 text-center">{s[k]}</span>
              <button onClick={() => set({ [k]: Math.min(max, s[k] + stepBy) } as Partial<ScheduleSettings>)} className="w-9 h-9 rounded-xl bg-pt-bg text-pt-text text-lg">+</button>
              <span className="text-pt-muted text-sm">{label}</span>
            </div>
          ))}
        </section>

        <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
          <h2 className="text-pt-text font-semibold">Moving and cancelling</h2>
          <HoursPicker value={s.noticeHours} min={0} max={336} onChange={v => set({ noticeHours: v })} label="hours' notice to move or cancel for free" />
          <p className="text-pt-muted text-xs">Closer than that, a creator can only swap with someone; cancelling counts as a no-show. Your own changes never count.</p>
        </section>

        <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
          <h2 className="text-pt-text font-semibold">App-only from</h2>
          <input type="date" value={s.appOnlyFrom} onChange={e => set({ appOnlyFrom: e.target.value })} className="w-full bg-pt-bg text-pt-text rounded-xl px-3 min-h-[44px]" />
          <p className="text-pt-muted text-xs">Creators see a banner in the chat: from this day, bookings and requests only count when they're made in the app. Leave empty for no banner. It disappears two weeks after the date.</p>
        </section>

        <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
          <h2 className="text-pt-text font-semibold">Gear (first come, first served)</h2>
          {/* Owner, Nov 3: no booking gear ahead in this first version. Kept as a switch so it can come back later. */}
          <button type="button" role="switch" aria-checked={s.gearReserve} onClick={() => set({ gearReserve: !s.gearReserve })} className="w-full flex items-center gap-3 text-left min-h-[44px]">
            <span className="flex-1 text-pt-text text-sm">Creators can reserve gear ahead</span>
            <span className={`shrink-0 w-12 h-7 rounded-full p-0.5 transition-colors ${s.gearReserve ? 'bg-pt-accent' : 'bg-pt-border'}`}><span className={`block w-6 h-6 rounded-full bg-white transition-transform ${s.gearReserve ? 'translate-x-5' : ''}`} /></span>
          </button>
          {s.gearReserve ? (
            <HoursPicker value={s.gearReserveHours} min={1} max={336} onChange={v => set({ gearReserveHours: v })} label="hours before a shoot creators can reserve gear" />
          ) : <p className="text-pt-muted text-xs">Off: gear isn't booked ahead. On the shoot day (from an hour before) creators take what's free, tick every piece and take one photo.</p>}
          <label className="flex items-center gap-3 text-sm"><span className="flex-1 text-pt-text">Offsite shoots bring gear back by</span>
            <select value={s.gearOffsiteBackBy} onChange={e => set({ gearOffsiteBackBy: Number(e.target.value) })} className="bg-pt-bg text-pt-text rounded-xl px-3 min-h-[44px]">
              {[1080, 1140, 1200, 1260, 1320, 1380, 1440].map(m => <option key={m} value={m}>{m === 1440 ? 'End of day (midnight)' : fmtTime(m)}</option>)}
            </select></label>
          <p className="text-pt-muted text-xs">House shoots bring it back when the shoot ends (it may go to the next person). Late = 30 minutes after either.</p>
        </section>

        <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
          <h2 className="text-pt-text font-semibold">Books without approval ({s.instantBookers.length})</h2>
          <p className="text-pt-muted text-xs">Every creator's booking waits for the equipment team, an admin or you to approve it. People ticked here (e.g. Kyle / Stromedy) get theirs at once.</p>
          <div className="max-h-60 overflow-y-auto rounded-xl bg-pt-bg divide-y divide-white/[0.06]">
            {people.length === 0 && <p className="text-pt-muted text-sm p-3">Loading people…</p>}
            {[...people, ...s.instantBookers.filter(p => !people.some(x => x.email === p.email)).map(p => ({ ...p, role: '' }))].map(p => (
              <PickRow key={p.email} name={p.name} email={p.email} on={isInstant(p.email)} onToggle={() => toggleInstant(p)} />
            ))}
          </div>
        </section>

        <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
          <h2 className="text-pt-text font-semibold">Can book long times alone ({(s.longBookers ?? []).length})</h2>
          <p className="text-pt-muted text-xs">Everyone else gets up to {s.slotMinutes / 60} h per person on a booking (longer = add collaborators). People ticked here (e.g. Danny / Stromedy Studios) can book as long as they need on their own. It's still asked for and approved, unless they're also ticked above.</p>
          <div className="max-h-60 overflow-y-auto rounded-xl bg-pt-bg divide-y divide-white/[0.06]">
            {people.length === 0 && <p className="text-pt-muted text-sm p-3">Loading people…</p>}
            {[...people, ...(s.longBookers ?? []).filter(p => !people.some(x => x.email === p.email)).map(p => ({ ...p, role: '' }))].map(p => (
              <PickRow key={p.email} name={p.name} email={p.email} on={isLong(p.email)} onToggle={() => toggleLong(p)} />
            ))}
          </div>
        </section>

        <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
          <h2 className="text-pt-text font-semibold">Priority days at {s.houses.cliff1.name}</h2>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((w, i) => (
              <button key={w} onClick={() => set({ priorityWeekdays: s.priorityWeekdays.includes(i) ? s.priorityWeekdays.filter(x => x !== i) : [...s.priorityWeekdays, i].sort() })}
                className={`px-3 py-2 rounded-full text-sm border ${s.priorityWeekdays.includes(i) ? 'border-pt-accent text-pt-accent bg-pt-accent/10' : 'border-transparent bg-pt-bg text-pt-text'}`}>{w}</button>
            ))}
          </div>
          <label className="block"><span className="block text-pt-muted text-xs mb-2">Unclaimed slots open to everyone on the Sunday before, at</span>
            <select value={s.releaseMinute} onChange={e => set({ releaseMinute: Number(e.target.value) })} className={field}>
              {HALF_HOURS.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
            </select></label>
          <p className="text-pt-muted text-xs mt-1">Priority group ({s.priority.length})</p>
          <div className="max-h-72 overflow-y-auto rounded-xl bg-pt-bg divide-y divide-white/[0.06]">
            {people.length === 0 && <p className="text-pt-muted text-sm p-3">Loading people…</p>}
            {[...people, ...outsiders.map(p => ({ ...p, role: '' }))].map(p => (
              <PickRow key={p.email} name={p.name} email={p.email} on={inGroup(p.email)} onToggle={() => toggle(p)} />
            ))}
          </div>
        </section>
      </div>

      {/* A solid bar, not a floating pill: the last card used to show through around the button. */}
      <div className="fixed left-0 right-0 bottom-[calc(58px+max(calc(env(safe-area-inset-bottom)-18px),6px))] px-4 pt-3 pb-3 z-20 bg-pt-bg border-t border-white/[0.06]">
        <button disabled={busy} onClick={save} className="w-full min-h-[52px] bg-pt-accent text-stone-900 font-semibold rounded-2xl py-3 disabled:opacity-40 shadow-gold">
          {busy ? 'Saving…' : msg || 'Save settings'}
        </button>
      </div>
    </div>
  )
}

// A person in a pick list: a round gold tick instead of a tiny native checkbox.
function PickRow({ name, email, on, onToggle }: { name: string; email: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onToggle} className="w-full flex items-center gap-3 px-3 min-h-[56px] py-2 text-left">
      <span className="flex-1 min-w-0"><span className="block text-pt-text text-[15px] truncate">{name}</span><span className="block text-pt-muted text-xs truncate">{email}</span></span>
      <span aria-hidden className={`shrink-0 w-7 h-7 rounded-full grid place-items-center text-[15px] font-bold ${on ? 'bg-pt-accent text-stone-900' : 'shadow-[inset_0_0_0_2px_rgba(255,255,255,0.18)]'}`}>{on ? '✓' : ''}</span>
    </button>
  )
}

// Shared Google Calendar: set up on ONE page now ("Calendar & email", owner Oct 28); this card just says where it stands.
const googleAccountStatus = httpsCallable<Record<string, never>, { connected: { email: string; calendar: boolean; broken: string } | null }>(functions, 'googleAccountStatus')

function CalendarSetup({ savedId, onImport, onApprove }: { savedId: string; onImport: () => void; onApprove: () => void }) {
  const [account, setAccount] = useState<string | null | undefined>(undefined)
  useEffect(() => { googleAccountStatus({}).then(r => { const c = r.data.connected; setAccount(c?.calendar && !c.broken ? c.email : null) }).catch(() => setAccount(null)) }, [])
  const linked = !!account && !!savedId
  return (
    <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-pt-text font-semibold">Shared Google Calendar</h2>
        {account !== undefined && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${linked ? 'bg-green-500/15 text-green-400' : 'bg-pt-bg text-pt-muted'}`}>{linked ? 'Linked' : 'Not set up'}</span>}
      </div>
      <p className="text-pt-muted text-xs">{linked ? `Bookings go to the calendar through ${account}.` : 'Set up the calendar and emails together, in three steps.'}</p>
      <Link to="/connections" className="block w-full text-center bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 text-sm">{linked ? 'Calendar & email ›' : 'Set it up in Calendar & email ›'}</Link>
      {linked && <>
        <button onClick={onApprove} className="w-full bg-pt-bg rounded-xl py-3 text-pt-text text-sm font-medium">What the app has added ›</button>
        <button onClick={onImport} className="w-full bg-pt-bg rounded-xl py-3 text-pt-text text-sm font-medium">Import from the calendar (new + changed) ›</button>
      </>}
    </section>
  )
}

// Hours, one at a time (owner, Nov 4: "more granular, not just 12-hour increments"): − / + move by 1 hour, the number can be
// typed, and quick picks cover the usual choices. Shows days too ("48 h · 2 days").
function HoursPicker({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  const put = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v))))
  const days = value >= 24 ? ` · ${value % 24 === 0 ? `${value / 24} day${value === 24 ? '' : 's'}` : `${Math.floor(value / 24)} d ${value % 24} h`}` : ''
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => put(value - 1)} aria-label="One hour less" className="w-11 h-11 rounded-xl bg-pt-bg text-pt-text text-xl">−</button>
        <input inputMode="numeric" value={text} aria-label={label}
          onChange={e => { const t = e.target.value.replace(/\D/g, '').slice(0, 3); setText(t); if (t !== '') put(Number(t)) }}
          onBlur={() => setText(String(value))}
          className="w-16 h-11 rounded-xl bg-pt-bg text-pt-text text-lg font-semibold tabular-nums text-center outline-none focus:shadow-[0_0_0_2px_#C9A961]" />
        <button onClick={() => put(value + 1)} aria-label="One hour more" className="w-11 h-11 rounded-xl bg-pt-bg text-pt-text text-xl">+</button>
        <span className="text-pt-muted text-sm min-w-0 flex-1">{label}<span className="text-pt-text">{days}</span></span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {[2, 6, 12, 24, 36, 48, 72].filter(h => h >= min && h <= max).map(h => (
          <button key={h} onClick={() => put(h)} className={`px-3.5 min-h-[40px] inline-flex items-center rounded-full text-sm ${value === h ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-bg text-pt-muted'}`}>{h} h</button>
        ))}
      </div>
    </div>
  )
}
