import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtTime } from '../../functions/src/gearBooking'
import { importInfo } from '../services/importer'
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
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-2 flex items-end gap-2">
        <button onClick={() => navigate('/schedule')} className="tap w-8 -ml-2 text-pt-accent text-[32px] font-light leading-none pb-1" aria-label="Back">‹</button>
        <h1 className="font-display text-[34px] text-pt-text">Schedule settings</h1>
      </div>
      <div className="px-4 pt-4 pb-8 space-y-6">
        <p className="text-pt-muted text-sm">These rules apply to everyone right away, and the How it works page updates to match.</p>

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
          <h2 className="text-pt-text font-semibold">Slots ({s.slotMinutes / 60} hours each)</h2>
          <div className="flex flex-wrap gap-2">
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

        <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
          <h2 className="text-pt-text font-semibold">Monthly slots at {s.houses.cliff1.name}</h2>
          <div className="flex items-center gap-3">
            <button onClick={() => set({ monthlySlots: Math.max(0, s.monthlySlots - 1) })} className="w-11 h-11 rounded-xl bg-pt-bg text-pt-text text-xl">−</button>
            <span className="text-pt-text text-lg font-semibold tabular-nums w-8 text-center">{s.monthlySlots}</span>
            <button onClick={() => set({ monthlySlots: Math.min(31, s.monthlySlots + 1) })} className="w-11 h-11 rounded-xl bg-pt-bg text-pt-text text-xl">+</button>
            <span className="text-pt-muted text-sm">per creator, per month</span>
          </div>
        </section>

        <section className="bg-pt-surface rounded-2xl p-4 space-y-3">
          <h2 className="text-pt-text font-semibold">House slots a day</h2>
          <div className="flex items-center gap-3">
            <button onClick={() => set({ slotsPerDay: Math.max(1, s.slotsPerDay - 1) })} className="w-11 h-11 rounded-xl bg-pt-bg text-pt-text text-xl">−</button>
            <span className="text-pt-text text-lg font-semibold tabular-nums w-8 text-center">{s.slotsPerDay}</span>
            <button onClick={() => set({ slotsPerDay: Math.min(9, s.slotsPerDay + 1) })} className="w-11 h-11 rounded-xl bg-pt-bg text-pt-text text-xl">+</button>
            <span className="text-pt-muted text-sm">per creator ({s.slotsPerDay * s.slotMinutes / 60} h), both houses</span>
          </div>
          <p className="text-pt-muted text-xs">Need more for someone? Book it for them yourself (Book for → their name). Offsite shoots don't count.</p>
        </section>

        <CalendarSetup id={s.googleCalendarId} savedId={live.googleCalendarId}
          onId={v => set({ googleCalendarId: v })} save={save} onImport={() => navigate('/schedule/import')}
          onApprove={() => navigate('/schedule/calendar')} />

        <section className="bg-pt-surface rounded-2xl p-4 space-y-2">
          <h2 className="text-pt-text font-semibold">Check-ins and strikes</h2>
          {([
            ['checkinBefore', 'minutes before the shoot, check-in opens', 0, 240, 5],
            ['explainHours', 'hours to explain a missed check-in', 0, 168, 1],
            ['strikeCount', 'strikes…', 1, 20, 1],
            ['strikeDays', '…within this many days…', 1, 365, 1],
            ['pauseDays', '…pause prop + gear bookings for this many days', 0, 365, 1],
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
          <div className="flex items-center gap-3">
            <button onClick={() => set({ noticeHours: Math.max(0, s.noticeHours - 12) })} className="w-11 h-11 rounded-xl bg-pt-bg text-pt-text text-xl">−</button>
            <span className="text-pt-text text-lg font-semibold tabular-nums w-10 text-center">{s.noticeHours}</span>
            <button onClick={() => set({ noticeHours: Math.min(336, s.noticeHours + 12) })} className="w-11 h-11 rounded-xl bg-pt-bg text-pt-text text-xl">+</button>
            <span className="text-pt-muted text-sm">hours' notice to move or cancel for free</span>
          </div>
          <p className="text-pt-muted text-xs">Closer than that, a creator can only swap with someone; cancelling counts as a no-show. Your own changes never count.</p>
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
              <label key={p.email} className="flex items-center gap-3 px-3 py-3">
                <input type="checkbox" checked={inGroup(p.email)} onChange={() => toggle(p)} />
                <span className="flex-1 min-w-0"><span className="block text-pt-text text-sm truncate">{p.name}</span><span className="block text-pt-muted text-xs truncate">{p.email}</span></span>
              </label>
            ))}
          </div>
        </section>
      </div>

      <div className="fixed left-0 right-0 bottom-[calc(58px+max(calc(env(safe-area-inset-bottom)-18px),6px))] px-4 pb-3 z-20">
        <button disabled={busy} onClick={save} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 shadow-lg disabled:opacity-40 shadow-gold">
          {busy ? 'Saving…' : msg || 'Save settings'}
        </button>
      </div>
    </div>
  )
}

// Shared Google Calendar: a numbered checklist, so setting it up needs no guessing.
// The app's address comes from the server (owner); the test also names it if sharing is missing.
const CAL_API = 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=proptracker-9732e'

function CalendarSetup({ id, savedId, onId, save, onImport, onApprove }: { id: string; savedId: string; onId: (v: string) => void; save: () => Promise<void>; onImport: () => void; onApprove: () => void }) {
  const [account, setAccount] = useState('')
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { importInfo().then(r => setAccount(r.data.serviceAccount)).catch(() => {}) }, [])
  const connected = msg?.ok === true
  async function copy() { try { await navigator.clipboard.writeText(account); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* shown on screen anyway */ } }
  async function test() {
    setBusy(true); setMsg(null)
    try {
      if (id !== savedId) await save()
      const r = await testCalendarLink({}); setAccount(r.data.account); setMsg({ ok: true, text: 'Connected ✓' })
    } catch (e) {
      const t = errorText(e)
      const acc = (e as { details?: { account?: string } }).details?.account
      if (acc) setAccount(acc)
      setMsg({ ok: false, text: /has not been used|SERVICE_DISABLED|disabled/i.test(t) ? 'Step 1 isn\'t done yet: turn on the Google Calendar API.'
        : /404|notFound|Not Found/i.test(t) ? 'That calendar ID wasn\'t found. Check step 3.'
        : /403|401|share/i.test(t) ? 'Not shared yet. Do step 2, wait a minute, then test again.' : t })
    } finally { setBusy(false) }
  }
  const step = (n: number, title: string, body: React.ReactNode) => (
    <div className="flex gap-3">
      <span className={`w-6 h-6 rounded-full grid place-items-center text-xs font-bold shrink-0 ${connected ? 'bg-green-500/20 text-green-400' : 'bg-pt-accent/20 text-pt-accent'}`}>{connected ? '✓' : n}</span>
      <div className="flex-1 min-w-0 space-y-2"><p className="text-pt-text text-[15px] font-medium">{title}</p>{body}</div>
    </div>
  )
  return (
    <section className="bg-pt-surface rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-pt-text font-semibold">📅 Shared Google Calendar</h2>
        {connected && <span className="rounded-full px-3 py-1 text-xs font-semibold bg-green-500/15 text-green-400">Connected</span>}
      </div>
      {step(1, 'Turn on the Calendar API', <a href={CAL_API} target="_blank" rel="noreferrer" className="inline-block text-pt-accent text-sm tap">Open Google Cloud → tap Enable ›</a>)}
      {step(2, 'Share the calendar with the app', <>
        <p className="text-pt-muted text-xs">Google Calendar on a computer → the calendar → ⋮ → Settings and sharing → Share with specific people → add this address → <b>"Make changes to events"</b>. (The app only ever changes events it added itself.)</p>
        {account
          ? <button onClick={copy} className="w-full text-left bg-pt-bg rounded-xl px-3 py-2 text-[13px] text-pt-text break-all">{account} <span className="text-pt-accent font-semibold">{copied ? ' Copied ✓' : ' Copy'}</span></button>
          : <p className="text-pt-muted text-xs">Tap Test below to see the address.</p>}
      </>)}
      {step(3, 'Paste the calendar ID', <>
        <p className="text-pt-muted text-xs">Same settings page → Integrate calendar → Calendar ID.</p>
        <input value={id} onChange={e => { onId(e.target.value.trim()); setMsg(null) }} placeholder="abc123@group.calendar.google.com" className={field} />
      </>)}
      {step(4, 'Test it', <>
        <button disabled={busy || !id} onClick={test} className="bg-pt-accent text-stone-900 font-semibold rounded-xl px-4 py-2 text-sm disabled:opacity-40">{busy ? 'Testing…' : 'Save & test'}</button>
        {msg && <p className={`text-sm ${msg.ok ? 'text-green-400' : 'text-amber-300'}`}>{msg.text}</p>}
      </>)}
      <p className="text-pt-muted text-xs border-t border-pt-border pt-3">From then on, every booking, move, cancel and blocked time made in the app is added to the calendar right away. The app never moves anything by itself, and events that were already in the calendar (the old ones you import) are never changed or deleted.</p>
      <button onClick={onApprove} className="w-full bg-pt-bg rounded-xl py-3 text-pt-text text-sm font-medium">What the app has added ›</button>
      <button onClick={onImport} className="w-full bg-pt-bg rounded-xl py-3 text-pt-text text-sm font-medium">Import from the calendar (new + changed) ›</button>
    </section>
  )
}

