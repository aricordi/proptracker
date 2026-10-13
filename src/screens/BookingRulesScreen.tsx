import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteField } from 'firebase/firestore'
import { useBookingSettings } from '../hooks/useBookings'
import { useCategories } from '../hooks/useCategories'
import { saveBookingSettings } from '../services/reservations'
import { updateCategory } from '../services/categories'
import type { Category } from '../types'

const validDays = (s: string, max: number) => /^\d+$/.test(s) && Number(s) <= max

export default function BookingRulesScreen() {
  const navigate = useNavigate()
  const settings = useBookingSettings()
  const categories = useCategories()
  const [lead, setLead] = useState(String(settings.leadTimeDays))
  const [buffer, setBuffer] = useState(String(settings.bufferDays))
  // Per-category turnaround; '' means "use the default".
  const [perCategory, setPerCategory] = useState<Record<string, string>>({})
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle')

  useEffect(() => { setLead(String(settings.leadTimeDays)); setBuffer(String(settings.bufferDays)) }, [settings])
  useEffect(() => {
    setPerCategory(Object.fromEntries(categories.map(c => [c.id, c.turnaroundDays == null ? '' : String(c.turnaroundDays)])))
  }, [categories])

  const savedFor = (c: Category) => c.turnaroundDays == null ? '' : String(c.turnaroundDays)
  const changedCategories = categories.filter(c => (perCategory[c.id] ?? '') !== savedFor(c))

  const valid = validDays(lead, 60) && validDays(buffer, 30)
    && categories.every(c => (perCategory[c.id] ?? '') === '' || validDays(perCategory[c.id], 30))
  const changed = Number(lead) !== settings.leadTimeDays || Number(buffer) !== settings.bufferDays || changedCategories.length > 0

  async function save() {
    setState('busy')
    try {
      await saveBookingSettings({ ...settings, leadTimeDays: Number(lead), bufferDays: Number(buffer) })
      await Promise.all(changedCategories.map(c => {
        const v = perCategory[c.id] ?? ''
        return updateCategory(c.id, { turnaroundDays: v === '' ? deleteField() as unknown as undefined : Number(v) })
      }))
      setState('saved')
    } catch {
      setState('error')
    }
  }

  const input = 'w-20 bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text text-lg text-center placeholder-pt-muted focus:outline-none focus:border-pt-accent'
  const touch = () => setState('idle')

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center gap-3 border-b border-pt-border">
        <button onClick={() => navigate(-1)} className="text-pt-text py-1">‹</button>
        <h1 className="font-display text-xl text-pt-text">Booking rules</h1>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-2">
          <p className="text-pt-text font-medium">Notice needed</p>
          <p className="text-pt-muted text-sm">Creators must book at least this many days before the shoot day. The arts department can always book sooner.</p>
          <div className="flex items-center gap-3">
            <input inputMode="numeric" value={lead} onChange={e => { setLead(e.target.value.replace(/\D/g, '')); touch() }} className={input} />
            <span className="text-pt-muted">days</span>
          </div>
        </div>

        <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
          <div>
            <p className="text-pt-text font-medium">Turnaround</p>
            <p className="text-pt-muted text-sm">
              Days after a shoot before the same item can go out again, for checking, cleaning or washing.
              0 means it can go out the next day. Items not yet marked returned stay unavailable regardless.
            </p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-pt-text text-sm font-medium">Default</span>
            <div className="flex items-center gap-2">
              <input inputMode="numeric" value={buffer} onChange={e => { setBuffer(e.target.value.replace(/\D/g, '')); touch() }} className={input} />
              <span className="text-pt-muted text-sm w-9">days</span>
            </div>
          </div>
          <div className="h-px bg-pt-border" />
          <p className="text-pt-muted text-xs">Give a category its own turnaround, e.g. extra days for washing costumes. Leave blank to use the default.</p>
          {categories.filter(c => c.active).map(c => (
            <div key={c.id} className="flex items-center justify-between gap-3">
              <span className="text-pt-text text-sm">{c.label}</span>
              <div className="flex items-center gap-2">
                <input inputMode="numeric" value={perCategory[c.id] ?? ''} placeholder={buffer || '0'}
                  onChange={e => { setPerCategory(p => ({ ...p, [c.id]: e.target.value.replace(/\D/g, '') })); touch() }}
                  aria-label={`${c.label} turnaround days`} className={input} />
                <span className="text-pt-muted text-sm w-9">days</span>
              </div>
            </div>
          ))}
        </div>

        {!valid && <p className="text-amber-400 text-sm">Notice can be 0–60 days; turnaround 0–30 days.</p>}
        <button onClick={save} disabled={!valid || !changed || state === 'busy'}
          className="w-full py-3.5 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">
          {state === 'busy' ? 'Saving…' : state === 'saved' && !changed ? 'Saved ✓' : 'Save'}
        </button>
        {state === 'error' && <p className="text-red-400 text-sm">Couldn't save. Try again.</p>}
        <p className="text-pt-muted text-xs">Notice applies to new bookings. Turnaround changes apply right away to what shows as free.</p>
      </div>
    </div>
  )
}
