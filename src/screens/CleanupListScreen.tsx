// Quick list (owner, Nov 6): every prop in one list for the crew. Tap a name to rename it, − / + to change how many
// (saved by themselves), tick several to move them to a bin, set a category, mark them checked, combine or remove them.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useItems } from '../hooks/useItems'
import { useCategories } from '../hooks/useCategories'
import { useTags } from '../hooks/useTags'
import { inCleanup, matchesFilter, shelfOrder, bestToKeep, FILTER_LABELS, type CleanupFilter } from '../lib/cleanup'
import { saveChecked, bulkUpdate, markChecked, moveToBin, removeProps, restoreProps, heldUnits } from '../services/cleanup'
import { mergeProps } from '../services/importer'
import { matchesQuery } from '../lib/search'
import { CleanupHeader, BinSheet, QtyStepper, Toast, PropThumb, useBinLabel } from '../components/cleanup/Parts'
import { RemoveSheet } from './CleanupCheckScreen'
import BottomSheet from '../components/BottomSheet'
import { friendlyError } from '../lib/errors'
import type { Item } from '../types'

const FILTERS: CleanupFilter[] = ['all', 'todo', 'nobin', 'names', 'nophoto', 'many', 'costumes', 'imported', 'checked']
type Sort = 'shelf' | 'az' | 'new'
const PAGE = 60

export default function CleanupListScreen() {
  const [params, setParams] = useSearchParams()
  const items = useItems()
  const tags = useTags()
  const tagById = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags])
  const categories = useCategories()
  const catLabel = (id: string) => categories.find(c => c.id === id)?.label ?? id
  const binInfo = useBinLabel()
  const f = (FILTERS as string[]).includes(params.get('f') ?? '') ? params.get('f') as CleanupFilter : 'all'
  const sort = (['shelf', 'az', 'new'] as Sort[]).includes(params.get('s') as Sort) ? params.get('s') as Sort : 'shelf'
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const [sheet, setSheet] = useState<'' | 'bin' | 'cat' | 'remove' | 'combine'>('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); n.set(k, v); setParams(n, { replace: true }); setShown(PAGE) }

  const list = useMemo(() => {
    const t = q.trim()
    const base = items.filter(i => inCleanup(i) && matchesFilter(i, f) && (!t || matchesQuery(i, t, tagById)))
    if (sort === 'az') return [...base].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
    if (sort === 'new') return [...base].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return shelfOrder(base, binInfo.label)
  }, [items, f, q, sort, tagById, binInfo])
  // Picked props that are still around (one may have been removed or combined meanwhile).
  const pickedLive = list.filter(i => picked.has(i.id))
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const clear = () => setPicked(new Set())

  async function run(what: () => Promise<string | void>, undo?: () => void) {
    setBusy(true); setErr('')
    try { const text = await what(); setSheet(''); clear(); if (text) setToast({ text, undo }) }
    catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }
  const ids = pickedLive.map(i => i.id)
  const n = ids.length

  return (
    <div className="min-h-full bg-pt-bg flex flex-col">
      <CleanupHeader title="Quick list" sub={
        <div className="space-y-2">
          <input value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} placeholder="Search names, tags, descriptions" type="search"
            className="w-full bg-pt-surface rounded-2xl px-4 min-h-[48px] text-[16px] text-pt-text placeholder:text-pt-muted outline-none focus:ring-2 focus:ring-pt-accent" />
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            {FILTERS.map(x => (
              <button key={x} onClick={() => set('f', x)} className={`shrink-0 min-h-[40px] inline-flex items-center gap-1 rounded-full px-3.5 text-[14px] ${x === f ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-white/[0.08] text-pt-text'}`}>{FILTER_LABELS[x]}</button>
            ))}
          </div>
          <div className="flex items-center justify-between text-[14px] text-pt-muted">
            <span>{list.length.toLocaleString()} prop{list.length === 1 ? '' : 's'}</span>
            <label className="inline-flex items-center gap-1">Order
              <select value={sort} onChange={e => set('s', e.target.value)} className="bg-pt-surface rounded-xl px-2 min-h-[40px] text-pt-text text-[14px]">
                <option value="shelf">Bin by bin</option><option value="az">A to Z</option><option value="new">Newest first</option>
              </select></label>
          </div>
        </div>
      } />

      <div className="flex-1 px-4 max-w-[720px] w-full mx-auto">
        {list.length > 0 && (
          <div className="flex justify-between items-center py-1">
            <span className="text-pt-muted text-[14px]">Tap a name to rename · tick to pick several</span>
            <button onClick={() => setPicked(n === list.length ? new Set() : new Set(list.map(i => i.id)))} className="tap min-h-[44px] text-pt-accent text-[14px] font-semibold">{n === list.length ? 'Unpick all' : `Pick all ${list.length}`}</button>
          </div>
        )}
        <ul className="rounded-[20px] bg-pt-surface divide-y divide-white/[0.06] overflow-hidden">
          {list.slice(0, shown).map(i => (
            <ListRow key={i.id} item={i} picked={picked.has(i.id)} onPick={() => toggle(i.id)} where={binInfo.label(i.binId)} cat={catLabel(i.categoryId)}
              onSaved={text => setToast({ text })} onError={setErr} />
          ))}
          {!list.length && <li className="px-4 py-8 text-center text-pt-muted text-[16px]">Nothing here{q ? ` for "${q}"` : ''}.</li>}
        </ul>
        {list.length > shown && <button onClick={() => setShown(s => s + PAGE)} className="mt-3 w-full rounded-2xl min-h-[52px] bg-white/[0.08] text-pt-text text-[16px] font-semibold">Show {Math.min(PAGE, list.length - shown)} more</button>}
        {err && <p className="mt-3 rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
        <div className="h-4" />
      </div>

      {/* What to do with the picked ones. */}
      {n > 0 && (
        <div className="sticky bottom-0 z-10 bg-pt-bg px-4 pt-2 pb-3">
          <div className="max-w-[720px] mx-auto rounded-[20px] bg-pt-raised p-3 shadow-float">
            <div className="flex items-center justify-between mb-2">
              <b className="text-pt-text text-[16px]">{n} picked</b>
              <button onClick={clear} className="tap min-h-[40px] text-pt-muted text-[14px]">Unpick</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Action label="Move to bin" onClick={() => setSheet('bin')} />
              <Action label="Category" onClick={() => setSheet('cat')} />
              <Action label="Mark checked" onClick={() => run(async () => { await markChecked(ids); return `${n} checked ✓` })} disabled={busy} />
              <Action label="Combine" onClick={() => setSheet('combine')} disabled={n < 2 || n > 20} />
              <Action label="Remove" danger onClick={() => setSheet('remove')} />
            </div>
          </div>
        </div>
      )}

      {toast && <Toast text={toast.text} onUndo={toast.undo} onDone={() => setToast(null)} />}
      <BinSheet open={sheet === 'bin'} onClose={() => setSheet('')} onPick={(b, l) => run(async () => { await moveToBin(ids, b, l); return `${n} moved to ${b ? binInfo.label(b) : 'no bin'} ✓` })} />
      <BottomSheet open={sheet === 'cat'} onClose={() => setSheet('')} title={`Category for ${n} prop${n === 1 ? '' : 's'}`}>
        <div className="space-y-2">
          {categories.filter(c => c.active !== false).map(c => (
            <button key={c.id} disabled={busy} onClick={() => run(async () => { await bulkUpdate(ids, { categoryId: c.id }); return `${n} set to ${c.label} ✓` })}
              className="w-full rounded-2xl px-4 min-h-[52px] text-left text-[16px] bg-white/[0.06] text-pt-text">{c.label}</button>
          ))}
        </div>
      </BottomSheet>
      <RemoveSheet open={sheet === 'remove'} count={n} name={pickedLive[0]?.name} onClose={() => setSheet('')} onRemove={async reason => {
        const r = await removeProps(ids, reason)
        setSheet(''); clear()
        if (r.booked.length) setErr(`${r.booked.length} ${r.booked.length === 1 ? 'is' : 'are'} in a booking right now and stayed. Remove ${r.booked.length === 1 ? 'it' : 'them'} once back.`)
        if (r.removed.length) setToast({ text: `Removed ${r.removed.length}`, undo: () => { void restoreProps(r.removed) } })
      }} />
      {sheet === 'combine' && <CombineSheet props={pickedLive} where={binInfo.where} onClose={() => setSheet('')}
        onDone={(keep, count) => { setSheet(''); clear(); setToast({ text: `Combined ${count} into "${keep.name}" ✓` }) }} />}
    </div>
  )
}

function Action({ label, onClick, disabled, danger }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return <button onClick={onClick} disabled={disabled}
    className={`rounded-2xl min-h-[48px] px-2 text-[14px] font-semibold disabled:opacity-30 ${danger ? 'bg-red-500/15 text-red-200' : 'bg-white/[0.08] text-pt-text'}`}>{label}</button>
}

function ListRow({ item, picked, onPick, where, cat, onSaved, onError }: {
  item: Item; picked: boolean; onPick: () => void; where?: string; cat: string; onSaved: (t: string) => void; onError: (e: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [qty, setQty] = useState(item.quantity)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => { if (!editing) setName(item.name) }, [item.name, editing])
  useEffect(() => setQty(item.quantity), [item.quantity])
  async function saveName() {
    setEditing(false)
    const v = name.trim()
    if (!v || v === item.name) { setName(item.name); return }
    try { await saveChecked(item.id, { name: v }, false); onSaved('Name saved ✓') } catch (e) { onError(friendlyError(e)); setName(item.name) }
  }
  // Counts save a moment after the last tap (so tapping + five times is one save).
  function changeQty(nq: number) {
    setQty(nq)
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      if (nq === item.quantity) return
      try {
        if (nq < item.quantity) { const held = await heldUnits(item.id); if (nq < held) { setQty(item.quantity); onError(`${held} of "${item.name}" are booked right now, so it can't go below ${held}.`); return } }
        await saveChecked(item.id, { quantity: nq }, false); onSaved(`"${item.name}": ${nq} ✓`)
      } catch (e) { setQty(item.quantity); onError(friendlyError(e)) }
    }, 700)
  }
  return (
    <li className={`flex items-center gap-2 px-2 py-2 ${picked ? 'bg-pt-accent/10' : ''}`}>
      <button onClick={onPick} aria-pressed={picked} aria-label={picked ? 'Unpick' : 'Pick'} className="w-11 h-11 grid place-items-center shrink-0">
        <span className={`w-6 h-6 rounded-md grid place-items-center text-[14px] font-bold ${picked ? 'bg-pt-accent text-stone-900' : 'border-2 border-white/30'}`}>{picked ? '✓' : ''}</span>
      </button>
      <PropThumb item={item} size={64} className="self-start mt-1" />
      <div className="flex-1 min-w-0">
        {editing ? (
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={saveName} maxLength={200}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(item.name); setEditing(false) } }}
            className="w-full bg-pt-bg rounded-xl px-3 min-h-[44px] text-[16px] text-pt-text outline-none focus:ring-2 focus:ring-pt-accent" />
        ) : (
          <button onClick={() => setEditing(true)} className="block w-full text-left min-h-[32px] text-pt-text text-[16px] font-semibold leading-snug line-clamp-2">{item.name}</button>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 text-pt-muted text-[12px] truncate">{where ?? <span className="text-amber-300">No bin</span>} · {cat}{item.reviewedAt ? <span className="text-green-400"> · ✓</span> : ''}</span>
          <QtyStepper value={qty} onChange={changeQty} />
        </div>
      </div>
    </li>
  )
}

function CombineSheet({ props, where, onClose, onDone }: { props: Item[]; where: (id?: string) => string; onClose: () => void; onDone: (keep: Item, count: number) => void }) {
  const [keepId, setKeepId] = useState(() => bestToKeep(props).id)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const keep = props.find(p => p.id === keepId) ?? props[0]
  const others = props.filter(p => p.id !== keep.id)
  const total = props.reduce((n, p) => n + p.quantity, 0)
  async function go(mode: 'copies' | 'angles') {
    setBusy(true); setErr('')
    let done = 0
    try {
      for (const o of others) { await mergeProps({ keepId: keep.id, removeId: o.id, mode }); done++ }
      onDone(keep, props.length)
    } catch (e) { setErr(`${done ? `${done} combined, then: ` : ''}${friendlyError(e)}`); setBusy(false) }
  }
  return (
    <BottomSheet open onClose={onClose} title={`Combine ${props.length} into one prop`}>
      <p className="text-pt-muted text-[16px]">Tap the one to keep (it gets everyone's photos):</p>
      <div className="mt-2 space-y-2 max-h-[40vh] overflow-y-auto">
        {props.map(p => (
          <button key={p.id} onClick={() => setKeepId(p.id)} className={`w-full flex items-center gap-3 rounded-2xl p-2 text-left ${p.id === keep.id ? 'bg-pt-accent/15 ring-2 ring-pt-accent' : 'bg-white/[0.05]'}`}>
            <PropThumb item={p} size={56} />
            <span className="flex-1 min-w-0"><span className="block text-pt-text text-[16px] font-semibold truncate">{p.name}</span>
              <span className="block text-pt-muted text-[14px]">{where(p.binId)} · {p.quantity}</span></span>
            {p.id === keep.id && <span className="text-pt-accent font-bold text-[14px] pr-2">Keep</span>}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <button disabled={busy} onClick={() => go('copies')} className="w-full rounded-2xl p-4 text-left bg-pt-accent text-stone-900 disabled:opacity-40">
          <b className="block text-[18px]">We have more than one</b><span className="block text-[16px]">Add up the counts: {total} in total</span></button>
        <button disabled={busy} onClick={() => go('angles')} className="w-full rounded-2xl p-4 text-left bg-white/[0.08] text-pt-text disabled:opacity-40">
          <b className="block text-[18px]">It's the same one, photographed more than once</b><span className="block text-[16px] text-pt-muted">Keep the count at {keep.quantity}, just add the photos</span></button>
      </div>
      {busy && <p className="mt-2 text-pt-muted text-[14px]">Combining…</p>}
      {err && <p className="mt-3 rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
    </BottomSheet>
  )
}
