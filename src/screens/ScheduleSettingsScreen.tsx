import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtTime } from '../../functions/src/gearBooking'
import { useScheduleSettings, saveScheduleSettings, listSchedulePeople, testCalendarLink, errorText, fmtSlot, HOUSES, type ScheduleSettings, type House } from '../services/schedule'

const field = 'w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i * 30)

// Schedule team (owner + equipment): houses, slot times, monthly slots, priority group.
export default function ScheduleSettingsScreen() {
  const navigate = useNavigate()
  const live = useScheduleSettings()
  const [s, setS] = useState<ScheduleSettings | null>(null)
  const [people, setPeople] = useState<{ email: string; name: string; role: string }[]>([])
  const [addTime, setAddTime] = useState(480)
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
  const outsiders = s.priority.filter(p => !people.some(x => x.email === p.email))

  async function save() {
    setBusy(true); setMsg('')
    try { const r = await saveScheduleSettings(s!); setS(r.data); setMsg('Saved ✓') }
    catch (e) { setMsg(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full bg-pt-bg pb-28">
      <div className="sticky top-0 bg-pt-bg/90 backdrop-blur-xl pt-safe z-10 px-4 py-2 border-b border-pt-border flex items-end gap-2">
        <button onClick={() => navigate('/schedule')} className="text-pt-accent text-[17px] pb-1">‹</button>
        <h1 className="font-display text-3xl text-pt-text">Schedule settings</h1>
      </div>
      <div className="p-4 space-y-4">
        <p className="text-pt-muted text-sm">These rules apply to everyone right away, and the How it works page updates to match.</p>

        <section className="bg-pt-surface rounded-2xl p-3.5 space-y-2.5">
          <h2 className="text-pt-text font-semibold">Houses</h2>
          {HOUSES.map(h => (
            <div key={h} className="grid grid-cols-[1fr_1.6fr] gap-2">
              <input value={s.houses[h].name} onChange={e => setHouse(h, 'name', e.target.value)} className={field} aria-label="House name" />
              <input value={s.houses[h].address} onChange={e => setHouse(h, 'address', e.target.value)} className={field} aria-label="Address" />
            </div>
          ))}
        </section>

        <section className="bg-pt-surface rounded-2xl p-3.5 space-y-2.5">
          <h2 className="text-pt-text font-semibold">Slots ({s.slotMinutes / 60} hours each)</h2>
          <div className="flex flex-wrap gap-1.5">
            {s.slots.map(t => (
              <span key={t} className="inline-flex items-center gap-1 bg-pt-bg rounded-full pl-3 pr-1 py-1 text-sm text-pt-text">
                {fmtSlot(t, s.slotMinutes)}
                <button onClick={() => set({ slots: s.slots.filter(x => x !== t) })} disabled={s.slots.length <= 1} className="w-6 h-6 rounded-full text-pt-muted" aria-label={`Remove ${fmtTime(t)}`}>×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <select value={addTime} onChange={e => setAddTime(Number(e.target.value))} className={field}>
              {HALF_HOURS.filter(t => !s.slots.includes(t)).map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
            </select>
            <button onClick={() => set({ slots: [...s.slots, addTime].sort((a, b) => a - b) })} className="shrink-0 bg-pt-border text-pt-text rounded-xl px-4">Add</button>
          </div>
          <p className="text-pt-muted text-xs">Existing bookings keep their time even if you remove a slot.</p>
        </section>

        <section className="bg-pt-surface rounded-2xl p-3.5 space-y-2.5">
          <h2 className="text-pt-text font-semibold">Monthly slots at {s.houses.cliff1.name}</h2>
          <div className="flex items-center gap-3">
            <button onClick={() => set({ monthlySlots: Math.max(0, s.monthlySlots - 1) })} className="w-10 h-10 rounded-xl bg-pt-bg text-pt-text text-xl">−</button>
            <span className="text-pt-text text-lg font-semibold tabular-nums w-8 text-center">{s.monthlySlots}</span>
            <button onClick={() => set({ monthlySlots: Math.min(31, s.monthlySlots + 1) })} className="w-10 h-10 rounded-xl bg-pt-bg text-pt-text text-xl">+</button>
            <span className="text-pt-muted text-sm">per creator, per month</span>
          </div>
        </section>

        <section className="bg-pt-surface rounded-2xl p-3.5 space-y-2.5">
          <h2 className="text-pt-text font-semibold">Shared Google Calendar</h2>
          <p className="text-pt-muted text-xs">The app copies every booking, move, cancel and blocked time to this calendar. Changes made in Google Calendar are not copied back. Find the ID in Google Calendar → the calendar's Settings → "Integrate calendar" → Calendar ID.</p>
          <input value={s.googleCalendarId} onChange={e => set({ googleCalendarId: e.target.value.trim() })} placeholder="e.g. abc123@group.calendar.google.com" className={field} />
          <CalendarTest />
          <button onClick={() => navigate('/schedule/import')} className="block text-pt-accent text-sm">Import what's already in the calendar ›</button>
        </section>

        <section className="bg-pt-surface rounded-2xl p-3.5 space-y-2.5">
          <h2 className="text-pt-text font-semibold">Moving and cancelling</h2>
          <div className="flex items-center gap-3">
            <button onClick={() => set({ noticeHours: Math.max(0, s.noticeHours - 12) })} className="w-10 h-10 rounded-xl bg-pt-bg text-pt-text text-xl">−</button>
            <span className="text-pt-text text-lg font-semibold tabular-nums w-10 text-center">{s.noticeHours}</span>
            <button onClick={() => set({ noticeHours: Math.min(336, s.noticeHours + 12) })} className="w-10 h-10 rounded-xl bg-pt-bg text-pt-text text-xl">+</button>
            <span className="text-pt-muted text-sm">hours' notice to move or cancel for free</span>
          </div>
          <p className="text-pt-muted text-xs">Closer than that, a creator can only swap with someone; cancelling counts as a no-show. Your own changes never count.</p>
        </section>

        <section className="bg-pt-surface rounded-2xl p-3.5 space-y-2.5">
          <h2 className="text-pt-text font-semibold">Priority days at {s.houses.cliff1.name}</h2>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((w, i) => (
              <button key={w} onClick={() => set({ priorityWeekdays: s.priorityWeekdays.includes(i) ? s.priorityWeekdays.filter(x => x !== i) : [...s.priorityWeekdays, i].sort() })}
                className={`px-3 py-1.5 rounded-full text-sm border ${s.priorityWeekdays.includes(i) ? 'border-pt-accent text-pt-accent bg-pt-accent/10' : 'border-transparent bg-pt-bg text-pt-text'}`}>{w}</button>
            ))}
          </div>
          <label className="block"><span className="block text-pt-muted text-xs mb-1.5">Unclaimed slots open to everyone on the Sunday before, at</span>
            <select value={s.releaseMinute} onChange={e => set({ releaseMinute: Number(e.target.value) })} className={field}>
              {HALF_HOURS.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
            </select></label>
          <p className="text-pt-muted text-xs mt-1">Priority group ({s.priority.length})</p>
          <div className="max-h-72 overflow-y-auto rounded-xl bg-pt-bg divide-y divide-pt-border">
            {people.length === 0 && <p className="text-pt-muted text-sm p-3">Loading people…</p>}
            {[...people, ...outsiders.map(p => ({ ...p, role: '' }))].map(p => (
              <label key={p.email} className="flex items-center gap-3 px-3 py-2.5">
                <input type="checkbox" checked={inGroup(p.email)} onChange={() => toggle(p)} />
                <span className="flex-1 min-w-0"><span className="block text-pt-text text-sm truncate">{p.name}</span><span className="block text-pt-muted text-xs truncate">{p.email}</span></span>
              </label>
            ))}
          </div>
        </section>
      </div>

      <div className="fixed left-0 right-0 bottom-[calc(58px+max(calc(env(safe-area-inset-bottom)-18px),6px))] px-4 pb-3 z-20">
        <button disabled={busy} onClick={save} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 shadow-lg disabled:opacity-40">
          {busy ? 'Saving…' : msg || 'Save settings'}
        </button>
      </div>
    </div>
  )
}

// Check the app can write to the shared calendar (save the ID first).
function CalendarTest() {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true); setMsg('')
    try { const r = await testCalendarLink({}); setMsg(`Connected ✓ The app writes as ${r.data.account}.`) }
    catch (e) { setMsg(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-1.5">
      <button disabled={busy} onClick={run} className="bg-pt-border text-pt-text rounded-xl px-4 py-2 text-sm disabled:opacity-40">{busy ? 'Testing…' : 'Test the connection (after saving)'}</button>
      {msg && <p className="text-pt-muted text-xs break-all">{msg}</p>}
    </div>
  )
}
