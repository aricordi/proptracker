// Check props one by one (owner, Nov 6). The crew sees ONE prop: big photo, its name, how many, which bin, the category.
// They fix what's wrong and tap Looks right (= checked), or Remove (junk), or It's a double (combine with another prop).
// Shelf order (bin by bin) so they can walk the room. The list of props is fixed when the screen opens, so nothing jumps.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useItems } from '../hooks/useItems'
import { useCategories } from '../hooks/useCategories'
import { inCleanup, matchesFilter, shelfOrder, likelyDoubles, bestToKeep, FILTER_LABELS, type CleanupFilter } from '../lib/cleanup'
import { saveChecked, removeProps, restoreProps, heldUnits, suggestPropNames, REMOVE_REASONS } from '../services/cleanup'
import { mergeProps } from '../services/importer'
import { matchesQuery } from '../lib/search'
import { CleanupHeader, BinSheet, QtyStepper, Toast, PropThumb, useBinLabel, ZoomBadge } from '../components/cleanup/Parts'
import BottomSheet from '../components/BottomSheet'
import ImageLightbox from '../components/ImageLightbox'
import { friendlyError } from '../lib/errors'
import type { Item } from '../types'

const FILTERS: CleanupFilter[] = ['todo', 'nobin', 'names', 'nophoto', 'many', 'costumes', 'imported', 'all']

export default function CleanupCheckScreen() {
  const [params, setParams] = useSearchParams()
  const f = (FILTERS as string[]).includes(params.get('f') ?? '') ? params.get('f') as CleanupFilter : 'todo'
  const bin = params.get('bin') ?? ''
  // A new list every time the filter or bin changes (key = remount).
  return <Checker key={`${f}|${bin}`} f={f} bin={bin} setFilter={(nf, nb) => setParams({ f: nf, ...(nb ? { bin: nb } : {}) }, { replace: true })} />
}

function Checker({ f, bin, setFilter }: { f: CleanupFilter; bin: string; setFilter: (f: CleanupFilter, bin?: string) => void }) {
  const navigate = useNavigate()
  const items = useItems()
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const binInfo = useBinLabel()
  const [queue, setQueue] = useState<string[] | null>(null)
  const [pos, setPos] = useState(0)
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const [filterSheet, setFilterSheet] = useState(false)
  const [doneCount, setDoneCount] = useState(0)

  // Freeze the list once the props are here (and the bins, for shelf order; a moment's grace if there are no bins).
  const [binsWait, setBinsWait] = useState(true)
  useEffect(() => { const t = setTimeout(() => setBinsWait(false), 1500); return () => clearTimeout(t) }, [])
  useEffect(() => {
    if (queue || !items.length || (binsWait && !binInfo.bins.length)) return
    const list = items.filter(i => inCleanup(i) && matchesFilter(i, f) && (!bin || i.binId === bin))
    setQueue(shelfOrder(list, binInfo.label).map(i => i.id))
  }, [items, queue, f, bin, binInfo, binsWait])

  // The current prop: skip any that were removed or combined meanwhile (by someone else, or a double just merged).
  const live = (id: string) => { const i = byId.get(id); return i && inCleanup(i) ? i : null }
  let idx = pos
  while (queue && idx < queue.length && !live(queue[idx])) idx++
  const item = queue && idx < queue.length ? live(queue[idx]) : null
  const left = queue ? queue.slice(idx).filter(id => live(id)).length : 0
  const next = () => setPos(idx + 1)

  if (!queue) return <div className="min-h-full bg-pt-bg"><CleanupHeader title="Check props" /><p className="px-4 text-pt-muted text-[16px]">Loading the props…</p></div>

  return (
    <div className="min-h-full bg-pt-bg flex flex-col">
      <CleanupHeader title="Check props" right={
        <button onClick={() => setFilterSheet(true)} className="min-h-[40px] inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-3 text-[14px] text-pt-text">
          {bin ? binInfo.label(bin) ?? 'Bin' : FILTER_LABELS[f]} ▾</button>}
        sub={queue.length ? (
          <div>
            <div className="flex justify-between text-[14px] text-pt-muted"><span>{item ? `${queue.length - left + 1} of ${queue.length}` : `${queue.length} of ${queue.length}`}</span><span>{doneCount ? `${doneCount} done now` : ''}</span></div>
            <div className="mt-1 h-2 rounded-full bg-white/[0.08] overflow-hidden"><div className="h-full bg-green-500 transition-all" style={{ width: `${Math.round(((queue.length - left) / queue.length) * 100)}%` }} /></div>
          </div>
        ) : null} />

      {item ? (
        <Card key={item.id} item={item} items={items} binInfo={binInfo}
          onDone={(text, undo) => { setDoneCount(n => n + 1); setToast(text ? { text, undo } : null); next() }}
          onSkip={next} onBack={idx > 0 ? () => setPos(Math.max(0, idx - 1)) : undefined} />
      ) : (
        <div className="px-4 py-10 text-center max-w-[520px] mx-auto">
          <p className="text-[48px]" aria-hidden>✓</p>
          <p className="text-pt-text text-[22px] font-bold">{queue.length ? 'That\'s all of them' : 'Nothing to check here'}</p>
          <p className="text-pt-muted text-[16px] mt-1">{queue.length ? `You went through ${queue.length} prop${queue.length === 1 ? '' : 's'}.` : `No props match "${bin ? binInfo.label(bin) : FILTER_LABELS[f]}".`}</p>
          <div className="mt-6 space-y-2">
            <button onClick={() => setFilterSheet(true)} className="w-full rounded-2xl min-h-[52px] bg-pt-accent text-stone-900 font-bold text-[16px]">Check another group</button>
            <button onClick={() => navigate('/cleanup')} className="w-full rounded-2xl min-h-[52px] bg-white/[0.08] text-pt-text font-semibold text-[16px]">Back to Clean up</button>
          </div>
        </div>
      )}

      {toast && <Toast text={toast.text} onUndo={toast.undo} onDone={() => setToast(null)} />}

      <BottomSheet open={filterSheet} onClose={() => setFilterSheet(false)} title="Which props?">
        <div className="space-y-1">
          {FILTERS.map(x => (
            <button key={x} onClick={() => { setFilterSheet(false); setFilter(x) }}
              className={`w-full rounded-2xl px-4 min-h-[52px] text-left text-[16px] ${x === f && !bin ? 'bg-pt-accent/15 text-pt-accent font-semibold' : 'bg-white/[0.05] text-pt-text'}`}>
              {FILTER_LABELS[x]} <span className="text-pt-muted">· {items.filter(i => inCleanup(i) && matchesFilter(i, x)).length}</span></button>
          ))}
          <p className="text-pt-muted text-[14px] px-1 pt-3">Or one bin at a time:</p>
          <div className="flex flex-wrap gap-2">
            {binInfo.bins.filter(b => items.some(i => i.binId === b.id && inCleanup(i))).slice(0, 120).map(b => (
              <button key={b.id} onClick={() => { setFilterSheet(false); setFilter('all', b.id) }}
                className={`min-h-[44px] rounded-full px-4 text-[16px] ${b.id === bin ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-white/[0.08] text-pt-text'}`}>{b.label}</button>
            ))}
          </div>
        </div>
      </BottomSheet>
    </div>
  )
}

type BinInfo = ReturnType<typeof useBinLabel>

function Card({ item, items, binInfo, onDone, onSkip, onBack }: {
  item: Item; items: Item[]; binInfo: BinInfo
  onDone: (toast: string, undo?: () => void) => void; onSkip: () => void; onBack?: () => void
}) {
  const categories = useCategories().filter(c => c.active !== false || c.id === item.categoryId)
  const [name, setName] = useState(item.name)
  const [qty, setQty] = useState(item.quantity)
  const [binId, setBinId] = useState(item.binId ?? '')
  const [locationId, setLocationId] = useState(item.locationId ?? '')
  const [categoryId, setCategoryId] = useState(item.categoryId)
  const [description, setDescription] = useState(item.description ?? '')
  const [more, setMore] = useState(false)
  const [photo, setPhoto] = useState(0)
  const [zoom, setZoom] = useState(false)
  const [binSheet, setBinSheet] = useState(false)
  const [removeSheet, setRemoveSheet] = useState(false)
  const [doubleSheet, setDoubleSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [err, setErr] = useState('')

  const changes = {
    ...(name.trim() !== item.name ? { name: name.trim() } : {}),
    ...(qty !== item.quantity ? { quantity: qty } : {}),
    ...(binId !== (item.binId ?? '') ? { binId, locationId: locationId || binInfo.locationOf(binId) } : {}),
    ...(categoryId !== item.categoryId ? { categoryId } : {}),
    ...(description.trim() !== (item.description ?? '') ? { description: description.trim() } : {}),
  }
  const dirty = Object.keys(changes).length > 0

  async function save(checked: boolean) {
    if (!name.trim()) { setErr('Give it a name first.'); return false }
    setBusy(true); setErr('')
    try {
      if (qty < item.quantity) {
        const held = await heldUnits(item.id)
        if (qty < held) { setErr(`${held} of these are booked right now, so the count can't go below ${held}.`); setBusy(false); return false }
      }
      // An empty bin is saved as "no bin" (the rules keep the field a string).
      await saveChecked(item.id, changes as Parameters<typeof saveChecked>[1], checked)
      return true
    } catch (e) { setErr(friendlyError(e)); setBusy(false); return false }
  }

  const photos = item.photos ?? []
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 px-4 space-y-4 max-w-[560px] w-full mx-auto pb-4">
        <div className="flex justify-between -my-2">
          {onBack ? <button onClick={onBack} className="tap min-h-[44px] text-pt-muted text-[16px]">‹ Previous</button> : <span />}
          <button disabled={busy} onClick={async () => { if (!dirty || await save(false)) onSkip() }} className="tap min-h-[44px] text-pt-muted text-[16px]">{dirty ? 'Save, decide later ›' : 'Skip for now ›'}</button>
        </div>
        {/* Photo: tap to zoom, arrows for the others. */}
        <div className={`relative rounded-[20px] overflow-hidden bg-black mx-auto w-full ${photos.length ? 'h-[34vh] min-h-[200px]' : 'h-20'}`}>
          {photos.length ? <button onClick={() => setZoom(true)} className="w-full h-full" aria-label="Zoom in on the photo">
            <img src={photos[photo]} alt={item.name} className="w-full h-full object-contain" /><ZoomBadge className="bottom-2 right-2 !w-8 !h-8" /></button>
            : <div className="w-full h-full grid place-items-center text-pt-muted text-[16px]">No photo</div>}
          {photos.length > 1 && <>
            <button onClick={() => setPhoto(p => (p - 1 + photos.length) % photos.length)} aria-label="Previous photo" className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 text-white text-[24px]">‹</button>
            <button onClick={() => setPhoto(p => (p + 1) % photos.length)} aria-label="Next photo" className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 text-white text-[24px]">›</button>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 text-white text-[12px] px-2 py-0.5">{photo + 1} / {photos.length}</span>
          </>}
          {item.reviewedAt && <span className="absolute top-2 left-2 rounded-full bg-green-600 text-white text-[12px] font-semibold px-2 py-1">✓ Checked before</span>}
        </div>

        <label className="block">
          <span className="flex items-center justify-between"><span className="text-pt-muted text-[14px]">Name</span>
            <button type="button" disabled={aiBusy} onClick={async () => {
              setAiBusy(true); setErr('')
              try { const r = (await suggestPropNames({ ids: [item.id] })).data; if (r.names[item.id]) setName(r.names[item.id]); else setErr(r.resting ? 'The AI is resting until the 1st (monthly budget). Type the name instead.' : 'The AI had no idea for this one. Type the name instead.') }
              catch (e) { setErr(friendlyError(e)) } finally { setAiBusy(false) }
            }} className="tap min-h-[36px] text-violet-300 text-[14px] font-semibold disabled:opacity-50">{aiBusy ? 'Thinking…' : '✦ Suggest a name'}</button></span>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={200}
            className="mt-1 w-full bg-pt-surface rounded-2xl px-4 min-h-[56px] text-[20px] font-semibold text-pt-text outline-none focus:ring-2 focus:ring-pt-accent" />
        </label>

        <div className="flex items-center justify-between rounded-2xl bg-pt-surface px-4 py-2">
          <span className="text-pt-text text-[16px] font-semibold">How many?</span>
          <QtyStepper value={qty} onChange={setQty} big />
        </div>

        <button onClick={() => setBinSheet(true)} className="w-full flex items-center justify-between rounded-2xl bg-pt-surface px-4 min-h-[60px] text-left">
          <span><span className="block text-pt-muted text-[14px]">Where is it?</span><span className={`block text-[18px] font-semibold ${binId ? 'text-pt-text' : 'text-amber-300'}`}>{binInfo.where(binId)}</span></span>
          <span className="text-pt-accent text-[16px] font-semibold">Change</span>
        </button>

        <div>
          <span className="text-pt-muted text-[14px]">Category</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {categories.map(c => (
              <button key={c.id} onClick={() => setCategoryId(c.id)}
                className={`min-h-[44px] rounded-full px-4 text-[16px] ${categoryId === c.id ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-white/[0.08] text-pt-text'}`}>{c.label}</button>
            ))}
          </div>
        </div>

        <button onClick={() => setMore(v => !v)} aria-expanded={more} className="tap text-pt-accent text-[16px] font-semibold min-h-[44px]">{more ? 'Hide description' : 'Description, size…'}</button>
        {more && (
          <label className="block">
            <span className="text-pt-muted text-[14px]">Description (what it looks like, size for costumes)</span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} maxLength={600}
              className="mt-1 w-full bg-pt-surface rounded-2xl px-4 py-3 text-[16px] text-pt-text outline-none focus:ring-2 focus:ring-pt-accent" />
          </label>
        )}

        {err && <p className="rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
      </div>

      {/* Actions stay at the bottom, right above the tab bar: one row, the gold one is the usual answer. */}
      <div className="sticky bottom-0 z-10 bg-pt-bg px-4 pt-2 pb-3 shadow-[0_-12px_16px_-8px_rgba(0,0,0,0.9)]">
        <div className="max-w-[560px] mx-auto flex gap-2">
          <button disabled={busy} onClick={() => setRemoveSheet(true)} className="flex-1 rounded-2xl min-h-[56px] bg-red-500/15 text-red-200 text-[16px] font-semibold">Remove</button>
          <button disabled={busy} onClick={() => setDoubleSheet(true)} className="flex-1 rounded-2xl min-h-[56px] bg-white/[0.08] text-pt-text text-[16px] font-semibold leading-tight">It's a double</button>
          <button disabled={busy} onClick={async () => { if (await save(true)) onDone(dirty ? 'Saved and checked ✓' : 'Checked ✓') }}
            className="flex-[1.6] rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[17px] font-bold shadow-gold disabled:opacity-40 leading-tight">
            {busy ? 'Saving…' : dirty ? 'Save ✓' : 'Looks right ✓'}</button>
        </div>
      </div>

      {zoom && photos[photo] && <ImageLightbox src={photos[photo]} alt={item.name} onClose={() => setZoom(false)} />}
      <BinSheet open={binSheet} current={binId} onClose={() => setBinSheet(false)} onPick={(b, l) => { setBinId(b); setLocationId(l) }} />
      <RemoveSheet open={removeSheet} name={item.name} onClose={() => setRemoveSheet(false)} onRemove={async reason => {
        const r = await removeProps([item.id], reason)
        if (r.booked.length) throw new Error(`"${item.name}" is in a booking right now. Remove it once it's back.`)
        setRemoveSheet(false)
        onDone(`Removed "${item.name}"`, () => { void restoreProps([item.id]) })
      }} />
      <DoubleSheet open={doubleSheet} item={item} items={items} binInfo={binInfo} onClose={() => setDoubleSheet(false)}
        onMerged={keep => { setDoubleSheet(false); onDone(`Combined into "${keep.name}"`) }} />
    </div>
  )
}

export function RemoveSheet({ open, name, count, onClose, onRemove }: { open: boolean; name?: string; count?: number; onClose: () => void; onRemove: (reason: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setErr(''); setBusy(false) } }, [open])
  const what = count && count > 1 ? `${count} props` : name ? `"${name}"` : 'this prop'
  return (
    <BottomSheet open={open} onClose={onClose} title={`Remove ${what}?`}>
      <p className="text-pt-muted text-[16px]">Why? (Nothing is deleted: it goes to Removed props, and you can put it back.)</p>
      <div className="mt-3 space-y-2">
        {REMOVE_REASONS.map(r => (
          <button key={r} disabled={busy} onClick={async () => { setBusy(true); setErr(''); try { await onRemove(r) } catch (e) { setErr(friendlyError(e)); setBusy(false) } }}
            className="w-full rounded-2xl px-4 min-h-[52px] text-left text-[16px] bg-white/[0.06] text-pt-text disabled:opacity-40">{r}</button>
        ))}
      </div>
      {err && <p className="mt-3 rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
      <button onClick={onClose} className="mt-3 w-full rounded-2xl min-h-[52px] text-pt-muted text-[16px]">Keep it</button>
    </BottomSheet>
  )
}

/** "It's a double": pick the other prop, then say whether they're copies (add up the count) or the same one twice. */
export function DoubleSheet({ open, item, items, binInfo, onClose, onMerged }: {
  open: boolean; item: Item; items: Item[]; binInfo: BinInfo; onClose: () => void; onMerged: (keep: Item) => void
}) {
  const [q, setQ] = useState('')
  const [other, setOther] = useState<Item | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setQ(''); setOther(null); setKeepCard(false); setErr(''); setBusy(false) } }, [open])
  const guesses = useMemo(() => open ? likelyDoubles(item, items) : [], [open, item, items])
  const found = q.trim().length >= 2 ? items.filter(i => i.id !== item.id && inCleanup(i) && matchesQuery(i, q, {})).slice(0, 12) : []
  const list = q.trim().length >= 2 ? found : guesses

  // Which of the two stays (owner, audit Nov 7: a booked prop on the card can only be kept, never removed). Starts on
  // the better record (checked, added by hand, real name…); "Keep this one instead" swaps.
  const [keepCard, setKeepCard] = useState(false)
  const pick = (o: Item) => { setOther(o); setKeepCard(bestToKeep([o, item]).id === item.id) }
  const keep = keepCard ? item : other
  const gone = keepCard ? other : item
  async function merge(mode: 'copies' | 'angles') {
    if (!other || !keep || !gone) return
    setBusy(true); setErr('')
    try { await mergeProps({ keepId: keep.id, removeId: gone.id, mode }); onMerged(keep) }
    catch (e) { setErr(friendlyError(e)); setBusy(false) }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={other ? 'How should they be combined?' : 'Same as which prop?'}>
      {!other ? (
        <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name"
            className="w-full bg-pt-bg rounded-2xl px-4 min-h-[52px] text-[18px] text-pt-text placeholder:text-pt-muted outline-none focus:ring-2 focus:ring-pt-accent" />
          <p className="text-pt-muted text-[14px] mt-3">{q.trim().length >= 2 ? `${found.length} found` : guesses.length ? 'Looks most like:' : 'Type its name to find it.'}</p>
          <div className="mt-2 space-y-2 max-h-[50vh] overflow-y-auto">
            {list.map(o => (
              <button key={o.id} onClick={() => pick(o)} className="w-full flex items-center gap-3 rounded-2xl bg-white/[0.05] p-2 text-left">
                <PropThumb item={o} size={64} />
                <span className="min-w-0"><span className="block text-pt-text text-[16px] font-semibold truncate">{o.name}</span>
                  <span className="block text-pt-muted text-[14px]">{binInfo.where(o.binId)} · {o.quantity} {o.quantity === 1 ? 'unit' : 'units'}</span></span>
              </button>
            ))}
          </div>
        </>
      ) : keep && gone && (
        <>
          <div className="flex items-center gap-3">
            <PropThumb item={gone} size={72} /><span className="text-pt-muted text-[24px]">→</span><PropThumb item={keep} size={72} />
            <span className="min-w-0 text-[16px] text-pt-text font-semibold">{keep.name}</span>
          </div>
          <p className="text-pt-muted text-[16px] mt-3">{keepCard ? <><b className="text-pt-text">{other.name}</b> goes away; this one stays and gets its photos.</> : <>This one goes away; <b className="text-pt-text">{other.name}</b> stays and gets its photos.</>}</p>
          <button disabled={busy} onClick={() => setKeepCard(k => !k)} className="tap mt-1 min-h-[44px] text-pt-accent text-[16px] font-semibold">
            {keepCard ? `Keep "${other.name}" instead` : 'Keep this one instead'}</button>
          <div className="mt-3 space-y-2">
            <button disabled={busy} onClick={() => merge('copies')} className="w-full rounded-2xl p-4 text-left bg-pt-accent text-stone-900 disabled:opacity-40">
              <b className="block text-[18px]">We have more than one</b>
              <span className="block text-[16px]">Add up the count: {keep.quantity} + {gone.quantity} = {keep.quantity + gone.quantity}</span></button>
            <button disabled={busy} onClick={() => merge('angles')} className="w-full rounded-2xl p-4 text-left bg-white/[0.08] text-pt-text disabled:opacity-40">
              <b className="block text-[18px]">It's the same one, photographed twice</b>
              <span className="block text-[16px] text-pt-muted">Keeps the higher count: {Math.max(keep.quantity, gone.quantity)}, and adds the photos</span></button>
          </div>
          {err && <p className="mt-3 rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
          <button onClick={() => setOther(null)} className="mt-2 w-full rounded-2xl min-h-[52px] text-pt-muted text-[16px]">‹ Pick a different one</button>
        </>
      )}
    </BottomSheet>
  )
}
