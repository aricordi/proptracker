// Work by bin (owner, Nov 6: "make it easy for them to approve or clean up the bins"). Two screens:
//   /cleanup/bins      every bin with how many props and how many are checked, the next one to do first
//   /cleanup/bin/:id   ONE bin: all its props on one screen. Tap one to fix it; "Everything here looks right" checks the rest
//                      in one tap. Same-name doubles inside the bin are shown at the top to combine. 'none' = props with no bin.
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useItems } from '../hooks/useItems'
import { useLocations } from '../hooks/useLocations'
import { inCleanup, shelfOrder, sameNameSameBin, oddName, binGuesses } from '../lib/cleanup'
import { lookAlikeBins } from '../../functions/src/binNames'
import { markChecked } from '../services/cleanup'
import { CleanupHeader, Toast, useBinLabel, ZoomButton } from '../components/cleanup/Parts'
import QuickEdit from '../components/cleanup/QuickEdit'
import { CombineSheet } from './CleanupListScreen'
import { friendlyError } from '../lib/errors'
import { thumbOf } from '../services/itemShape'
import type { Item } from '../types'

export function CleanupBinsScreen() {
  const navigate = useNavigate()
  const items = useItems()
  const { bins } = useBinLabel()
  const locations = useLocations()
  const area = new Map(locations.map(l => [l.id, l.name]))
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const live = items.filter(inCleanup)
    const per = new Map<string, { total: number; checked: number }>()
    for (const i of live) { const k = i.binId || 'none'; const r = per.get(k) ?? { total: 0, checked: 0 }; r.total++; if (i.reviewedAt) r.checked++; per.set(k, r) }
    return { per, none: per.get('none') ?? { total: 0, checked: 0 } }
  }, [items])
  const withProps = bins.filter(b => (rows.per.get(b.id)?.total ?? 0) > 0)
  const next = withProps.find(b => { const r = rows.per.get(b.id)!; return r.checked < r.total })
  const guesses = useMemo(() => [...binGuesses(items, bins).values()].reduce((n, l) => n + l.length, 0), [items, bins])
  const twins = useMemo(() => lookAlikeBins(bins).length, [bins])
  const t = q.trim().toLowerCase().replace(/^bin\s*/, '')
  const shown = withProps.filter(b => !t || b.label.toLowerCase().includes(t) || (area.get(b.locationId) ?? '').toLowerCase().includes(t))
  const done = withProps.filter(b => { const r = rows.per.get(b.id)!; return r.checked === r.total }).length

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <CleanupHeader title="Work by bin" />
      <div className="px-4 max-w-[640px] mx-auto space-y-4">
        <p className="text-pt-muted text-[16px]">Stand at a bin, open it here, and check everything in it at once. {done} of {withProps.length} bins done.</p>
        {next && (
          <button onClick={() => navigate(`/cleanup/bin/${next.id}`)} className="w-full text-left rounded-[24px] bg-pt-accent text-stone-900 p-4 shadow-gold">
            <span className="block text-[14px] font-semibold opacity-80">Next bin</span>
            <span className="block text-[24px] font-bold">{next.label}</span>
            <span className="block text-[16px]">{area.get(next.locationId) ?? ''} · {rows.per.get(next.id)!.total - rows.per.get(next.id)!.checked} to check</span>
          </button>
        )}
        {guesses > 0 && <button onClick={() => navigate('/cleanup/place')} className="w-full text-left rounded-[20px] bg-sky-400/10 p-4">
          <span className="block text-pt-text text-[16px] font-semibold">The app can put {guesses} prop{guesses === 1 ? '' : 's'} in their bin</span>
          <span className="block text-pt-muted text-[14px]">They have no bin, but their photo folder is named like one ›</span></button>}
        {twins > 0 && <button onClick={() => navigate('/bins')} className="w-full text-left rounded-[20px] bg-amber-400/10 p-4">
          <span className="block text-pt-text text-[16px] font-semibold">{twins} bin name{twins === 1 ? '' : 's'} written two ways</span>
          <span className="block text-pt-muted text-[14px]">Like "B.31" and "B31": merge them on Bins &amp; storage ›</span></button>}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a bin" type="search"
          className="w-full bg-pt-surface rounded-2xl px-4 min-h-[48px] text-[16px] text-pt-text placeholder:text-pt-muted outline-none focus:ring-2 focus:ring-pt-accent" />
        <ul className="rounded-[20px] bg-pt-surface divide-y divide-white/[0.06] overflow-hidden">
          {rows.none.total > 0 && !t && <BinRow label="No bin yet" sub="Props that still need a bin" total={rows.none.total} checked={rows.none.checked} warn onClick={() => navigate('/cleanup/bin/none')} />}
          {shown.map(b => { const r = rows.per.get(b.id)!; return <BinRow key={b.id} label={b.label} sub={area.get(b.locationId) ?? ''} total={r.total} checked={r.checked} onClick={() => navigate(`/cleanup/bin/${b.id}`)} /> })}
        </ul>
      </div>
    </div>
  )
}

function BinRow({ label, sub, total, checked, warn, onClick }: { label: string; sub: string; total: number; checked: number; warn?: boolean; onClick: () => void }) {
  const all = checked === total
  return (
    <li><button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 min-h-[64px] text-left active:bg-white/[0.04]">
      <span className="flex-1 min-w-0">
        <span className={`block text-[17px] font-semibold ${warn ? 'text-amber-300' : 'text-pt-text'}`}>{label}</span>
        <span className="block text-pt-muted text-[14px] truncate">{sub}{sub ? ' · ' : ''}{total} prop{total === 1 ? '' : 's'}</span>
        <span className="mt-1.5 block h-1.5 rounded-full bg-white/[0.08] overflow-hidden"><span className="block h-full bg-green-500" style={{ width: `${Math.round((checked / total) * 100)}%` }} /></span>
      </span>
      <span className={`text-[14px] font-semibold ${all ? 'text-green-400' : 'text-pt-muted'}`}>{all ? '✓ Done' : `${checked}/${total}`}</span>
      <span className="text-pt-muted text-[20px]">›</span>
    </button></li>
  )
}

export function CleanupBinScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const items = useItems()
  const binInfo = useBinLabel()
  const none = id === 'none'
  const props = useMemo(() => shelfOrder(items.filter(i => inCleanup(i) && (none ? !i.binId : i.binId === id)), binInfo.label), [items, id, none, binInfo])
  const twins = useMemo(() => sameNameSameBin(props), [props])
  const [editing, setEditing] = useState<Item | null>(null)
  const [combine, setCombine] = useState<Item[] | null>(null)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const todo = props.filter(p => !p.reviewedAt)
  // An odd name ("IMG_2034") is never approved in bulk: it needs a real name first.
  const ready = todo.filter(p => !oddName(p.name))
  const needName = todo.length - ready.length
  const label = none ? 'No bin yet' : binInfo.label(id) ?? 'Bin'
  // The next bin in number order that still has props to check.
  const nextBin = useMemo(() => {
    if (none) return null
    const order = binInfo.bins.map(b => b.id)
    const after = order.slice(order.indexOf(id) + 1)
    return after.find(b => items.some(i => inCleanup(i) && i.binId === b && !i.reviewedAt)) ?? null
  }, [binInfo, id, items, none])

  async function approveAll() {
    setBusy(true); setErr('')
    try { const ids = ready.map(p => p.id); await markChecked(ids); setToast({ text: `${ids.length} checked ✓` }) } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full bg-pt-bg flex flex-col">
      <CleanupHeader title={label} back="/cleanup/bins" sub={<p className="text-pt-muted text-[14px]">{props.length} prop{props.length === 1 ? '' : 's'} · {props.length - todo.length} checked{none ? '' : ` · ${binInfo.where(id).split(' · ')[1] ?? ''}`}</p>} />
      <div className="flex-1 px-4 max-w-[720px] w-full mx-auto space-y-3 pb-4">
        <p className="text-pt-muted text-[16px]">{none ? 'Tap a prop to give it a bin.' : 'Look at the shelf. Tap any prop that\'s wrong (name, count, not here, junk) to fix it. When the rest is right, tap the gold button.'}</p>
        {twins.map(g => (
          <button key={g.map(i => i.id).join()} onClick={() => setCombine(g)} className="w-full text-left rounded-[20px] bg-amber-400/10 p-3">
            <span className="block text-pt-text text-[16px] font-semibold">"{g[0].name}" is here {g.length} times</span>
            <span className="block text-pt-muted text-[14px]">Tap to make it one prop</span>
          </button>
        ))}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {props.map(p => (
            <div key={p.id} className="relative rounded-2xl overflow-hidden bg-pt-surface">
              <button onClick={() => setEditing(p)} className="block w-full text-left" aria-label={`Fix ${p.name}`}>
                <div className="aspect-square bg-black">{p.photos[0] ? <img src={thumbOf(p, p.photos[0])} alt="" className="w-full h-full object-cover" loading="lazy" /> : <span className="grid place-items-center h-full text-pt-muted text-sm">No photo</span>}</div>
                <span className="absolute top-2 right-2 rounded-full bg-black/70 text-white text-[14px] font-bold px-2 py-0.5">×{p.quantity}</span>
                {p.reviewedAt && <span className="absolute top-2 left-2 rounded-full bg-green-600 text-white text-[12px] font-semibold px-2 py-0.5">✓</span>}
                <span className={`block px-2 py-2 text-[14px] font-semibold leading-tight line-clamp-2 ${oddName(p.name) ? 'text-amber-300' : 'text-pt-text'}`}>{p.name}</span>
              </button>
              {p.photos[0] && <div className="absolute inset-x-0 top-0 aspect-square pointer-events-none"><div className="pointer-events-auto"><ZoomButton src={p.photos[0]} alt={p.name} /></div></div>}
            </div>
          ))}
        </div>
        {!props.length && <div className="rounded-[20px] bg-pt-surface p-6 text-center"><p className="text-pt-text text-[18px] font-semibold">Nothing in here</p></div>}
        {err && <p className="rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
      </div>
      <div className="sticky bottom-0 z-10 bg-pt-bg px-4 pt-2 pb-3 shadow-[0_-12px_16px_-8px_rgba(0,0,0,0.9)]">
        <div className="max-w-[720px] mx-auto">
          {needName > 0 && !none && <p className="text-amber-300 text-[14px] text-center mb-2">{needName} need{needName === 1 ? 's' : ''} a real name first: tap the yellow name{needName === 1 ? '' : 's'}.</p>}
          {ready.length > 0 && !none ? (
            <button disabled={busy} onClick={approveAll} className="w-full rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[18px] font-bold shadow-gold disabled:opacity-40">
              {busy ? 'Saving…' : `${needName ? 'The rest looks right' : 'Everything here looks right'} ✓ (${ready.length})`}</button>
          ) : !none && !needName ? (
            <button onClick={() => navigate(nextBin ? `/cleanup/bin/${nextBin}` : '/cleanup/bins')} className="w-full rounded-2xl min-h-[56px] bg-green-600 text-white text-[18px] font-bold">
              {nextBin ? `Bin done ✓ · Next: ${binInfo.label(nextBin)}` : 'Bin done ✓ · Back to bins'}</button>
          ) : null}
        </div>
      </div>
      {editing && <QuickEdit item={editing} items={items} onClose={() => setEditing(null)} onDone={(text, undo) => { setEditing(null); setToast({ text, undo }) }} />}
      {combine && <CombineSheet props={combine} where={binInfo.where} onClose={() => setCombine(null)} onDone={(keep, n) => { setCombine(null); setToast({ text: `Combined ${n} into "${keep.name}" ✓` }) }} />}
      {toast && <Toast text={toast.text} onUndo={toast.undo} onDone={() => setToast(null)} />}
    </div>
  )
}
