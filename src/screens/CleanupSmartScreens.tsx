// Smart fixes for the clean-up (owner, Nov 6: "use AI or logic to make it easy for them to approve"):
//   /cleanup/approve  Quick approve: props that already look complete, 30 at a time, all ticked. Untick what's wrong, approve.
//   /cleanup/place    Put props in their bin: no bin, but their photo folder is named like a bin. One tap per bin (or all).
//   /cleanup/names    Fix odd names with AI: the AI looks at each photo and suggests a name; accept, edit or skip.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useItems } from '../hooks/useItems'
import { inCleanup, looksComplete, shelfOrder, binGuesses, oddName } from '../lib/cleanup'
import { markChecked, moveToBin, saveChecked, suggestPropNames, loadDoubles, cachedDoubles } from '../services/cleanup'
import { CleanupHeader, Toast, PropThumb, useBinLabel } from '../components/cleanup/Parts'
import QuickEdit from '../components/cleanup/QuickEdit'
import { friendlyError } from '../lib/errors'
import { thumbOf } from '../services/itemShape'
import type { Item } from '../types'

const PAGE = 30

/** Ids of props in a "same picture" or "very likely" double, so Quick approve never approves a double by accident. */
function useDoubleIds(): { ids: Set<string>; ready: boolean } {
  const [pairs, setPairs] = useState(() => cachedDoubles()?.pairs ?? null)
  useEffect(() => { if (!pairs) loadDoubles().then(r => setPairs(r.pairs)).catch(() => setPairs([])) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => ({ ids: new Set((pairs ?? []).filter(p => p.tier !== 'maybe').flatMap(p => [p.a, p.b])), ready: pairs !== null }), [pairs])
}

export function CleanupApproveScreen() {
  const navigate = useNavigate()
  const items = useItems()
  const binInfo = useBinLabel()
  const doubles = useDoubleIds()
  const [later, setLater] = useState<Set<string>>(new Set())   // unticked: left for a closer look
  const [off, setOff] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Item | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null)
  const all = useMemo(() => shelfOrder(items.filter(i => looksComplete(i, doubles.ids) && !later.has(i.id)), binInfo.label), [items, doubles.ids, later, binInfo])
  const page = all.slice(0, PAGE)
  const ticked = page.filter(i => !off.has(i.id))
  const toggle = (id: string) => setOff(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function approve() {
    setBusy(true); setErr('')
    try {
      await markChecked(ticked.map(i => i.id))
      setLater(s => { const n = new Set(s); page.filter(i => off.has(i.id)).forEach(i => n.add(i.id)); return n })
      setOff(new Set())
      setToast({ text: `${ticked.length} approved ✓` })
      document.querySelector('main')?.scrollTo({ top: 0 })
    } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-full bg-pt-bg flex flex-col">
      <CleanupHeader title="Quick approve" sub={<p className="text-pt-muted text-[14px]">{all.length.toLocaleString()} props look complete</p>} />
      <div className="flex-1 px-4 max-w-[720px] w-full mx-auto space-y-3 pb-4">
        <p className="text-pt-muted text-[16px]">These have a real name, a bin and a photo, and no doubles. Glance at each one: <b className="text-pt-text">untick</b> any that look wrong (they wait for a closer look), tap the photo to fix it here, then approve the page.</p>
        {!doubles.ready && <p className="rounded-2xl bg-pt-surface px-4 py-3 text-pt-muted text-[16px]">Checking for doubles first…</p>}
        {doubles.ready && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {page.map(i => {
              const on = !off.has(i.id)
              return (
                <div key={i.id} className={`relative rounded-2xl overflow-hidden bg-pt-surface ${on ? 'ring-2 ring-green-500/70' : 'opacity-60'}`}>
                  <button onClick={() => setEditing(i)} className="block w-full aspect-square bg-black" aria-label={`Fix ${i.name}`}>
                    {i.photos[0] && <img src={thumbOf(i, i.photos[0])} alt="" className="w-full h-full object-cover" loading="lazy" />}
                  </button>
                  <button onClick={() => toggle(i.id)} aria-pressed={on} aria-label={on ? 'Untick' : 'Tick'}
                    className="absolute top-1.5 left-1.5 w-11 h-11 grid place-items-center">
                    <span className={`w-7 h-7 rounded-full grid place-items-center text-[16px] font-bold ${on ? 'bg-green-600 text-white' : 'bg-black/70 border-2 border-white/60'}`}>{on ? '✓' : ''}</span>
                  </button>
                  <span className="absolute top-2 right-2 rounded-full bg-black/70 text-white text-[14px] font-bold px-2 py-0.5">×{i.quantity}</span>
                  <button onClick={() => toggle(i.id)} className="block w-full text-left px-2 py-2">
                    <span className="block text-pt-text text-[14px] font-semibold leading-tight line-clamp-2">{i.name}</span>
                    <span className="block text-pt-muted text-[12px] truncate">{binInfo.label(i.binId)}</span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {doubles.ready && !page.length && (
          <div className="rounded-[20px] bg-pt-surface p-6 text-center">
            <p className="text-pt-text text-[20px] font-bold">Nothing left to quick-approve ✓</p>
            <p className="text-pt-muted text-[16px] mt-1">{later.size ? `${later.size} you unticked wait in Check props one by one.` : 'The rest need a closer look.'}</p>
            <button onClick={() => navigate('/cleanup/check?f=todo')} className="mt-4 w-full rounded-2xl min-h-[52px] bg-pt-accent text-stone-900 text-[16px] font-bold">Check the rest one by one</button>
          </div>
        )}
        {err && <p className="rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
      </div>
      {page.length > 0 && (
        <div className="sticky bottom-0 z-10 bg-pt-bg px-4 pt-2 pb-3 shadow-[0_-12px_16px_-8px_rgba(0,0,0,0.9)]">
          <button disabled={busy || !ticked.length} onClick={approve} className="w-full max-w-[720px] mx-auto block rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[18px] font-bold shadow-gold disabled:opacity-40">
            {busy ? 'Saving…' : `Approve ${ticked.length} ✓`}</button>
        </div>
      )}
      {editing && <QuickEdit item={editing} items={items} onClose={() => setEditing(null)} onDone={(text, undo) => { setEditing(null); setToast({ text, undo }) }} />}
      {toast && <Toast text={toast.text} onUndo={toast.undo} onDone={() => setToast(null)} />}
    </div>
  )
}

export function CleanupPlaceScreen() {
  const items = useItems()
  const binInfo = useBinLabel()
  const groups = useMemo(() => [...binGuesses(items, binInfo.bins).entries()]
    .sort((a, b) => binInfo.bins.findIndex(x => x.id === a[0]) - binInfo.bins.findIndex(x => x.id === b[0])), [items, binInfo])
  const total = groups.reduce((n, [, l]) => n + l.length, 0)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  async function place(list: [string, Item[]][], key: string) {
    setBusy(key); setErr('')
    let n = 0
    try { for (const [binId, props] of list) { await moveToBin(props.map(p => p.id), binId, binInfo.locationOf(binId)); n += props.length } setToast(`${n} put in their bin ✓`) }
    catch (e) { setErr(`${n ? `${n} done, then: ` : ''}${friendlyError(e)}`) } finally { setBusy('') }
  }
  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <CleanupHeader title="Put in their bin" back="/cleanup/bins" />
      <div className="px-4 max-w-[640px] mx-auto space-y-3">
        <p className="text-pt-muted text-[16px]">These props have no bin, but the Google Drive folder their photo came from is named like a bin. Check the photos, then put them there.</p>
        {total > 1 && groups.length > 1 && <button disabled={!!busy} onClick={() => place(groups, 'all')} className="w-full rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[18px] font-bold shadow-gold disabled:opacity-40">{busy === 'all' ? 'Saving…' : `Put all ${total} in their bins`}</button>}
        {err && <p className="rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
        {groups.map(([binId, props]) => (
          <div key={binId} className="rounded-[20px] bg-pt-surface p-3 space-y-2">
            <p className="text-pt-text text-[18px] font-bold px-1">{binInfo.where(binId)} <span className="text-pt-muted text-[14px] font-normal">· {props.length} prop{props.length === 1 ? '' : 's'} · folder "{props[0].importedFrom?.folder}"</span></p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">{props.slice(0, 12).map(p => <div key={p.id} className="shrink-0 w-20"><PropThumb item={p} size={80} /><p className="text-[12px] text-pt-muted leading-tight line-clamp-2 mt-1">{p.name}</p></div>)}</div>
            <button disabled={!!busy} onClick={() => place([[binId, props]], binId)} className="w-full rounded-2xl min-h-[48px] bg-white/[0.08] text-pt-text text-[16px] font-semibold disabled:opacity-40">{busy === binId ? 'Saving…' : `Put them in ${binInfo.label(binId)}`}</button>
          </div>
        ))}
        {!groups.length && <div className="rounded-[20px] bg-pt-surface p-6 text-center"><p className="text-pt-text text-[18px] font-semibold">Nothing to place ✓</p><p className="text-pt-muted text-[16px] mt-1">Props still without a bin are in Work by bin → No bin yet.</p></div>}
      </div>
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  )
}

export function CleanupNamesScreen() {
  const items = useItems()
  const binInfo = useBinLabel()
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const odd = useMemo(() => shelfOrder(items.filter(i => inCleanup(i) && oddName(i.name) && !skipped.has(i.id)), binInfo.label), [items, binInfo, skipped])
  const [ideas, setIdeas] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const page = odd.slice(0, 12)
  const missing = page.filter(i => ideas[i.id] === undefined).map(i => i.id)
  async function ask() {
    setBusy(true); setErr('')
    try {
      const r = (await suggestPropNames({ ids: missing })).data
      if (r.resting) setErr('The AI is resting until the 1st (monthly budget). You can still type names.')
      setIdeas(s => ({ ...s, ...Object.fromEntries(missing.map(id => [id, r.names[id] ?? ''])) }))
    } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }
  useEffect(() => { if (missing.length && !busy && !err) void ask() }, [missing.join()])   // eslint-disable-line react-hooks/exhaustive-deps
  async function accept(list: Item[]) {
    setErr('')
    let n = 0
    try { for (const i of list) { const v = (ideas[i.id] ?? '').trim(); if (v && v !== i.name) { await saveChecked(i.id, { name: v }, false); n++ } } setToast(`${n} renamed ✓`) }
    catch (e) { setErr(friendlyError(e)) }
  }
  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <CleanupHeader title="Fix names with AI" sub={<p className="text-pt-muted text-[14px]">{odd.length} odd name{odd.length === 1 ? '' : 's'} left</p>} />
      <div className="px-4 max-w-[640px] mx-auto space-y-3">
        <p className="text-pt-muted text-[16px]">Names like "IMG_2034" or "Item" that nobody would search. ✦ The AI looked at each photo and suggests a name: change it if it's off, then accept.</p>
        {err && <p className="rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
        {page.length > 0 && <button disabled={busy} onClick={() => accept(page)} className="w-full rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[18px] font-bold shadow-gold disabled:opacity-40">{busy ? '✦ Thinking…' : (n => n === 1 ? 'Accept 1 name' : `Accept these ${n} names`)(page.filter(i => (ideas[i.id] ?? '').trim()).length)}</button>}
        <ul className="space-y-2">
          {page.map(i => (
            <li key={i.id} className="rounded-[20px] bg-pt-surface p-2 flex gap-3">
              <PropThumb item={i} size={72} />
              <div className="flex-1 min-w-0">
                <p className="text-pt-muted text-[14px] line-through truncate">{i.name}</p>
                <input value={ideas[i.id] ?? ''} onChange={e => setIdeas(s => ({ ...s, [i.id]: e.target.value }))} placeholder={ideas[i.id] === undefined ? '✦ Thinking…' : 'Type a name'} maxLength={200}
                  className="mt-1 w-full bg-pt-bg rounded-xl px-3 min-h-[44px] text-[16px] font-semibold text-pt-text placeholder:text-pt-muted outline-none focus:ring-2 focus:ring-pt-accent" />
                <div className="flex items-center justify-between"><p className="text-pt-muted text-[12px] truncate">{binInfo.where(i.binId)}</p>
                  <button onClick={() => setSkipped(s => new Set(s).add(i.id))} className="tap min-h-[36px] text-pt-muted text-[14px]">Skip</button></div>
              </div>
            </li>
          ))}
        </ul>
        {!odd.length && <div className="rounded-[20px] bg-pt-surface p-6 text-center"><p className="text-pt-text text-[18px] font-semibold">No odd names left ✓</p></div>}
      </div>
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  )
}
