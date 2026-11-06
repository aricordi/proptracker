// Doubles (owner, Nov 6: "auto try to match certain things that seem similar… collapse duplicate stuff into each other").
// The server merges every clue (same photo file, AI fingerprint, names, same bin, the AI's photo check) into one list of
// pairs, most sure first (functions/src/doubles.ts). The crew answers ONE question per pair: "Same thing?".
// Safe bulk buttons: combine every exact copy (the very same picture), combine what the AI is sure about (after a look),
// and clear every pair the AI says is different. The AI checks the next pairs in the background as they work.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useItems } from '../hooks/useItems'
import { inCleanup, bestToKeep } from '../lib/cleanup'
import { afterMerge, reasonsOf, pairKeyOf, type Tier } from '../../functions/src/doubles'
import { loadDoubles, cachedDoubles, setCachedPairs, aiCheckPairs, type DoublePair } from '../services/cleanup'
import { mergeProps } from '../services/importer'
import { dismissDuplicatePairs } from '../services/health'
import { CleanupHeader, Toast, useBinLabel, PropThumb } from '../components/cleanup/Parts'
import BottomSheet from '../components/BottomSheet'
import ImageLightbox from '../components/ImageLightbox'
import { friendlyError } from '../lib/errors'
import { thumbOf } from '../services/itemShape'
import type { Item } from '../types'

const TIER_LABEL: Record<Tier, string> = { sure: 'Same picture', likely: 'Very likely the same', maybe: 'Maybe the same' }
const TIER_TONE: Record<Tier, string> = { sure: 'bg-green-600 text-white', likely: 'bg-pt-accent text-stone-900', maybe: 'bg-white/[0.12] text-pt-text' }

export default function CleanupDoublesScreen() {
  const navigate = useNavigate()
  const items = useItems()
  const byId = useMemo(() => new Map(items.filter(inCleanup).map(i => [i.id, i])), [items])
  const binInfo = useBinLabel()
  const [pairs, setPairsState] = useState<DoublePair[] | null>(() => cachedDoubles()?.pairs ?? null)
  const [checked, setChecked] = useState(() => cachedDoubles()?.checked ?? 0)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [tier, setTier] = useState<Tier | 'all'>('all')
  const [bulk, setBulk] = useState<'' | 'sure' | 'ai'>('')
  const setPairs = (fn: (p: DoublePair[]) => DoublePair[]) => setPairsState(p => { const n = fn(p ?? []); setCachedPairs(n); return n })

  async function load(force = false) {
    setErr('')
    if (force) setPairsState(null)
    try { const r = await loadDoubles(force); setPairsState(r.pairs); setChecked(r.checked) } catch (e) { setErr(friendlyError(e)); setPairsState(p => p ?? []) }
  }
  useEffect(() => { if (!pairs) void load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Only pairs where both props are still in the app.
  const live = useMemo(() => (pairs ?? []).filter(p => byId.has(p.a) && byId.has(p.b)), [pairs, byId])
  const counts = useMemo(() => ({ sure: live.filter(p => p.tier === 'sure').length, likely: live.filter(p => p.tier === 'likely').length, maybe: live.filter(p => p.tier === 'maybe').length }), [live])
  const aiSure = live.filter(p => p.tier !== 'sure' && p.signals.ai?.same && p.signals.ai.confidence === 'high')
  const aiNo = live.filter(p => !p.signals.photo && p.signals.ai && !p.signals.ai.same && p.signals.ai.confidence === 'high')
  const queue = live.filter(p => (tier === 'all' || p.tier === tier) && !skipped.has(pairKeyOf(p.a, p.b)))
  const current = queue[0]

  // The AI looks at the next pairs ahead of the crew (never the same pair twice; monthly AI budget).
  const asked = useRef(new Set<string>())
  const [aiResting, setAiResting] = useState(false)
  useEffect(() => {
    if (aiResting) return
    const next = queue.filter(p => p.tier !== 'sure' && !p.signals.ai && !asked.current.has(pairKeyOf(p.a, p.b))).slice(0, 10)
    if (!next.length) return
    next.forEach(p => asked.current.add(pairKeyOf(p.a, p.b)))
    aiCheckPairs({ pairs: next.map(p => ({ a: p.a, b: p.b })) }).then(r => {
      if (r.data.resting) setAiResting(true)
      const v = r.data.verdicts
      if (Object.keys(v).length) setPairs(ps => ps.map(p => v[pairKeyOf(p.a, p.b)] ? { ...p, signals: { ...p.signals, ai: v[pairKeyOf(p.a, p.b)] } } : p))
    }).catch(() => { /* no AI right now: the crew decides without it */ })
  }, [current?.a, current?.b, queue.length, aiResting])   // eslint-disable-line react-hooks/exhaustive-deps

  async function combine(p: DoublePair, keepId: string, mode: 'copies' | 'angles') {
    const removeId = keepId === p.a ? p.b : p.a
    await mergeProps({ keepId, removeId, mode })
    setPairs(ps => afterMerge(ps, keepId, removeId))
  }
  async function different(p: DoublePair) {
    const k = pairKeyOf(p.a, p.b)
    await dismissDuplicatePairs([k])
    setPairs(ps => ps.filter(x => pairKeyOf(x.a, x.b) !== k))
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
          {/* What's left, by how sure the app is (tap to look at one kind only). */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            {([['all', `All · ${live.length}`], ['sure', `Same picture · ${counts.sure}`], ['likely', `Very likely · ${counts.likely}`], ['maybe', `Maybe · ${counts.maybe}`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTier(k)} className={`shrink-0 min-h-[40px] inline-flex items-center rounded-full px-3.5 text-[14px] ${tier === k ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-white/[0.08] text-pt-text'}`}>{l}</button>
            ))}
          </div>

          {/* Safe bulk jobs. */}
          {counts.sure > 0 && (
            <div className="rounded-[20px] bg-green-600/15 p-4">
              <p className="text-pt-text text-[18px] font-bold">{counts.sure} exact cop{counts.sure === 1 ? 'y' : 'ies'}</p>
              <p className="text-pt-muted text-[16px]">The very same picture is on two props: the import added them twice. Safe to combine all at once.</p>
              <button onClick={() => setBulk('sure')} className="mt-3 w-full rounded-2xl min-h-[52px] bg-green-600 text-white text-[16px] font-bold">Combine all {counts.sure}</button>
            </div>
          )}
          {aiSure.length > 0 && (
            <div className="rounded-[20px] bg-violet-500/15 p-4">
              <p className="text-pt-text text-[18px] font-bold">✦ The AI is sure about {aiSure.length}</p>
              <p className="text-pt-muted text-[16px]">It looked at both photos and says they're the same thing. Have a quick look, untick any it got wrong, combine the rest.</p>
              <button onClick={() => setBulk('ai')} className="mt-3 w-full rounded-2xl min-h-[52px] bg-violet-500 text-white text-[16px] font-bold">Look and combine</button>
            </div>
          )}
          {aiNo.length > 0 && (
            <button onClick={async () => { try { await dismissDuplicatePairs(aiNo.map(p => pairKeyOf(p.a, p.b))); const ks = new Set(aiNo.map(p => pairKeyOf(p.a, p.b))); setPairs(ps => ps.filter(p => !ks.has(pairKeyOf(p.a, p.b)))); setToast(`${aiNo.length} cleared ✓`) } catch (e) { setErr(friendlyError(e)) } }}
              className="w-full text-left rounded-[20px] bg-pt-surface p-4">
              <span className="block text-pt-text text-[16px] font-semibold">The AI says {aiNo.length} pair{aiNo.length === 1 ? ' is' : 's are'} different</span>
              <span className="block text-pt-muted text-[14px]">Tap to clear them all from the list</span>
            </button>
          )}

          {current ? (
            <PairCard key={pairKeyOf(current.a, current.b)} pair={current} a={byId.get(current.a)!} b={byId.get(current.b)!} where={binInfo.where}
              left={queue.length} aiResting={aiResting}
              onCombine={async (keepId, mode) => { await combine(current, keepId, mode); setToast('Combined ✓') }}
              onDifferent={async () => { await different(current); setToast('Kept apart ✓') }}
              onSkip={() => setSkipped(s => new Set(s).add(pairKeyOf(current.a, current.b)))} />
          ) : (
            <div className="rounded-[20px] bg-pt-surface p-6 text-center">
              <p className="text-pt-text text-[20px] font-bold">{live.length ? 'Nothing left in this list ✓' : 'No doubles left ✓'}</p>
              <p className="text-pt-muted text-[16px] mt-1">{live.length ? 'Pick another list above, or come back to the ones you skipped.' : `The app compared ${checked.toLocaleString()} props.`}</p>
              <div className="mt-4 space-y-2">
                {skipped.size > 0 && <button onClick={() => setSkipped(new Set())} className="w-full rounded-2xl min-h-[48px] bg-white/[0.08] text-pt-text text-[16px] font-semibold">Show the {skipped.size} skipped</button>}
                <button onClick={() => navigate('/cleanup')} className="w-full rounded-2xl min-h-[48px] bg-pt-accent text-stone-900 text-[16px] font-bold">Back to Clean up</button>
              </div>
            </div>
          )}
        </>}
      </div>

      {bulk && <BulkSheet kind={bulk} pairs={bulk === 'sure' ? live.filter(p => p.tier === 'sure') : aiSure} byId={byId}
        onClose={() => setBulk('')} combine={combine} onDone={n => { setBulk(''); setToast(`Combined ${n} ✓`) }} />}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  )
}

function PairCard({ pair, a, b, where, left, aiResting, onCombine, onDifferent, onSkip }: {
  pair: DoublePair; a: Item; b: Item; where: (id?: string) => string; left: number; aiResting: boolean
  onCombine: (keepId: string, mode: 'copies' | 'angles') => Promise<void>; onDifferent: () => Promise<void>; onSkip: () => void
}) {
  const [keepId, setKeepId] = useState(() => bestToKeep([a, b]).id)
  const [step, setStep] = useState<'ask' | 'how'>('ask')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [zoom, setZoom] = useState('')
  const keep = keepId === a.id ? a : b, other = keep === a ? b : a
  const ai = pair.signals.ai
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn() } catch (e) { setErr(friendlyError(e)); setBusy(false) } }
  return (
    <div className="rounded-[24px] bg-pt-surface p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className={`rounded-full px-3 py-1 text-[14px] font-semibold ${TIER_TONE[pair.tier]}`}>{TIER_LABEL[pair.tier]}</span>
        {reasonsOf(pair.signals).filter(r => r !== 'Same picture').map(r => <span key={r} className="rounded-full px-2.5 py-1 text-[12px] bg-white/[0.08] text-pt-muted">{r}</span>)}
        <span className="ml-auto text-pt-muted text-[14px]">{left} left</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[a, b].map(p => (
          <div key={p.id} className={`rounded-2xl p-2 ${p.id === keep.id ? 'bg-pt-accent/15 ring-2 ring-pt-accent' : 'bg-white/[0.04]'}`}>
            <button onClick={() => p.photos[0] && setZoom(p.photos[0])} className="block w-full aspect-square rounded-xl overflow-hidden bg-black" aria-label={`Zoom in on ${p.name}`}>
              {p.photos[0] ? <img src={thumbOf(p, p.photos[0])} alt="" className="w-full h-full object-cover" /> : <span className="grid place-items-center h-full text-pt-muted text-sm">No photo</span>}
            </button>
            <p className="mt-1.5 text-pt-text text-[16px] font-semibold leading-tight line-clamp-2">{p.name}</p>
            <p className="text-pt-muted text-[14px]">{where(p.binId)} · {p.quantity}</p>
            {step === 'how' && <button onClick={() => setKeepId(p.id)} className={`mt-1 tap min-h-[36px] text-[14px] font-bold ${p.id === keep.id ? 'text-pt-accent' : 'text-pt-muted'}`}>{p.id === keep.id ? 'Keeping this one ✓' : 'Keep this one'}</button>}
          </div>
        ))}
      </div>
      {ai ? (
        <p className={`rounded-2xl px-3 py-2 text-[14px] ${ai.same ? 'bg-violet-500/15 text-violet-100' : 'bg-white/[0.06] text-pt-muted'}`}>
          ✦ AI: {ai.same ? 'looks like the same thing' : 'looks different'}{ai.confidence === 'high' ? '' : ' (not sure)'}{ai.reason ? `. ${ai.reason}` : ''}</p>
      ) : pair.tier !== 'sure' && !aiResting ? <p className="px-1 text-pt-muted text-[14px]">✦ The AI is looking at these two…</p> : null}

      {step === 'ask' ? (
        <>
          <p className="text-center text-pt-text text-[20px] font-bold">Same thing?</p>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => run(onDifferent)} className="flex-1 rounded-2xl min-h-[56px] bg-white/[0.08] text-pt-text text-[17px] font-semibold disabled:opacity-40">No, different</button>
            <button disabled={busy} onClick={() => pair.tier === 'sure' ? run(() => onCombine(keep.id, 'angles')) : setStep('how')}
              className="flex-1 rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[17px] font-bold shadow-gold disabled:opacity-40">{busy ? 'Combining…' : 'Yes, combine'}</button>
          </div>
          <button onClick={onSkip} className="w-full tap min-h-[44px] text-pt-muted text-[16px]">Not sure, skip ›</button>
        </>
      ) : (
        <div className="space-y-2">
          <button disabled={busy} onClick={() => run(() => onCombine(keep.id, 'angles'))} className="w-full rounded-2xl p-4 text-left bg-pt-accent text-stone-900 disabled:opacity-40">
            <b className="block text-[18px]">One prop, photographed twice</b>
            <span className="block text-[16px]">Keep one entry with {Math.max(keep.quantity, other.quantity)}</span></button>
          <button disabled={busy} onClick={() => run(() => onCombine(keep.id, 'copies'))} className="w-full rounded-2xl p-4 text-left bg-white/[0.08] text-pt-text disabled:opacity-40">
            <b className="block text-[18px]">We have separate copies</b>
            <span className="block text-[16px] text-pt-muted">Add them up: {keep.quantity} + {other.quantity} = {keep.quantity + other.quantity}</span></button>
          <button onClick={() => setStep('ask')} className="w-full tap min-h-[44px] text-pt-muted text-[16px]">‹ Back</button>
        </div>
      )}
      {err && <p className="rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
      {zoom && <ImageLightbox src={zoom} alt="" onClose={() => setZoom('')} />}
    </div>
  )
}

// Combine many at once: every exact copy, or the pairs the AI is sure about (each one shown first, untick any that's wrong).
function BulkSheet({ kind, pairs, byId, onClose, combine, onDone }: {
  kind: 'sure' | 'ai'; pairs: DoublePair[]; byId: Map<string, Item>; onClose: () => void
  combine: (p: DoublePair, keepId: string, mode: 'copies' | 'angles') => Promise<void>; onDone: (n: number) => void
}) {
  const [off, setOff] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [err, setErr] = useState('')
  const list = pairs.slice(0, 200)
  const picked = list.filter(p => !off.has(pairKeyOf(p.a, p.b)))
  async function go() {
    setBusy(true); setErr('')
    let n = 0
    // One at a time: after each merge the next pair may point at the prop that was just kept (chains of three).
    const gone = new Set<string>()
    for (const p of picked) {
      const a = byId.get(p.a), b = byId.get(p.b)
      if (!a || !b || gone.has(p.a) || gone.has(p.b)) continue
      const keep = bestToKeep([a, b])
      try { await combine(p, keep.id, 'angles'); gone.add(keep.id === a.id ? b.id : a.id); n++; setDone(n) }
      catch (e) { setErr(`${n} combined, then: ${friendlyError(e)}`); setBusy(false); return }
    }
    onDone(n)
  }
  return (
    <BottomSheet open onClose={busy ? () => {} : onClose} title={kind === 'sure' ? `Combine ${picked.length} exact copies?` : `Combine ${picked.length}?`}>
      <p className="text-pt-muted text-[16px]">{kind === 'sure' ? 'Each pair is the very same picture. One entry stays (with the higher count); the other goes.' : 'Untick any pair that isn\'t the same thing. Each combined pair keeps one entry with the higher count; fix the count after if they were separate copies.'}</p>
      <div className="mt-3 max-h-[45vh] overflow-y-auto space-y-2">
        {list.map(p => {
          const a = byId.get(p.a), b = byId.get(p.b), k = pairKeyOf(p.a, p.b), on = !off.has(k)
          if (!a || !b) return null
          return (
            <button key={k} disabled={busy} onClick={() => setOff(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })}
              className={`w-full flex items-center gap-2 rounded-2xl p-2 text-left ${on ? 'bg-white/[0.06]' : 'bg-transparent opacity-50'}`}>
              <span className={`w-6 h-6 rounded-md grid place-items-center text-[14px] font-bold shrink-0 ${on ? 'bg-pt-accent text-stone-900' : 'border-2 border-white/30'}`}>{on ? '✓' : ''}</span>
              <PropThumb item={a} size={52} /><PropThumb item={b} size={52} />
              <span className="min-w-0 text-[14px] text-pt-text leading-tight"><span className="block truncate">{a.name}</span><span className="block truncate text-pt-muted">{b.name}</span></span>
            </button>
          )
        })}
      </div>
      {busy && <div className="mt-3"><div className="h-2 rounded-full bg-white/[0.08] overflow-hidden"><div className="h-full bg-green-500 transition-all" style={{ width: `${Math.round((done / Math.max(1, picked.length)) * 100)}%` }} /></div>
        <p className="text-pt-muted text-[14px] mt-1">{done} of {picked.length} combined… keep this screen open.</p></div>}
      {err && <p className="mt-3 rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
      <button disabled={busy || !picked.length} onClick={go} className="mt-3 w-full rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[18px] font-bold disabled:opacity-40">{busy ? 'Combining…' : `Combine ${picked.length}`}</button>
    </BottomSheet>
  )
}
