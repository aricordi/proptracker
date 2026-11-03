// Filming guideline (PDF) for a Cliff 1 Thursday or Saturday (owner, Nov 3: required unless you're in the priority group).
// Picks a PDF from the phone, uploads it to guidelines/<your email>/, and hands back {url, name}.
import { useState } from 'react'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { useSession } from '../auth'
import type { Guideline } from '../services/schedule'

export default function GuidelinePicker({ value, onChange }: { value: Guideline | null; onChange: (g: Guideline | null) => void }) {
  const { profile } = useSession()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function pick(f: File | undefined) {
    if (!f) return
    if (f.type !== 'application/pdf') { setErr('Pick a PDF file.'); return }
    if (f.size > 20 * 1024 * 1024) { setErr('That PDF is over 20 MB. Export a smaller one.'); return }
    setBusy(true); setErr('')
    try {
      const r = storageRef(storage, `guidelines/${profile.email}/${Date.now()}-${f.name.replace(/[^\w.-]+/g, '_').slice(-80)}`)
      await uploadBytes(r, f, { contentType: 'application/pdf' })
      onChange({ url: await getDownloadURL(r), name: f.name.slice(0, 120) })
    } catch { setErr('Couldn\'t upload it. Check your signal and try again.') } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl bg-amber-400/10 p-3 space-y-2">
      <p className="text-[14px] text-pt-text"><b>Filming guideline needed.</b> Cliff 1 on Thursdays and Saturdays needs your guideline (PDF).</p>
      {value ? (
        <div className="flex items-center gap-2"><span className="flex-1 min-w-0 truncate text-green-400 text-[14px]">✓ {value.name}</span>
          <button onClick={() => onChange(null)} className="text-pt-muted text-sm tap">Change</button></div>
      ) : (
        <label className={`block w-full text-center rounded-xl py-3 font-semibold ${busy ? 'bg-pt-border text-pt-muted' : 'bg-pt-border text-pt-text'}`}>
          {busy ? 'Uploading…' : 'Attach the PDF'}
          <input type="file" accept="application/pdf" className="hidden" disabled={busy} onChange={e => pick(e.target.files?.[0])} />
        </label>
      )}
      {err && <p className="text-red-300 text-sm">{err}</p>}
    </div>
  )
}
