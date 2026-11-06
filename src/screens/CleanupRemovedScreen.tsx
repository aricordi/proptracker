// Removed props (owner, Nov 6): everything the crew removed in the clean-up, newest first, with Put back.
// Nothing is ever deleted from here; it's the safety net that makes "Remove" safe to tap.
import { useMemo, useState } from 'react'
import { useItems } from '../hooks/useItems'
import { isRemoved } from '../lib/cleanup'
import { restoreProps } from '../services/cleanup'
import { CleanupHeader, PropThumb, Toast } from '../components/cleanup/Parts'
import { friendlyError } from '../lib/errors'

export default function CleanupRemovedScreen() {
  const items = useItems()
  const list = useMemo(() => items.filter(isRemoved).sort((a, b) => (b.removedAt ?? '').localeCompare(a.removedAt ?? '')), [items])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [err, setErr] = useState('')
  const shown = q.trim() ? list.filter(i => i.name.toLowerCase().includes(q.trim().toLowerCase())) : list
  async function putBack(id: string, name: string) {
    setBusy(id); setErr('')
    try { await restoreProps([id]); setToast(`"${name}" is back ✓`) } catch (e) { setErr(friendlyError(e)) } finally { setBusy('') }
  }
  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <CleanupHeader title="Removed props" />
      <div className="px-4 max-w-[640px] mx-auto space-y-3">
        <p className="text-pt-muted text-[16px]">Removed in the clean-up. Creators can't see them. Tap <b className="text-pt-text">Put back</b> if one was removed by mistake.</p>
        {list.length > 8 && <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" type="search"
          className="w-full bg-pt-surface rounded-2xl px-4 min-h-[48px] text-[16px] text-pt-text placeholder:text-pt-muted outline-none focus:ring-2 focus:ring-pt-accent" />}
        {err && <p className="rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
        <ul className="rounded-[20px] bg-pt-surface divide-y divide-white/[0.06] overflow-hidden">
          {shown.map(i => (
            <li key={i.id} className="flex items-center gap-3 p-2">
              <PropThumb item={i} size={56} />
              <div className="flex-1 min-w-0">
                <p className="text-pt-text text-[16px] font-semibold truncate">{i.name}</p>
                <p className="text-pt-muted text-[14px] truncate">{i.removedNote || 'Removed'} · {(i.removedBy ?? '').split('@')[0]} · {new Date(i.removedAt!).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</p>
              </div>
              <button disabled={busy === i.id} onClick={() => putBack(i.id, i.name)} className="shrink-0 rounded-full min-h-[44px] px-4 bg-white/[0.08] text-pt-accent text-[16px] font-semibold disabled:opacity-40">{busy === i.id ? '…' : 'Put back'}</button>
            </li>
          ))}
          {!shown.length && <li className="px-4 py-8 text-center text-pt-muted text-[16px]">{list.length ? 'No match.' : 'Nothing removed yet.'}</li>}
        </ul>
      </div>
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  )
}
