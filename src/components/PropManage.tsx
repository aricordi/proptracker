// The prop page's ⋯ menu for the arts department and the owner (owner, Nov 7: "cleanup will be happening as they go…
// you often don't notice a duplicate until you're looking at it"). Everything the clean-up tools do, for THIS prop:
// edit, find its duplicates (every clue the app has: same photo file, fingerprint, name, bin, the AI's opinion),
// merge it with another prop, mark it checked, remove it (recoverable) or, for imported never-booked props, delete it.
// Nothing is combined or removed without a person tapping a clear "Yes" step.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BottomSheet from './BottomSheet'
import { Icon, type IconName } from './Icon'
import { PropThumb, useBinLabel } from './cleanup/Parts'
import { RemoveSheet } from '../screens/CleanupCheckScreen'
import { useItems } from '../hooks/useItems'
import { useTags } from '../hooks/useTags'
import { matchesQuery } from '../lib/search'
import { likelyDoubles, inCleanup } from '../lib/cleanup'
import { markChecked, removeProps, restoreProps, cachedDoubles, setCachedPairs } from '../services/cleanup'
import { mergeProps, deleteImportedProp } from '../services/importer'
import { dismissDuplicatePairs } from '../services/health'
import { doublesOf, type DoublesOf } from '../services/propsLike'
import { pairKeyOf, reasonsOf, afterMerge, type Signals, type Tier } from '../../functions/src/doubles'
import { friendlyError } from '../lib/errors'
import type { Item } from '../types'

type Sheet = '' | 'menu' | 'find' | 'merge' | 'remove' | 'delete'
/** What happened: a message (with Undo when it can be undone), then the page reloads the prop, opens the kept one, or leaves. */
export interface ManageDone { text: string; undo?: () => void; goTo?: string; gone?: boolean }

const TIER_LABEL: Record<Tier | 'near' | 'name', string> = { sure: 'Same picture', likely: 'Very likely', maybe: 'Maybe', near: 'Looks a bit alike', name: 'Similar name' }
const TIER_TONE: Record<Tier | 'near' | 'name', string> = { sure: 'bg-green-600 text-white', likely: 'bg-pt-accent text-stone-900', maybe: 'bg-white/[0.12] text-pt-text', near: 'bg-white/[0.08] text-pt-muted', name: 'bg-white/[0.08] text-pt-muted' }

/** The round ⋯ button in the prop page's header, and everything behind it. */
export default function PropManage({ item, onDone }: { item: Item; onDone: (d: ManageDone) => void }) {
  const navigate = useNavigate()
  const [sheet, setSheet] = useState<Sheet>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const company = item.collection === 'company'
  const checked = !!item.reviewedAt

  const row = (icon: IconName, title: string, sub: string, onClick: () => void, tone: 'gold' | 'plain' | 'red' = 'plain') => (
    <button onClick={onClick} disabled={busy} className="w-full flex items-center gap-3 rounded-2xl bg-white/[0.05] px-3 min-h-[64px] text-left disabled:opacity-40">
      <span className={`w-10 h-10 rounded-full grid place-items-center shrink-0 ${tone === 'red' ? 'bg-red-500/15 text-red-300' : tone === 'gold' ? 'bg-pt-accent/15 text-pt-accent' : 'bg-white/[0.08] text-pt-text'}`}><Icon name={icon} className="w-5 h-5" /></span>
      <span className="min-w-0 py-2">
        <span className={`block text-[16px] font-semibold ${tone === 'red' ? 'text-red-300' : 'text-pt-text'}`}>{title}</span>
        <span className="block text-[14px] text-pt-muted">{sub}</span>
      </span>
    </button>
  )

  async function check() {
    setBusy(true); setErr('')
    try { await markChecked([item.id]); setSheet(''); onDone({ text: 'Checked ✓' }) }
    catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }
  async function putBack() {
    setBusy(true); setErr('')
    try { await restoreProps([item.id]); setSheet(''); onDone({ text: 'Put back ✓' }) }
    catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={() => { setErr(''); setSheet('menu') }} aria-label="Manage this prop" title="Manage this prop"
        className="w-11 h-11 -mr-2 grid place-items-center rounded-full text-pt-text active:bg-white/10">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>

      <BottomSheet open={sheet === 'menu'} onClose={() => setSheet('')} title="Manage this prop">
        <p className="text-pt-muted text-[14px] -mt-1 mb-3 truncate">{item.name}</p>
        <div className="space-y-2">
          {row('pencil', 'Edit details', 'Name, photos, bin, how many, description', () => navigate(`/item/${item.id}/edit`))}
          {company && !item.archived && <>
            {row('search', 'Find duplicates', 'Props that may be the same thing: combine them or remove the extras', () => setSheet('find'), 'gold')}
            {row('swap', 'Merge with another prop', 'Pick it by name. Its photos (and count) move here', () => setSheet('merge'))}
            {!checked && row('check', 'Mark as checked', 'It looks right. Counts as done in Clean up props', check)}
          </>}
          {company && item.archived && item.removedAt && row('restore', 'Put it back', 'Back in the app, as it was', putBack, 'gold')}
          {company && !item.archived && row('archive', 'Remove this prop', 'Goes to Removed props. You can put it back any time', () => setSheet('remove'), 'red')}
          {company && item.importedFrom && row('x', 'Delete for good', 'Only for imported props that were never booked. Can’t be undone', () => setSheet('delete'), 'red')}
        </div>
        {checked && company && <p className="mt-3 text-pt-muted text-[14px]">Checked ✓ {item.reviewedBy ? `by ${item.reviewedBy.split('@')[0]} ` : ''}· {new Date(item.reviewedAt!).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</p>}
        {err && <p className="mt-3 rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
      </BottomSheet>

      {(sheet === 'find' || sheet === 'merge') && (
        <DuplicatesSheet item={item} mode={sheet} onClose={() => setSheet('')} onDone={d => { setSheet(''); onDone(d) }} />
      )}

      <RemoveSheet open={sheet === 'remove'} name={item.name} onClose={() => setSheet('')} onRemove={async reason => {
        const r = await removeProps([item.id], reason)
        if (r.booked.length) throw new Error(`"${item.name}" is in a booking right now. Remove it once it's back.`)
        setSheet('')
        onDone({ text: `Removed "${item.name}"`, undo: () => { void restoreProps([item.id]) } })
      }} />

      <BottomSheet open={sheet === 'delete'} onClose={() => setSheet('')} title={`Delete "${item.name}" for good?`}>
        <p className="text-pt-muted text-[16px]">This can't be undone. Its photo can be imported again later. Props that were ever booked can't be deleted: use <b className="text-pt-text">Remove</b> instead (you can put those back).</p>
        {err && <p className="mt-3 rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
        <div className="mt-4 flex gap-2">
          <button onClick={() => setSheet('')} className="flex-1 rounded-2xl min-h-[52px] bg-white/[0.08] text-pt-text text-[16px] font-semibold">Keep it</button>
          <button disabled={busy} onClick={async () => {
            setBusy(true); setErr('')
            try { await deleteImportedProp({ itemId: item.id }); setSheet(''); onDone({ text: `Deleted "${item.name}"`, gone: true }) }
            catch (e) { setErr(friendlyError(e, "Couldn't reach the server.")) } finally { setBusy(false) }
          }} className="flex-1 rounded-2xl min-h-[52px] bg-red-600 text-white text-[16px] font-bold disabled:opacity-40">{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </BottomSheet>
    </>
  )
}

interface Cand { item: Item; tier: Tier | 'near' | 'name' | 'search'; signals?: Signals; score: number }

/** "Find duplicates" (suggestions first, search underneath) and "Merge with another prop" (search first). */
function DuplicatesSheet({ item, mode, onClose, onDone }: { item: Item; mode: 'find' | 'merge'; onClose: () => void; onDone: (d: ManageDone) => void }) {
  const items = useItems()
  const tags = useTags()
  const binInfo = useBinLabel()
  const [data, setData] = useState<DoublesOf | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])   // "Not the same" this session
  const [step, setStep] = useState<'pick' | 'how'>('pick')
  const [keepId, setKeepId] = useState(item.id)
  const [binId, setBinId] = useState(item.binId ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let off = false
    doublesOf({ id: item.id }).then(r => { if (!off) setData(r.data) }).catch(e => { if (!off) setLoadErr(friendlyError(e)) })
    if (mode === 'merge') setTimeout(() => searchRef.current?.focus(), 350)
    return () => { off = true }
  }, [item.id, mode])

  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const tagById = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags])
  const usable = (i: Item | undefined): i is Item => !!i && i.id !== item.id && inCleanup(i) && !hidden.includes(i.id)

  // Suggestions: the server's pairs (best first), then its looser look-alikes, then names that look alike on this phone.
  const cands: Cand[] = useMemo(() => {
    const out: Cand[] = [], seen = new Set<string>()
    const add = (c: Cand) => { if (!seen.has(c.item.id)) { seen.add(c.item.id); out.push(c) } }
    for (const p of data?.pairs ?? []) { const o = byId.get(p.id); if (usable(o)) add({ item: o, tier: p.tier, signals: p.signals, score: p.score }) }
    for (const n of data?.near ?? []) { const o = byId.get(n.id); if (usable(o)) add({ item: o, tier: 'near', score: n.score }) }
    for (const o of likelyDoubles(item, items, 6)) if (usable(o)) add({ item: o, tier: 'name', score: 0 })
    return out
  }, [data, byId, items, item, hidden])   // eslint-disable-line react-hooks/exhaustive-deps
  const found = q.trim().length >= 2 ? items.filter(i => usable(i) && matchesQuery(i, q, tagById)).slice(0, 15) : []

  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const group = [item, ...picked.map(id => byId.get(id)).filter((i): i is Item => !!i)]
  const total = group.reduce((n, i) => n + (i.quantity || 1), 0)
  const highest = Math.max(...group.map(i => i.quantity || 1))
  const bins = [...new Set(group.map(i => i.binId ?? '').filter(Boolean))]
  const binsDiffer = new Set(group.map(i => i.binId ?? '')).size > 1 && bins.length > 0
  const keep = group.find(i => i.id === keepId) ?? item

  async function notSame(o: Item) {
    const k = pairKeyOf(item.id, o.id)
    setHidden(h => [...h, o.id]); setPicked(p => p.filter(x => x !== o.id))
    const c = cachedDoubles(); if (c) setCachedPairs(c.pairs.filter(p => pairKeyOf(p.a, p.b) !== k))
    try { await dismissDuplicatePairs([k]) } catch { /* it just shows again next time */ }
  }

  async function combine(how: 'copies' | 'angles') {
    setBusy(true); setErr('')
    const others = group.filter(i => i.id !== keep.id)
    // A bin that isn't the kept prop's own comes along with the prop that's in it (the server only takes one of the two bins).
    const moveBin = binId && binId !== (keep.binId ?? '') ? binId : ''
    const first = moveBin ? others.find(o => o.binId === moveBin) : undefined
    const order = first ? [first, ...others.filter(o => o !== first)] : others
    const done: string[] = [], failed: string[] = []
    for (const o of order) {
      try {
        await mergeProps({ keepId: keep.id, removeId: o.id, mode: how, ...(o === first ? { binId: moveBin } : {}) })
        done.push(o.id)
        const c = cachedDoubles(); if (c) setCachedPairs(afterMerge(c.pairs, keep.id, o.id))
      } catch (e) { failed.push(`${o.name}: ${friendlyError(e)}`) }
    }
    setBusy(false)
    if (failed.length && !done.length) { setErr(failed.join('\n')); return }
    const what = how === 'copies' ? `${done.length + 1} copies combined` : `${done.length + 1} entries combined into one`
    onDone({ text: failed.length ? `${what}. Not combined: ${failed.join('; ')}` : `${what} ✓`, goTo: keep.id !== item.id ? `/item/${keep.id}` : undefined })
  }

  async function removeOthers() {
    setBusy(true); setErr('')
    try {
      const ids = picked.filter(id => id !== item.id)
      const r = await removeProps(ids, 'Same prop twice')
      setBusy(false)
      const skipped = r.booked.map(id => byId.get(id)?.name ?? 'one').join(', ')
      if (!r.removed.length) { setErr(`${skipped} ${r.booked.length === 1 ? 'is' : 'are'} in a booking right now. Remove ${r.booked.length === 1 ? 'it' : 'them'} once back.`); return }
      onDone({ text: `Removed ${r.removed.length} duplicate${r.removed.length === 1 ? '' : 's'}${skipped ? ` (not ${skipped}: in a booking)` : ''}`, undo: () => { void restoreProps(r.removed) } })
    } catch (e) { setErr(friendlyError(e)); setBusy(false) }
  }

  const candRow = (c: Cand) => {
    const on = picked.includes(c.item.id)
    const reasons = c.signals ? reasonsOf(c.signals).filter(r => r !== 'Same picture') : []
    const ai = c.signals?.ai
    return (
      <div key={c.item.id} className={`rounded-2xl p-2 flex items-center gap-3 ${on ? 'bg-pt-accent/15 ring-2 ring-pt-accent' : 'bg-white/[0.05]'}`}>
        <button onClick={() => toggle(c.item.id)} aria-pressed={on} aria-label={on ? `Untick ${c.item.name}` : `Tick ${c.item.name}`}
          className={`w-11 h-11 shrink-0 rounded-full grid place-items-center text-[18px] font-bold ${on ? 'bg-pt-accent text-stone-900' : 'bg-white/[0.08] text-transparent'}`}>✓</button>
        <PropThumb item={c.item} size={64} />
        <button onClick={() => toggle(c.item.id)} className="min-w-0 flex-1 text-left py-1">
          <span className="block text-pt-text text-[16px] font-semibold leading-snug line-clamp-2">{c.item.name}</span>
          <span className="block text-pt-muted text-[14px]">{binInfo.where(c.item.binId)} · {c.item.quantity} {c.item.quantity === 1 ? 'unit' : 'units'}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {c.tier !== 'search' && <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${TIER_TONE[c.tier]}`}>{TIER_LABEL[c.tier]}</span>}
            {reasons.slice(0, 2).map(r => <span key={r} className="rounded-full px-2 py-0.5 text-[12px] bg-white/[0.08] text-pt-muted">{r}</span>)}
            {ai && <span className={`rounded-full px-2 py-0.5 text-[12px] ${ai.same ? 'bg-violet-500/20 text-violet-200' : 'bg-white/[0.08] text-pt-muted'}`}>✦ AI: {ai.same ? 'same thing' : 'looks different'}</span>}
          </span>
        </button>
        {c.tier !== 'name' && c.tier !== 'search' && <button onClick={() => notSame(c.item)} className="shrink-0 min-h-[44px] px-2 text-pt-muted text-[14px]" aria-label={`${c.item.name} is not the same`}>Not<br />same</button>}
      </div>
    )
  }

  const searchBox = (
    <div>
      <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder={mode === 'merge' ? 'Type the other prop’s name' : 'Not listed? Search by name'}
        className="w-full bg-pt-bg rounded-2xl px-4 min-h-[52px] text-[17px] text-pt-text placeholder:text-pt-muted outline-none focus:ring-2 focus:ring-pt-accent" />
      {q.trim().length >= 2 && <div className="mt-2 space-y-2">
        {found.length ? found.map(o => candRow({ item: o, tier: 'search', score: 0 })) : <p className="text-pt-muted text-[14px] px-1">Nothing matches “{q.trim()}”.</p>}
      </div>}
    </div>
  )

  const suggestions = (
    <div className="space-y-2">
      {!data && !loadErr && <p className="text-pt-muted text-[15px] px-1 py-3">Checking photos, names and look-alikes…</p>}
      {loadErr && <p className="text-amber-200 text-[14px] px-1">Couldn't check everything ({loadErr}). Name matches below.</p>}
      {data && !data.indexed && <p className="text-pt-muted text-[14px] px-1">This prop isn't in smart search yet, so only photos and names were compared.</p>}
      {cands.map(candRow)}
      {data && !cands.length && <p className="text-pt-text text-[16px] px-1 py-2">No likely duplicates found. {mode === 'find' ? 'Search below if you know one.' : ''}</p>}
    </div>
  )

  return (
    <BottomSheet open onClose={onClose} title={step === 'how' ? 'How should they be combined?' : mode === 'merge' ? 'Merge with which prop?' : 'Duplicates of this prop'}>
      {step === 'pick' ? (
        <>
          <div className="flex items-center gap-3 mb-3">
            <PropThumb item={item} size={56} />
            <p className="min-w-0 text-[15px] text-pt-muted"><b className="text-pt-text block truncate">{item.name}</b>Tick the ones that are the <b className="text-pt-text">same thing</b>. Tap a photo to see it big.</p>
          </div>
          <div className="space-y-4 max-h-[58vh] overflow-y-auto pb-2">
            {mode === 'merge' ? <>{searchBox}{!q.trim() && <><p className="text-pt-muted text-[14px] px-1">Or one of these:</p>{suggestions}</>}</> : <>{suggestions}{searchBox}</>}
          </div>
          {err && <p className="mt-3 rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px] whitespace-pre-line">{err}</p>}
          {picked.length > 0 && (
            <div className="mt-3 space-y-2">
              <button onClick={() => { setStep('how'); setErr(''); setKeepId(item.id); setBinId(item.binId || bins[0] || '') }} className="w-full rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[18px] font-bold">Combine {picked.length} with this one ›</button>
              <button disabled={busy} onClick={removeOthers} className="w-full rounded-2xl min-h-[48px] bg-white/[0.06] text-pt-text text-[15px] disabled:opacity-40">
                {busy ? 'Removing…' : `Just remove the ${picked.length === 1 ? 'other one' : `${picked.length} others`}`} <span className="text-pt-muted">(goes to Removed props)</span></button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-pt-muted text-[15px]">One prop stays; the others go away and give it their photos. Tap the one to <b className="text-pt-text">keep</b>.</p>
          <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {group.map(g => (
              <button key={g.id} onClick={() => { setKeepId(g.id); if (g.binId) setBinId(g.binId) }} className={`shrink-0 w-[112px] rounded-2xl p-1.5 text-left ${g.id === keep.id ? 'bg-pt-accent/20 ring-2 ring-pt-accent' : 'bg-white/[0.05]'}`}>
                <PropThumb item={g} size={100} />
                <span className="block mt-1 text-[13px] text-pt-text leading-tight line-clamp-2">{g.name}</span>
                <span className={`block text-[12px] font-semibold ${g.id === keep.id ? 'text-pt-accent' : 'text-pt-muted'}`}>{g.id === keep.id ? 'Keeps ✓' : `${g.quantity} ${g.quantity === 1 ? 'unit' : 'units'}`}</span>
              </button>
            ))}
          </div>
          {binsDiffer && (
            <div className="mt-3">
              <p className="text-pt-text text-[16px] font-semibold">They're in different bins. Where will they all be?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {bins.map(b => <button key={b} onClick={() => setBinId(b)} className={`min-h-[44px] rounded-full px-4 text-[15px] ${binId === b ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-white/[0.08] text-pt-text'}`}>{binInfo.label(b) ?? 'Bin'}</button>)}
              </div>
            </div>
          )}
          <div className="mt-4 space-y-2">
            <button disabled={busy} onClick={() => combine('angles')} className="w-full rounded-2xl p-4 text-left bg-pt-accent text-stone-900 disabled:opacity-40">
              <b className="block text-[18px]">One prop, photographed {group.length} times</b>
              <span className="block text-[15px]">Keeps the count at {highest}, adds the photos</span></button>
            <button disabled={busy} onClick={() => combine('copies')} className="w-full rounded-2xl p-4 text-left bg-white/[0.08] text-pt-text disabled:opacity-40">
              <b className="block text-[18px]">We have {group.length} separate copies</b>
              <span className="block text-[15px] text-pt-muted">Adds up the count: {group.map(g => g.quantity || 1).join(' + ')} = {total}</span></button>
          </div>
          {busy && <p className="mt-3 text-pt-muted text-[15px]">Combining…</p>}
          {err && <p className="mt-3 rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px] whitespace-pre-line">{err}</p>}
          <button onClick={() => setStep('pick')} disabled={busy} className="mt-2 w-full rounded-2xl min-h-[52px] text-pt-muted text-[16px]">‹ Back</button>
        </>
      )}
    </BottomSheet>
  )
}
