import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBookingSettings } from '../hooks/useBookings'
import { saveBookingSettings } from '../services/reservations'

export default function BookingRulesScreen() {
  const navigate = useNavigate()
  const settings = useBookingSettings()
  const [lead, setLead] = useState(String(settings.leadTimeDays))
  const [buffer, setBuffer] = useState(String(settings.bufferDays))
  const [maxDays, setMaxDays] = useState(String(settings.maxDays))
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle')

  useEffect(() => {
    setLead(String(settings.leadTimeDays)); setBuffer(String(settings.bufferDays)); setMaxDays(String(settings.maxDays))
  }, [settings])

  const leadN = Number(lead), bufferN = Number(buffer), maxN = Number(maxDays)
  const valid = Number.isInteger(leadN) && leadN >= 0 && leadN <= 60 && Number.isInteger(bufferN) && bufferN >= 0 && bufferN <= 30
    && Number.isInteger(maxN) && maxN >= 1 && maxN <= 60
  const changed = leadN !== settings.leadTimeDays || bufferN !== settings.bufferDays || maxN !== settings.maxDays

  async function save() {
    setState('busy')
    try { await saveBookingSettings({ leadTimeDays: leadN, bufferDays: bufferN, maxDays: maxN }); setState('saved') }
    catch { setState('error') }
  }

  const input = 'w-24 bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text text-lg text-center focus:outline-none focus:border-pt-accent'

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3 border-b border-pt-border">
        <button onClick={() => navigate(-1)} className="text-pt-text py-1">‹</button>
        <h1 className="font-display text-xl text-pt-text">Booking rules</h1>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-2">
          <p className="text-pt-text font-medium">Notice needed</p>
          <p className="text-pt-muted text-sm">Creators must book at least this many days before the first shoot day. The arts department can always book sooner.</p>
          <div className="flex items-center gap-3">
            <input inputMode="numeric" value={lead} onChange={e => { setLead(e.target.value.replace(/\D/g, '')); setState('idle') }} className={input} />
            <span className="text-pt-muted">days</span>
          </div>
        </div>
        <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-2">
          <p className="text-pt-text font-medium">Turnaround</p>
          <p className="text-pt-muted text-sm">
            Days after a shoot before the same prop can go out again (for checking, cleaning, repacking).
            Props that haven't been marked returned stay unavailable regardless.
          </p>
          <div className="flex items-center gap-3">
            <input inputMode="numeric" value={buffer} onChange={e => { setBuffer(e.target.value.replace(/\D/g, '')); setState('idle') }} className={input} />
            <span className="text-pt-muted">days</span>
          </div>
        </div>
        <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-2">
          <p className="text-pt-text font-medium">Longest booking</p>
          <p className="text-pt-muted text-sm">
            The most days a creator can book props for. 1 means single-day shoots only, and creators pick one shoot day.
            The arts department can book longer when needed.
          </p>
          <div className="flex items-center gap-3">
            <input inputMode="numeric" value={maxDays} onChange={e => { setMaxDays(e.target.value.replace(/\D/g, '')); setState('idle') }} className={input} />
            <span className="text-pt-muted">day{maxN === 1 ? '' : 's'}</span>
          </div>
        </div>
        {!valid && <p className="text-amber-400 text-sm">Notice can be 0–60 days, turnaround 0–30 days, longest booking 1–60 days.</p>}
        <button onClick={save} disabled={!valid || !changed || state === 'busy'}
          className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
          {state === 'busy' ? 'Saving…' : state === 'saved' && !changed ? 'Saved ✓' : 'Save'}
        </button>
        {state === 'error' && <p className="text-red-400 text-sm">Couldn't save. Try again.</p>}
        <p className="text-pt-muted text-xs">Notice applies to new bookings. A turnaround change applies right away to what shows as free.</p>
      </div>
    </div>
  )
}
