// Owner: the creator AI helpers' monthly budget and daily limit per person, and this month's spend.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { todayInStudio } from '../../functions/src/booking'

const DEFAULTS = { monthlyCapUsd: 50, perPersonDaily: 25 }   // same as functions/src/assistant.ts

export default function AiSettingsScreen() {
  const navigate = useNavigate()
  const month = todayInStudio().slice(0, 7)
  const [settings, setSettings] = useState(DEFAULTS)
  const [usage, setUsage] = useState<{ spentUsd?: number; calls?: number; by?: Record<string, number> } | null>(null)
  const [cap, setCap] = useState(''), [daily, setDaily] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => onSnapshot(doc(db, 'app_settings', 'ai'), s => {
    const d = { ...DEFAULTS, ...(s.data() ?? {}) }
    setSettings(d); setCap(String(d.monthlyCapUsd)); setDaily(String(d.perPersonDaily))
  }, () => {}), [])
  useEffect(() => onSnapshot(doc(db, 'ai_usage', month), s => setUsage(s.data() ?? {}), () => setUsage({})), [month])
  const spent = Math.max(0, usage?.spentUsd ?? 0)
  const pct = Math.min(100, settings.monthlyCapUsd ? spent / settings.monthlyCapUsd * 100 : 100)
  const valid = Number(cap) >= 0 && Number(cap) <= 10000 && Number.isInteger(Number(daily)) && Number(daily) >= 0 && Number(daily) <= 1000 && cap !== '' && daily !== ''
  async function save() {
    setMsg('')
    try { await setDoc(doc(db, 'app_settings', 'ai'), { monthlyCapUsd: Number(cap), perPersonDaily: Number(daily), updatedAt: new Date().toISOString() }, { merge: true }); setMsg('Saved ✓') }
    catch { setMsg('Could not save. Try again.') }
  }
  const field = 'w-24 bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-pt-text text-right focus:outline-none focus:border-pt-accent'
  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-2 flex items-end gap-2">
        <button onClick={() => navigate('/admin')} className="tap w-8 -ml-2 text-pt-accent text-[34px] font-light leading-none pb-1" aria-label="Back">‹</button>
        <h1 className="font-display text-[34px] text-pt-text">AI helpers</h1>
      </div>
      <div className="px-4 pt-4 pb-8 space-y-6">
        <p className="text-pt-muted text-sm">Creators use AI to turn a video idea into props and gear, and to find filming times. Each use costs a fraction of a cent. When the budget runs out the helpers pause until the 1st; search, browse and booking always keep working.</p>
        <div className="bg-pt-surface rounded-2xl p-4 space-y-2">
          <p className="text-pt-muted text-xs">This month</p>
          <p className="text-pt-text text-3xl font-bold">${spent.toFixed(2)} <span className="text-pt-muted text-base font-normal">of ${settings.monthlyCapUsd}</span></p>
          <div className="h-2 rounded-full bg-pt-border overflow-hidden"><div className={`h-full ${pct >= 80 ? 'bg-amber-400' : 'bg-pt-accent'}`} style={{ width: `${pct}%` }} /></div>
          <p className="text-pt-muted text-sm">{usage?.calls ?? 0} uses{usage?.by ? ` · ${Object.entries(usage.by).map(([k, n]) => `${n} ${k === 'ideas' ? 'video ideas' : k === 'times' ? 'time searches' : k}`).join(' · ')}` : ''}</p>
          {pct >= 80 && <p className="text-amber-200 text-sm">Over 80% of the budget is used. Raise it below if creators need more this month.</p>}
        </div>
        <div className="bg-pt-surface rounded-2xl p-4 space-y-3">
          <label className="flex items-center justify-between gap-3"><span className="text-pt-text">Monthly budget (US$)</span><input inputMode="decimal" value={cap} onChange={e => setCap(e.target.value.replace(/[^\d.]/g, ''))} className={field} /></label>
          <label className="flex items-center justify-between gap-3"><span className="text-pt-text">Uses per person per day</span><input inputMode="numeric" value={daily} onChange={e => setDaily(e.target.value.replace(/\D/g, ''))} className={field} /></label>
          <button disabled={!valid} onClick={save} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 disabled:opacity-40 shadow-gold">Save</button>
          {msg && <p className="text-pt-muted text-sm">{msg}</p>}
        </div>
        <p className="text-pt-muted text-xs">The prop import and "Improve search words" have their own spending cap on the Import screen.</p>
      </div>
    </div>
  )
}
