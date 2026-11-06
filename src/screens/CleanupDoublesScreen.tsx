// Same photo twice (owner, Nov 6). Two kinds of sure doubles, each shown as a group with one button:
//   • the very same picture on two props (the server compares the stored files' fingerprints; free, no AI),
//   • the same name in the same bin (worked out on the phone).
// The crew taps "Make it one prop" (or says they're copies to add up the count), or "Not the same" to hide the group.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useItems } from '../hooks/useItems'
import { inCleanup, sameNameSameBin, bestToKeep, groupPairKeys } from '../lib/cleanup'
import { findSamePhotos } from '../services/cleanup'
import { mergeProps } from '../services/importer'
import { dismissDuplicatePairs } from '../services/health'
import { CleanupHeader, Toast, useBinLabel } from '../components/cleanup/Parts'
import ImageLightbox from '../components/ImageLightbox'
import { friendlyError } from '../lib/errors'
import { thumbOf } from '../services/itemShape'
import type { Item } from '../types'

export default function CleanupDoublesScreen() {
  const navigate = useNavigate()
  const items = useItems()
  const byId = useMemo(() => new Map(items.filter(inCleanup).map(i => [i.id, i])), [items])
  const binInfo = useBinLabel()
  const [photoGroups, setPhotoGroups] = useState<string[][] | null>(null)
  const [err, setErr] = useState('')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState('')
  const [tab, setTab] = useState<'photo' | 'name'>('photo')

  async function look() {
    setErr(''); setPhotoGroups(null)
    try { setPhotoGroups((await findSamePhotos()).data.groups.map(g => g.ids)) } catch (e) { setErr(friendlyError(e)); setPhotoGroups([]) }
  }
  useEffect(() => { void look() }, [])

  // Only props still in the app; groups shrink as doubles get combined.
  const live = (ids: string[]) => ids.map(id => byId.get(id)).filter((x): x is Item => !!x)
  const photo = (photoGroups ?? []).map(live).filter(g => g.length > 1 && !hidden.has(g.map(i => i.id).sort().join()))
  const names = useMemo(() => sameNameSameBin(items), [items]).filter(g => !hidden.has(g.map(i => i.id).sort().join()))
  const groups = tab === 'photo' ? photo : names

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <CleanupHeader title="Same photo twice" />
      <div className="px-4 max-w-[640px] mx-auto space-y-4">
        <div className="flex gap-2">
          {([['photo', `Same picture${photoGroups ? ` · ${photo.length}` : ''}`], ['name', `Same name, same bin · ${names.length}`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`min-h-[44px] inline-flex items-center rounded-full px-4 text-[14px] ${tab === k ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-white/[0.08] text-pt-text'}`}>{l}</button>
          ))}
        </div>
        <p className="text-pt-muted text-[16px]">{tab === 'photo'
          ? 'These props have the very same picture. Almost always the same prop added twice by the import.'
          : 'Same name and the same bin. Either the same prop twice, or copies that should be one prop with a count.'}</p>
        {tab === 'photo' && photoGroups === null && <p className="text-pt-muted text-[16px]">Comparing every photo… (a few seconds)</p>}
        {err && <p className="rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err} <button onClick={look} className="underline">Try again</button></p>}
        {groups.map(g => (
          <Group key={g.map(i => i.id).sort().join()} group={g} where={binInfo.where} samePicture={tab === 'photo'}
            onDone={text => setToast(text)}
            onHide={async () => { await dismissDuplicatePairs(groupPairKeys(g.map(i => i.id))); setHidden(h => new Set(h).add(g.map(i => i.id).sort().join())) }} />
        ))}
        {!groups.length && (tab === 'name' || photoGroups !== null) && !err && (
          <div className="rounded-[20px] bg-pt-surface p-6 text-center">
            <p className="text-pt-text text-[18px] font-semibold">None left ✓</p>
            <p className="text-pt-muted text-[16px] mt-1">{tab === 'photo' ? 'No two props share a picture.' : 'No two props have the same name in the same bin.'}</p>
            <button onClick={() => navigate('/duplicates')} className="mt-4 rounded-2xl min-h-[48px] px-4 bg-white/[0.08] text-pt-text text-[16px] font-semibold">Look for look-alikes too</button>
          </div>
        )}
      </div>
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  )
}

function Group({ group, where, samePicture, onDone, onHide }: { group: Item[]; where: (id?: string) => string; samePicture: boolean; onDone: (t: string) => void; onHide: () => Promise<void> }) {
  const [keepId, setKeepId] = useState(() => bestToKeep(group).id)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [zoom, setZoom] = useState('')
  const keep = group.find(i => i.id === keepId) ?? group[0]
  const others = group.filter(i => i.id !== keep.id)
  const total = group.reduce((n, i) => n + i.quantity, 0)
  async function go(mode: 'copies' | 'angles') {
    setBusy(true); setErr('')
    try { for (const o of others) await mergeProps({ keepId: keep.id, removeId: o.id, mode }); onDone(`Combined into "${keep.name}" ✓`) }
    catch (e) { setErr(friendlyError(e)); setBusy(false) }
  }
  return (
    <div className="rounded-[20px] bg-pt-surface p-3">
      <p className="text-pt-muted text-[14px] px-1">Tap the one to keep</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {group.map(i => (
          <div key={i.id} className={`rounded-2xl p-2 ${i.id === keep.id ? 'bg-pt-accent/15 ring-2 ring-pt-accent' : 'bg-white/[0.04]'}`}>
            <button onClick={() => setKeepId(i.id)} className="block w-full text-left">
              <div className="aspect-square rounded-xl overflow-hidden bg-black">
                {i.photos[0] ? <img src={thumbOf(i, i.photos[0])} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full grid place-items-center text-pt-muted text-sm">No photo</div>}
              </div>
              <span className="block mt-1 text-pt-text text-[16px] font-semibold leading-tight line-clamp-2">{i.name}</span>
              <span className="block text-pt-muted text-[14px]">{where(i.binId)} · {i.quantity}</span>
              {i.id === keep.id && <span className="block text-pt-accent text-[14px] font-bold">Keep this one</span>}
            </button>
            {i.photos[0] && <button onClick={() => setZoom(i.photos[0])} className="tap mt-1 text-pt-muted text-[14px] min-h-[36px]">Zoom</button>}
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {samePicture ? <>
          <button disabled={busy} onClick={() => go('angles')} className="w-full rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[18px] font-bold disabled:opacity-40">{busy ? 'Combining…' : 'Make it one prop'}</button>
          <button disabled={busy} onClick={() => go('copies')} className="w-full rounded-2xl min-h-[48px] bg-white/[0.08] text-pt-text text-[16px] font-semibold disabled:opacity-40">We really have {total}: add up the count</button>
        </> : <>
          <button disabled={busy} onClick={() => go('copies')} className="w-full rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[18px] font-bold disabled:opacity-40">{busy ? 'Combining…' : `They're copies: one prop × ${total}`}</button>
          <button disabled={busy} onClick={() => go('angles')} className="w-full rounded-2xl min-h-[48px] bg-white/[0.08] text-pt-text text-[16px] font-semibold disabled:opacity-40">Same one twice: keep {keep.quantity}</button>
        </>}
        <button disabled={busy} onClick={() => onHide().catch(e => setErr(friendlyError(e)))} className="w-full rounded-2xl min-h-[48px] text-pt-muted text-[16px]">Not the same, leave them</button>
      </div>
      {err && <p className="mt-2 rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
      {zoom && <ImageLightbox src={zoom} alt="" onClose={() => setZoom('')} />}
    </div>
  )
}
