// Doubles (owner, Nov 6: "collapse duplicate stuff into each other… sometimes there are more than 2 of something… I don't
// wanna automate it, everything should still have a manual confirm… if displaying a picture make sure we can open it larger").
// The server merges every clue (same photo file, AI fingerprint, names, same bin, the AI's photo check) into pairs
// (functions/src/doubles.ts); here they're joined into GROUPS (2 to 10 props that may all be the same thing), most sure first.
// One group at a time: tick the ones that are the same, then say how to combine them. Nothing ever combines by itself: the AI
// only gives its opinion, and every bulk button shows what it will do and waits for a "Yes".
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useItems } from '../hooks/useItems'
import { inCleanup, bestToKeep } from '../lib/cleanup'
import { afterMerge, pairKeyOf, groupDoubles, keysBetween, type Tier, type DoubleGroup } from '../../functions/src/doubles'
import { loadDoubles, cachedDoubles, setCachedPairs, aiCheckPairs, type DoublePair } from '../services/cleanup'
import { mergeProps } from '../services/importer'
import { dismissDuplicatePairs } from '../services/health'
import { CleanupHeader, Toast, useBinLabel, PropThumb, ZoomBadge } from '../components/cleanup/Parts'
import BottomSheet from '../components/BottomSheet'
import ImageLightbox from '../components/ImageLightbox'
import { friendlyError } from '../lib/errors'
import { thumbOf } from '../services/itemShape'
import type { Item } from '../types'

const TIER_LABEL: Record<Tier, string> = { sure: 'Same picture', likely: 'Very likely the same', maybe: 'Maybe the same' }
const TIER_TONE: Record<Tier, string> = { sure: 'bg-green-600 text-white', likely: 'bg-pt-accent text-stone-900', maybe: 'bg-white/[0.12] text-pt-text' }
const gid = (g: { ids: string[] }) => [...g.ids].sort().join(',')

export default function CleanupDoublesScreen() {
  const navigate = useNavigate()
  const items = useItems()
  const byId = useMemo(() => new Map(items.filter(inCleanup).map(i => [i.id, i])), [items])
  const binInfo = useBinLabel()
  const [pairs, setPairsState] = useState<DoublePair[] | null>(() => cachedDoubles()?.pairs ?? null)
  const [checked, setChecked] = useState(() => cachedDoubles()?.checked ?? 0)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [skipped, setSkipped] = useState<Set<string>>(new Set())   // pair keys
  const [tier, setTier] = useState<Tier | 'all'>('all')
  const [bulk, setBulk] = useState<'' | 'sure' | 'ai' | 'apart'>('')
  const setPairs = (fn: (p: DoublePair[]) => DoublePair[]) => setPairsState(p => { const n = fn(p ?? []); setCachedPairs(n); return n })

  async function load(force = false) {
    setErr('')
    if (force) setPairsState(null)
    try { const r = await loadDoubles(force); setPairsState(r.pairs); setChecked(r.checked) } catch (e) { setErr(friendlyError(e)); setPairsState(p => p ?? []) }
  }
  useEffect(() => { if (!pairs) void load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Only pairs where both props are still in the app.
  const live = useMemo(() => (pairs ?? []).filter(p => byId.has(p.a) && byId.has(p.b)), [pairs, byId])
  const allGroups = useMemo(() => groupDoubles(live), [live])
  const counts = useMemo(() => ({ sure: allGroups.filter(g => g.tier === 'sure').length, likely: allGroups.filter(g => g.tier === 'likely').length, maybe: allGroups.filter(g => g.tier === 'maybe').length }), [allGroups])
  const sureGroups = useMemo(() => groupDoubles(live.filter(p => p.tier === 'sure')), [live])
  const aiSureGroups = useMemo(() => groupDoubles(live.filter(p => p.tier !== 'sure' && p.signals.ai?.same && p.signals.ai.confidence === 'high')), [live])
  const aiNo = live.filter(p => !p.signals.photo && p.signals.ai && !p.signals.ai.same && p.signals.ai.confidence === 'high')
  const queue = useMemo(() => groupDoubles(live.filter(p => !skipped.has(pairKeyOf(p.a, p.b)))).filter(g => tier === 'all' || g.tier === tier), [live, skipped, tier])
  const current = queue[0]

  // The AI looks at the pairs of the next groups ahead of the crew (only an opinion; never the same pair twice; monthly budget).
  const asked = useRef(new Set<string>())
  const [aiResting, setAiResting] = useState(false)
  useEffect(() => {
    if (aiResting) return
    const want = new Set(queue.slice(0, 4).flatMap(g => g.keys))
    const next = live.filter(p => p.tier !== 'sure' && !p.signals.ai && want.has(pairKeyOf(p.a, p.b)) && !asked.current.has(pairKeyOf(p.a, p.b))).slice(0, 10)
    if (!next.length) return
    next.forEach(p => asked.current.add(pairKeyOf(p.a, p.b)))
    aiCheckPairs({ pairs: next.map(p => ({ a: p.a, b: p.b })) }).then(r => {
      if (r.data.resting) setAiResting(true)
      const v = r.data.verdicts
      if (Object.keys(v).length) setPairs(ps => ps.map(p => v[pairKeyOf(p.a, p.b)] ? { ...p, signals: { ...p.signals, ai: v[pairKeyOf(p.a, p.b)] } } : p))
    }).catch(() => { /* no AI right now: the crew decides without it */ })
  }, [current ? gid(current) : '', queue.length, aiResting])   // eslint-disable-line react-hooks/exhaustive-deps

  /** Combine the ticked props of a group into the kept one; the ones left out are marked "not the same" as them. */
  async function combine(g: DoubleGroup, ticked: string[], keepId: string, mode: 'copies' | 'angles') {
    for (const id of ticked) {
      if (id === keepId) continue
      await mergeProps({ keepId, removeId: id, mode })
      setPairs(ps => afterMerge(ps, keepId, id))
    }
    const left = g.ids.filter(id => !ticked.includes(id))
    if (left.length) {
      const ks = keysBetween([keepId], left)
      await dismissDuplicatePairs(ks)
      const drop = new Set(ks)
      setPairs(ps => ps.filter(p => !drop.has(pairKeyOf(p.a, p.b))))
    }
  }
  async function apart(keys: string[]) {
    await dismissDuplicatePairs(keys)
    const drop = new Set(keys)
    setPairs(ps => ps.filter(p => !drop.has(pairKeyOf(p.a, p.b))))
  }

  return (
    <div className="min-h-full bg-pt-bg flex flex-col">
      <CleanupHeader title="Doubles" right={pairs ? <button onClick={() => load(true)} className="min-h-[40px] rounded-full bg-white/[0.08] px-3 text-[14px] text-pt-text">Look again</button> : null} />
      <div className="flex-1 px-4 max-w-[640px] w-full mx-auto space-y-4 pb-6">
        {!pairs && !err && (
          <div className="rounded-[20px] bg-pt-surface p-5">
            <p className="text-pt-text text-[18px] font-semibold">Comparing every prop…</p>
            <p className="text-pt-muted text-[16px] mt-1">Photos, names, bins and the AI fingerprints. Takes up to a minute the first time.</p>
            <div className="mt-3 h-2 rounded-full bg-white/[0.08] overflow-hidden"><div className="h-full w-1/3 bg-pt-accent animate-pulse" /></div>
          </div>
        )}
        {err && <p className="rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err} <button onClick={() => load(true)} className="underline">Try again</button></p>}

        {pairs && <>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            {([['all', `All · ${allGroups.length}`], ['sure', `Same picture · ${counts.sure}`], ['likely', `Very likely · ${counts.likely}`], ['maybe', `Maybe · ${counts.maybe}`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTier(k)} className={`shrink-0 min-h-[40px] inline-flex items-center rounded-full px-3.5 text-[14px] ${tier === k ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-white/[0.08] text-pt-text'}`}>{l}</button>
            ))}
          </div>

          {/* Bulk helpers: each one opens a list to look at first and only acts on "Yes". */}
          {sureGroups.length > 0 && (
            <button onClick={() => setBulk('sure')} className="w-full text-left rounded-[20px] bg-green-600/15 p-4">
              <span className="block text-pt-text text-[18px] font-bold">{sureGroups.length} group{sureGroups.length === 1 ? '' : 's'} with the exact same picture</span>
              <span className="block text-pt-muted text-[16px]">The import added the same photo more than once. Look at them all in one list and combine them together ›</span>
            </button>
          )}
          {aiSureGroups.length > 0 && (
            <button onClick={() => setBulk('ai')} className="w-full text-left rounded-[20px] bg-violet-500/15 p-4">
              <span className="block text-pt-text text-[18px] font-bold">✦ The AI thinks {aiSureGroups.length} group{aiSureGroups.length === 1 ? ' is' : 's are'} the same thing</span>
              <span className="block text-pt-muted text-[16px]">Have a look, untick any it got wrong, then combine the rest ›</span>
            </button>
          )}
          {aiNo.length > 0 && (
            <button onClick={() => setBulk('apart')} className="w-full text-left rounded-[20px] bg-pt-surface p-4">
              <span className="block text-pt-text text-[16px] font-semibold">The AI says {aiNo.length} pair{aiNo.length === 1 ? ' is' : 's are'} different</span>
              <span className="block text-pt-muted text-[14px]">Look at them and clear them from the list ›</span>
            </button>
          )}

          {current ? (
            <GroupCard key={gid(current)} group={current} byId={byId} where={binInfo.where} left={queue.length} aiResting={aiResting}
              onCombine={async (ticked, keepId, mode) => { await combine(current, ticked, keepId, mode); setToast(`Combined ${ticked.length} into one ✓`) }}
              onApart={async () => { await apart(current.keys); setToast(current.ids.length > 2 ? 'Kept them all apart ✓' : 'Kept apart ✓') }}
              onSkip={() => setSkipped(s => { const n = new Set(s); current.keys.forEach(k => n.add(k)); return n })} />
          ) : (
            <div className="rounded-[20px] bg-pt-surface p-6 text-center">
              <p className="text-pt-text text-[20px] font-bold">{live.length ? 'Nothing left in this list ✓' : 'No doubles left ✓'}</p>
              <p className="text-pt-muted text-[16px] mt-1">{live.length ? 'Pick another list above, or come back to the ones you skipped.' : `The app compared ${checked.toLocaleString()} props.`}</p>
              <div className="mt-4 space-y-2">
                {skipped.size > 0 && <button onClick={() => setSkipped(new Set())} className="w-full rounded-2xl min-h-[48px] bg-white/[0.08] text-pt-text text-[16px] font-semibold">Show the ones I skipped</button>}
                <button onClick={() => navigate('/cleanup')} className="w-full rounded-2xl min-h-[48px] bg-pt-accent text-stone-900 text-[16px] font-bold">Back to Clean up</button>
              </div>
            </div>
          )}
        </>}
      </div>

      {(bulk === 'sure' || bulk === 'ai') && <BulkSheet kind={bulk} groups={bulk === 'sure' ? sureGroups : aiSureGroups} byId={byId}
        onClose={() => setBulk('')} combine={combine} onDone={n => { setBulk(''); setToast(`Combined ${n} group${n === 1 ? '' : 's'} ✓`) }} />}
      {bulk === 'apart' && <ApartSheet pairs={aiNo} byId={byId} onClose={() => setBulk('')}
        onConfirm={async keys => { await apart(keys); setBulk(''); setToast(`${keys.length} kept apart ✓`) }} />}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  )
}

function GroupCard({ group, byId, where, left, aiResting, onCombine, onApart, onSkip }: {
  group: DoubleGroup; byId: Map<string, Item>; where: (id?: string) => string; left: number; aiResting: boolean
  onCombine: (ticked: string[], keepId: string, mode: 'copies' | 'angles') => Promise<void>; onApart: () => Promise<void>; onSkip: () => void
}) {
  const props = group.ids.map(id => byId.get(id)).filter((x): x is Item => !!x)
  const many = props.length > 2
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(props.map(p => p.id)))
  const picked = props.filter(p => ticked.has(p.id))
  const [keepId, setKeepId] = useState(() => bestToKeep(props).id)
  const keep = picked.find(p => p.id === keepId) ?? (picked.length ? bestToKeep(picked) : props[0])
  const [step, setStep] = useState<'ask' | 'how'>('ask')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [zoom, setZoom] = useState<Item | null>(null)
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn() } catch (e) { setErr(friendlyError(e)); setBusy(false) } }
  const toggle = (id: string) => setTicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const total = picked.reduce((n, p) => n + p.quantity, 0)
  const highest = Math.max(0, ...picked.map(p => p.quantity))
  const ai = group.ai
  return (
    <div className="rounded-[24px] bg-pt-surface p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className={`rounded-full px-3 py-1 text-[14px] font-semibold ${TIER_TONE[group.tier]}`}>{many ? `${props.length} props · ` : ''}{TIER_LABEL[group.tier]}</span>
        {group.reasons.filter(r => r !== 'Same picture').slice(0, 3).map(r => <span key={r} className="rounded-full px-2.5 py-1 text-[12px] bg-white/[0.08] text-pt-muted">{r}</span>)}
        <span className="ml-auto text-pt-muted text-[14px]">{left} left</span>
      </div>
      {step === 'ask' && many && <p className="px-1 text-pt-text text-[16px]">Untick any that's <b>not</b> the same thing. Tap a photo to see it bigger.</p>}
      <div className="grid grid-cols-2 gap-2">
        {props.map(p => {
          const on = ticked.has(p.id)
          return (
            <div key={p.id} className={`rounded-2xl p-2 transition-opacity ${step === 'how' && p.id === keep.id ? 'bg-pt-accent/15 ring-2 ring-pt-accent' : on ? 'bg-white/[0.06] ring-2 ring-green-500/60' : 'bg-white/[0.03] opacity-50'}`}>
              <button onClick={() => p.photos[0] && setZoom(p)} className="relative block w-full aspect-square rounded-xl overflow-hidden bg-black" aria-label={`See the photo of ${p.name} bigger`}>
                {p.photos[0] ? <img src={thumbOf(p, p.photos[0])} alt="" className="w-full h-full object-cover" /> : <span className="grid place-items-center h-full text-pt-muted text-sm">No photo</span>}
                {p.photos[0] && <ZoomBadge className="bottom-1.5 right-1.5 !w-8 !h-8" />}
                {p.photos.length > 1 && <span className="absolute top-1.5 left-1.5 rounded-full bg-black/70 text-white text-[12px] px-2 py-0.5">{p.photos.length} photos</span>}
              </button>
              <p className="mt-1.5 text-pt-text text-[16px] font-semibold leading-tight line-clamp-2">{p.name}</p>
              <p className="text-pt-muted text-[14px]">{where(p.binId)} · ×{p.quantity}</p>
              {step === 'ask' && many && (
                <button onClick={() => toggle(p.id)} aria-pressed={on} className={`mt-1 w-full rounded-xl min-h-[44px] text-[14px] font-bold ${on ? 'bg-green-600/20 text-green-300' : 'bg-white/[0.06] text-pt-muted'}`}>{on ? '✓ Same' : 'Not this one'}</button>
              )}
              {step === 'how' && on && <button onClick={() => setKeepId(p.id)} className={`mt-1 tap min-h-[36px] text-[14px] font-bold ${p.id === keep.id ? 'text-pt-accent' : 'text-pt-muted'}`}>{p.id === keep.id ? 'Keeping this one ✓' : 'Keep this one'}</button>}
            </div>
          )
        })}
      </div>
      {ai.same + ai.different > 0 ? (
        <p className={`rounded-2xl px-3 py-2 text-[14px] ${ai.same && !ai.different ? 'bg-violet-500/15 text-violet-100' : 'bg-white/[0.06] text-pt-muted'}`}>
          ✦ AI: {ai.same && !ai.different ? 'looks like the same thing' : ai.different && !ai.same ? 'looks different' : `${ai.same} look the same, ${ai.different} look different`}{ai.reason ? `. ${ai.reason}` : ''}</p>
      ) : group.tier !== 'sure' && !aiResting ? <p className="px-1 text-pt-muted text-[14px]">✦ The AI is looking at these…</p> : null}

      {step === 'ask' ? (
        <>
          <p className="text-center text-pt-text text-[20px] font-bold">{many ? `Combine the ${picked.length} ticked?` : 'Same thing?'}</p>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => run(onApart)} className="flex-1 rounded-2xl min-h-[56px] bg-white/[0.08] text-pt-text text-[16px] font-semibold disabled:opacity-40 leading-tight">{many ? 'None are the same' : 'No, different'}</button>
            <button disabled={busy || picked.length < 2} onClick={() => { setKeepId(keep.id); setStep('how') }}
              className="flex-1 rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[16px] font-bold shadow-gold disabled:opacity-40 leading-tight">{many ? `Combine ${picked.length}` : 'Yes, combine'}</button>
          </div>
          {many && picked.length < 2 && <p className="text-center text-pt-muted text-[14px]">Tick at least two to combine, or tap "None are the same".</p>}
          <button onClick={onSkip} className="w-full tap min-h-[44px] text-pt-muted text-[16px]">Not sure, skip ›</button>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-pt-text text-[16px] px-1">How should the {picked.length} become one? <span className="text-pt-muted">"{keep.name}" stays{picked.length > 2 ? '; the others go' : '; the other goes'}.</span></p>
          <button disabled={busy} onClick={() => run(() => onCombine(picked.map(p => p.id), keep.id, 'angles'))} className="w-full rounded-2xl p-4 text-left bg-pt-accent text-stone-900 disabled:opacity-40">
            <b className="block text-[18px]">One prop, photographed {picked.length === 2 ? 'twice' : `${picked.length} times`}</b>
            <span className="block text-[16px]">Keep one entry with {highest}</span></button>
          <button disabled={busy} onClick={() => run(() => onCombine(picked.map(p => p.id), keep.id, 'copies'))} className="w-full rounded-2xl p-4 text-left bg-white/[0.08] text-pt-text disabled:opacity-40">
            <b className="block text-[18px]">We have {picked.length === 2 ? 'two' : picked.length} separate copies</b>
            <span className="block text-[16px] text-pt-muted">Add them up: {picked.map(p => p.quantity).join(' + ')} = {total}</span></button>
          {busy && <p className="text-pt-muted text-[14px] px-1">Combining…</p>}
          <button disabled={busy} onClick={() => setStep('ask')} className="w-full tap min-h-[44px] text-pt-muted text-[16px]">‹ Back</button>
        </div>
      )}
      {err && <p className="rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
      {zoom?.photos[0] && <ImageLightbox src={zoom.photos[0]} alt={zoom.name} onClose={() => setZoom(null)} />}
    </div>
  )
}

// Many groups at once (exact copies, or what the AI is sure about): every group is shown with all its photos (tap one to see it
// bigger), all ticked; untick any group that's wrong, then confirm. Each group becomes one prop and keeps the highest count.
function BulkSheet({ kind, groups, byId, onClose, combine, onDone }: {
  kind: 'sure' | 'ai'; groups: DoubleGroup[]; byId: Map<string, Item>; onClose: () => void
  combine: (g: DoubleGroup, ticked: string[], keepId: string, mode: 'copies' | 'angles') => Promise<void>; onDone: (n: number) => void
}) {
  const [off, setOff] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [err, setErr] = useState('')
  const list = groups.slice(0, 150)
  const picked = list.filter(g => !off.has(gid(g)))
  const props = (g: DoubleGroup) => g.ids.map(id => byId.get(id)).filter((x): x is Item => !!x)
  async function go() {
    setBusy(true); setErr('')
    let n = 0
    for (const g of picked) {
      const ps = props(g)
      if (ps.length < 2) continue
      try { await combine(g, ps.map(p => p.id), bestToKeep(ps).id, 'angles'); n++; setDone(n) }
      catch (e) { setErr(`${n} combined, then: ${friendlyError(e)}`); setBusy(false); return }
    }
    onDone(n)
  }
  return (
    <BottomSheet open onClose={busy ? () => {} : onClose} title={kind === 'sure' ? 'Same picture, more than once' : '✦ The AI thinks these are the same'}>
      <p className="text-pt-muted text-[16px]">{kind === 'sure'
        ? 'Each row is one picture that was added more than once. Tap a photo to see it bigger. Untick any row you don\'t want combined.'
        : 'The AI looked at the photos. Tap a photo to see it bigger, untick any row it got wrong.'} Each ticked row becomes <b className="text-pt-text">one prop with the highest count</b>; you can fix the count after.</p>
      <div className="mt-3 max-h-[45vh] overflow-y-auto space-y-2">
        {list.map(g => {
          const ps = props(g), k = gid(g), on = !off.has(k)
          if (ps.length < 2) return null
          return (
            <div key={k} className={`rounded-2xl p-2 ${on ? 'bg-white/[0.06]' : 'opacity-50'}`}>
              <div className="flex items-center gap-2">
                <button disabled={busy} onClick={() => setOff(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })} aria-pressed={on} aria-label={on ? 'Untick' : 'Tick'}
                  className="w-11 h-11 grid place-items-center shrink-0"><span className={`w-7 h-7 rounded-md grid place-items-center text-[16px] font-bold ${on ? 'bg-pt-accent text-stone-900' : 'border-2 border-white/30'}`}>{on ? '✓' : ''}</span></button>
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar">{ps.map(p => <PropThumb key={p.id} item={p} size={60} />)}</div>
              </div>
              <p className="text-[14px] text-pt-text leading-tight mt-1 pl-12 line-clamp-2">{ps.map(p => p.name).join(' · ')}</p>
            </div>
          )
        })}
      </div>
      {busy && <div className="mt-3"><div className="h-2 rounded-full bg-white/[0.08] overflow-hidden"><div className="h-full bg-green-500 transition-all" style={{ width: `${Math.round((done / Math.max(1, picked.length)) * 100)}%` }} /></div>
        <p className="text-pt-muted text-[14px] mt-1">{done} of {picked.length} combined… keep this screen open.</p></div>}
      {err && <p className="mt-3 rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
      <button disabled={busy || !picked.length} onClick={go} className="mt-3 w-full rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[18px] font-bold disabled:opacity-40">{busy ? 'Combining…' : `Yes, combine ${picked.length} group${picked.length === 1 ? '' : 's'}`}</button>
      {!busy && <button onClick={onClose} className="mt-2 w-full rounded-2xl min-h-[48px] text-pt-muted text-[16px]">Not now</button>}
    </BottomSheet>
  )
}

// The pairs the AI says are different: look, untick any you think ARE the same, then confirm to clear the rest.
function ApartSheet({ pairs, byId, onClose, onConfirm }: { pairs: DoublePair[]; byId: Map<string, Item>; onClose: () => void; onConfirm: (keys: string[]) => Promise<void> }) {
  const [off, setOff] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const list = pairs.slice(0, 200)
  const keys = list.map(p => pairKeyOf(p.a, p.b)).filter(k => !off.has(k))
  return (
    <BottomSheet open onClose={busy ? () => {} : onClose} title="The AI says these are different">
      <p className="text-pt-muted text-[16px]">Tap a photo to see it bigger. Untick any pair that <b className="text-pt-text">is</b> the same thing (it stays in the list). The ticked ones are cleared and never come back.</p>
      <div className="mt-3 max-h-[45vh] overflow-y-auto space-y-2">
        {list.map(p => {
          const a = byId.get(p.a), b = byId.get(p.b), k = pairKeyOf(p.a, p.b), on = !off.has(k)
          if (!a || !b) return null
          return (
            <div key={k} className={`flex items-center gap-2 rounded-2xl p-2 ${on ? 'bg-white/[0.06]' : 'opacity-50'}`}>
              <button disabled={busy} onClick={() => setOff(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })} aria-pressed={on} aria-label={on ? 'Untick' : 'Tick'}
                className="w-11 h-11 grid place-items-center shrink-0"><span className={`w-7 h-7 rounded-md grid place-items-center text-[16px] font-bold ${on ? 'bg-pt-accent text-stone-900' : 'border-2 border-white/30'}`}>{on ? '✓' : ''}</span></button>
              <PropThumb item={a} size={56} /><PropThumb item={b} size={56} />
              <span className="min-w-0 text-[14px] text-pt-text leading-tight"><span className="block truncate">{a.name}</span><span className="block truncate text-pt-muted">{b.name}</span></span>
            </div>
          )
        })}
      </div>
      {err && <p className="mt-3 rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
      <button disabled={busy || !keys.length} onClick={async () => { setBusy(true); setErr(''); try { await onConfirm(keys) } catch (e) { setErr(friendlyError(e)); setBusy(false) } }}
        className="mt-3 w-full rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[18px] font-bold disabled:opacity-40">{busy ? 'Saving…' : `Yes, keep ${keys.length} apart`}</button>
      {!busy && <button onClick={onClose} className="mt-2 w-full rounded-2xl min-h-[48px] text-pt-muted text-[16px]">Not now</button>}
    </BottomSheet>
  )
}
