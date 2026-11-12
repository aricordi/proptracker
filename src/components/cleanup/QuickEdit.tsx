// Fix one prop without leaving the screen (bin view, quick approve): name (with an AI suggestion), how many, bin, category,
// then Save (= checked). Remove and "It's a double" are one tap away. Owner, Nov 6.
import { useState } from 'react'
import BottomSheet from '../BottomSheet'
import { useCategories } from '../../hooks/useCategories'
import { saveChecked, heldUnits, removeProps, restoreProps, suggestPropNames } from '../../services/cleanup'
import { BinSheet, QtyStepper, useBinLabel, ZoomBadge } from './Parts'
import ImageLightbox from '../ImageLightbox'
import { RemoveSheet, DoubleSheet } from '../../screens/CleanupCheckScreen'
import { friendlyError } from '../../lib/errors'
import type { Item } from '../../types'

export default function QuickEdit({ item, items, onClose, onDone }: {
  item: Item; items: Item[]; onClose: () => void; onDone: (toast: string, undo?: () => void) => void
}) {
  const binInfo = useBinLabel()
  const categories = useCategories().filter(c => c.active !== false || c.id === item.categoryId)
  const [name, setName] = useState(item.name)
  const [qty, setQty] = useState(item.quantity)
  const [binId, setBinId] = useState(item.binId ?? '')
  const [locationId, setLocationId] = useState(item.locationId ?? '')
  const [categoryId, setCategoryId] = useState(item.categoryId)
  const [sheet, setSheet] = useState<'' | 'bin' | 'remove' | 'double'>('')
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [err, setErr] = useState('')
  const [zoom, setZoom] = useState(false)
  const changes = {
    ...(name.trim() !== item.name ? { name: name.trim() } : {}),
    ...(qty !== item.quantity ? { quantity: qty } : {}),
    ...(binId !== (item.binId ?? '') ? { binId, locationId: locationId || binInfo.locationOf(binId) } : {}),
    ...(categoryId !== item.categoryId ? { categoryId } : {}),
  }
  async function save() {
    if (!name.trim()) { setErr('Give it a name first.'); return }
    setBusy(true); setErr('')
    try {
      if (qty < item.quantity) { const held = await heldUnits(item.id); if (qty < held) { setErr(`${held} are booked right now, so the count can't go below ${held}.`); setBusy(false); return } }
      await saveChecked(item.id, changes, true)
      onDone(Object.keys(changes).length ? 'Saved and checked ✓' : 'Checked ✓')
    } catch (e) { setErr(friendlyError(e)); setBusy(false) }
  }
  async function suggest() {
    setAiBusy(true); setErr('')
    try {
      const r = (await suggestPropNames({ ids: [item.id] })).data
      if (r.resting) setErr('The AI is resting until the 1st (monthly budget). Type the name instead.')
      else if (r.names[item.id]) setName(r.names[item.id])
      else setErr('The AI had no idea for this one. Type the name instead.')
    } catch (e) { setErr(friendlyError(e)) } finally { setAiBusy(false) }
  }
  return (
    <>
      <BottomSheet open={!sheet} onClose={onClose} title="Fix this prop">
        <div className="space-y-3">
          {item.photos[0] && <button type="button" onClick={() => setZoom(true)} aria-label={`See the photo of ${item.name} bigger`} className="relative block w-full rounded-2xl bg-black overflow-hidden">
            <img src={item.photos[0]} alt="" className="w-full max-h-[30vh] object-contain" /><ZoomBadge className="bottom-2 right-2 !w-8 !h-8" /></button>}
          <div>
            <div className="flex items-center justify-between"><span className="text-pt-muted text-[14px]">Name</span>
              <button onClick={suggest} disabled={aiBusy} className="tap min-h-[36px] text-violet-300 text-[14px] font-semibold disabled:opacity-50">{aiBusy ? 'Thinking…' : '✦ Suggest a name'}</button></div>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={200}
              className="mt-1 w-full bg-pt-bg rounded-2xl px-4 min-h-[52px] text-[18px] font-semibold text-pt-text outline-none focus:ring-2 focus:ring-pt-accent" />
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-pt-bg px-4 py-2"><span className="text-pt-text text-[16px] font-semibold">How many?</span><QtyStepper value={qty} onChange={setQty} /></div>
          <button onClick={() => setSheet('bin')} className="w-full flex items-center justify-between rounded-2xl bg-pt-bg px-4 min-h-[56px] text-left">
            <span><span className="block text-pt-muted text-[14px]">Where is it?</span><span className={`block text-[16px] font-semibold ${binId ? 'text-pt-text' : 'text-amber-300'}`}>{binInfo.where(binId)}</span></span>
            <span className="text-pt-accent text-[16px] font-semibold">Change</span></button>
          <div className="flex flex-wrap gap-2">
            {categories.map(c => <button key={c.id} onClick={() => setCategoryId(c.id)} className={`min-h-[44px] rounded-full px-4 text-[16px] ${categoryId === c.id ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-white/[0.08] text-pt-text'}`}>{c.label}</button>)}
          </div>
          {err && <p className="rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-[16px]">{err}</p>}
          <button disabled={busy} onClick={save} className="w-full rounded-2xl min-h-[56px] bg-pt-accent text-stone-900 text-[18px] font-bold disabled:opacity-40">{busy ? 'Saving…' : Object.keys(changes).length ? 'Save ✓' : 'Looks right ✓'}</button>
          <div className="flex gap-2">
            <button onClick={() => setSheet('remove')} className="flex-1 rounded-2xl min-h-[48px] bg-red-500/15 text-red-200 text-[16px] font-semibold">Remove</button>
            <button onClick={() => setSheet('double')} className="flex-1 rounded-2xl min-h-[48px] bg-white/[0.08] text-pt-text text-[16px] font-semibold">It's a double</button>
          </div>
        </div>
      </BottomSheet>
      {zoom && item.photos[0] && <ImageLightbox src={item.photos[0]} alt={item.name} item={item} onClose={() => setZoom(false)} />}
      <BinSheet open={sheet === 'bin'} current={binId} onClose={() => setSheet('')} onPick={(b, l) => { setBinId(b); setLocationId(l) }} />
      <RemoveSheet open={sheet === 'remove'} name={item.name} onClose={() => setSheet('')} onRemove={async reason => {
        const r = await removeProps([item.id], reason)
        if (r.booked.length) throw new Error(`"${item.name}" is in a booking right now. Remove it once it's back.`)
        onDone(`Removed "${item.name}"`, () => { void restoreProps([item.id]) })
      }} />
      <DoubleSheet open={sheet === 'double'} item={item} items={items} binInfo={binInfo} onClose={() => setSheet('')} onMerged={keep => onDone(`Combined into "${keep.name}"`)} />
    </>
  )
}
