// A bin's page (scan its QR sticker, or tap it on the Bins screen). Staff only.
// BIN-BY-BIN CHECK (owner, Oct 20): take a bin out of the closet, open it here, and make the app match it:
// tick "Here" for each listed prop, "Not here" takes a prop out of this bin (it goes on the Bins screen's
// "Needs a bin" list until someone finds it), "Found something else" moves an existing prop into this bin,
// "+ Add" makes a new prop in this bin. "Done with this bin" marks the bin checked (date + who).
import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { updateBin } from '../services/bins'
import { updateItem } from '../services/items'
import { thumbOf } from '../services/itemShape'
import { useItems } from '../hooks/useItems'
import { useBins } from '../hooks/useBins'
import { useCategories } from '../hooks/useCategories'
import { useSession } from '../auth'
import { formatDay } from '../lib/dates'
import BottomSheet from '../components/BottomSheet'
import type { Item, Location } from '../types'
import { friendlyError } from '../lib/errors'

const errText = (e: unknown) => friendlyError(e, "That didn't save. Check your signal and try again.")

export default function BinQrScreen() {
  const { qrSlug } = useParams<{ qrSlug: string }>()
  const navigate = useNavigate()
  const { profile, user } = useSession()
  const me = profile.name || user.displayName || profile.email
  const allItems = useItems()
  const bins = useBins()
  const categories = useCategories()
  const categoryById = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories])
  const binById = useMemo(() => Object.fromEntries(bins.map(b => [b.id, b])), [bins])
  const bin = bins.find(b => b.qrSlug === qrSlug) ?? null
  const [location, setLocation] = useState<Location | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [notHere, setNotHere] = useState<Item | null>(null)
  const [finding, setFinding] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!bin?.locationId) return
    getDoc(doc(db, 'locations', bin.locationId)).then(d => { if (d.exists()) setLocation({ id: d.id, ...d.data() } as Location) })
  }, [bin?.locationId])

  const binItems = useMemo(() => bin ? allItems.filter(i => i.binId === bin.id && !i.archived).sort((a, b) => a.name.localeCompare(b.name)) : [], [allItems, bin])
  // A prop counts as checked when it was ticked for this bin since the current check started.
  const started = bin?.checkStartedAt ?? ''
  const isChecked = (i: Item) => !!started && i.binCheck?.binId === bin?.id && (i.binCheck?.at ?? '') >= started
  const done = binItems.filter(isChecked).length
  const checking = !!started && (!bin?.checkedAt || started > bin.checkedAt)

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setErr('')
    try { await fn() } catch (e) { setErr(errText(e)) } finally { setBusy('') }
  }
  const stamp = () => new Date().toISOString()
  const startCheck = () => run('start', () => updateBin(bin!.id, { checkStartedAt: stamp() }))
  const here = (i: Item) => run(i.id, () => updateItem(i.id, { binCheck: { binId: bin!.id, at: stamp(), by: me } }))
  const takeOut = (i: Item) => run(i.id, async () => {
    await updateItem(i.id, { binId: '', locationId: '', lostFromBin: bin!.label })
    setNotHere(null)
  })
  const moveHere = (i: Item) => run(i.id, async () => {
    await updateItem(i.id, { binId: bin!.id, locationId: bin!.locationId ?? '', lostFromBin: '', binCheck: { binId: bin!.id, at: stamp(), by: me } })
    setFinding(false); setQ('')
  })
  const finish = () => run('finish', async () => { await updateBin(bin!.id, { checkedAt: stamp(), checkedBy: me }); navigate('/bins') })

  // "Found something else": any prop not already in this bin, by name.
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const found = words.length ? allItems.filter(i => !i.archived && i.binId !== bin?.id && words.every(w => i.name.toLowerCase().includes(w))).slice(0, 20) : []

  if (!bins.length) return <div className="p-6 pt-safe text-pt-muted text-sm">Loading…</div>
  if (!bin) {
    return (
      <div className="p-6 pt-safe text-center">
        <p className="text-pt-muted text-sm mb-4">Bin not found. It may have been deleted.</p>
        <button onClick={() => navigate('/')} className="text-pt-accent text-sm underline tap">Go home</button>
      </div>
    )
  }

  const photo = (i: Item) => i.photos?.[0] ? thumbOf(i, i.photos[0]) : i.photoUrl
  const thumb = (i: Item) => (
    <div className="w-14 h-14 rounded-xl bg-pt-border overflow-hidden shrink-0">
      {photo(i) && <img loading="lazy" decoding="async" src={photo(i)} alt="" className="w-full h-full object-cover" />}
    </div>
  )

  return (
    <div className="min-h-screen bg-pt-bg pb-32">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="tap text-pt-accent text-[17px] py-2">‹ Back</button>
          <p className="text-pt-muted text-xs">{location?.name}</p>
        </div>
        <h1 className="font-display text-[34px] text-pt-text leading-tight">{bin.label}</h1>
        {checking ? (
          <div className="mt-2">
            <div className="flex justify-between text-xs text-pt-muted mb-1"><span>Checking: {done} of {binItems.length} ticked</span>{bin.checkedAt && <span>Last done {formatDay(bin.checkedAt.slice(0, 10))}</span>}</div>
            <div className="h-1.5 rounded-full bg-pt-border overflow-hidden"><div className="h-full bg-pt-accent transition-all" style={{ width: `${binItems.length ? done / binItems.length * 100 : 100}%` }} /></div>
          </div>
        ) : (
          <p className={`text-sm mt-1 ${bin.checkedAt ? 'text-green-400' : 'text-pt-muted'}`}>{bin.checkedAt ? `✓ Checked ${formatDay(bin.checkedAt.slice(0, 10))}${bin.checkedBy ? ` by ${bin.checkedBy.split(' ')[0]}` : ''}` : 'Not checked yet'}</p>
        )}
      </div>

      <div className="px-4 pt-2 space-y-4">
        {err && <p className="text-red-300 text-sm">{err}</p>}
        {!checking && (
          <button disabled={!!busy} onClick={startCheck} className="w-full bg-pt-accent text-stone-900 py-4 rounded-2xl font-bold shadow-gold disabled:opacity-40">
            {bin.checkedAt ? 'Check this bin again' : 'Check this bin'}
          </button>
        )}
        {checking && <p className="text-pt-muted text-sm">Look in the bin. Tick <b className="text-pt-text">Here</b> for what you see, <b className="text-pt-text">Not here</b> for what's missing.</p>}

        <p className="text-pt-muted text-xs px-1">{binItems.length} prop{binItems.length === 1 ? '' : 's'} in the app</p>
        {binItems.length === 0 && <p className="text-pt-muted text-sm text-center py-4">Nothing in this bin in the app yet.</p>}
        {binItems.map(i => {
          const ok = isChecked(i)
          return (
            <div key={i.id} className={`flex items-center gap-3 rounded-2xl p-3 ${ok ? 'bg-green-500/10 shadow-[inset_0_0_0_0.5px_rgba(74,222,128,0.4)]' : 'bg-pt-surface shadow-hairline'}`}>
              <button onClick={() => navigate(`/item/${i.id}`)} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                {thumb(i)}
                <span className="min-w-0">
                  <span className="block text-pt-text font-medium text-sm truncate">{i.name}</span>
                  <span className="block text-pt-muted text-xs">{categoryById[i.categoryId]?.label ?? i.categoryId}{i.quantity > 1 ? ` · ×${i.quantity}` : ''}</span>
                </span>
              </button>
              {checking && (ok
                ? <span className="shrink-0 text-green-400 text-sm font-semibold px-2">✓ Here</span>
                : <span className="shrink-0 flex gap-2">
                    <button disabled={busy === i.id} onClick={() => setNotHere(i)} className="rounded-xl px-3 min-h-[44px] text-sm bg-pt-border text-pt-text disabled:opacity-40">Not here</button>
                    <button disabled={busy === i.id} onClick={() => here(i)} className="rounded-xl px-3 min-h-[44px] text-sm font-bold bg-pt-accent text-stone-900 disabled:opacity-40">Here</button>
                  </span>)}
            </div>
          )
        })}

        {checking && (
          <div className="space-y-2 pt-2">
            <p className="text-pt-muted text-xs px-1">Something in the bin that isn't listed?</p>
            <button onClick={() => setFinding(true)} className="w-full bg-pt-surface shadow-hairline text-pt-text rounded-2xl py-4 font-semibold">It's in the app → move it here</button>
            <button onClick={() => navigate(`/add?binId=${bin.id}&locationId=${bin.locationId ?? ''}`)} className="w-full bg-pt-surface shadow-hairline text-pt-text rounded-2xl py-4 font-semibold">It's not in the app → add it</button>
          </div>
        )}
        {!checking && (
          <button onClick={() => navigate(`/add?binId=${bin.id}&locationId=${bin.locationId ?? ''}`)} className="w-full bg-pt-surface shadow-hairline text-pt-text rounded-2xl py-4 font-semibold">+ Add a prop to this bin</button>
        )}
      </div>

      {checking && (
        <div className="fixed left-0 right-0 bottom-0 px-4 pt-3 pb-safe bg-pt-bg z-20">
          <button disabled={!!busy || done < binItems.length} onClick={finish}
            className="w-full mb-3 rounded-2xl py-4 font-bold bg-pt-accent text-stone-900 shadow-gold disabled:opacity-40">
            {done < binItems.length ? `Tick every prop first (${binItems.length - done} left)` : 'Done with this bin ✓'}
          </button>
        </div>
      )}

      <BottomSheet open={!!notHere} onClose={() => setNotHere(null)} title="Not in this bin?">
        {notHere && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">{thumb(notHere)}<p className="text-pt-text font-semibold">{notHere.name}</p></div>
            <p className="text-pt-muted text-sm">It comes out of {bin.label} and goes on the <b className="text-pt-text">Needs a bin</b> list (Bins screen) until someone finds it. Nothing is deleted.</p>
            <button disabled={busy === notHere.id} onClick={() => takeOut(notHere)} className="w-full rounded-2xl py-4 font-bold bg-pt-accent text-stone-900 shadow-gold disabled:opacity-40">Take it out of {bin.label}</button>
            <button onClick={() => { const id = notHere.id; setNotHere(null); navigate(`/item/${id}/edit`) }} className="w-full rounded-2xl py-3 font-semibold bg-pt-bg text-pt-text">I know where it is → set its bin</button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={finding} onClose={() => setFinding(false)} title={`Move into ${bin.label}`}>
        <div className="space-y-3">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type the prop's name"
            className="w-full bg-pt-bg border border-pt-border rounded-xl px-4 py-3 text-pt-text text-base focus:outline-none focus:border-pt-accent" />
          {words.length > 0 && found.length === 0 && <p className="text-pt-muted text-sm">No prop with that name. Add it as a new prop instead.</p>}
          {found.map(i => (
            <div key={i.id} className="flex items-center gap-3 bg-pt-bg rounded-2xl p-3">
              {thumb(i)}
              <span className="flex-1 min-w-0">
                <span className="block text-pt-text text-sm font-medium truncate">{i.name}</span>
                <span className="block text-pt-muted text-xs">{i.binId ? `Now in ${binById[i.binId]?.label ?? 'another bin'}` : i.lostFromBin ? `Needs a bin (was in ${i.lostFromBin})` : 'No bin'}</span>
              </span>
              <button disabled={busy === i.id} onClick={() => moveHere(i)} className="shrink-0 rounded-xl px-3 min-h-[44px] text-sm font-bold bg-pt-accent text-stone-900 disabled:opacity-40">Move here</button>
            </div>
          ))}
        </div>
      </BottomSheet>
    </div>
  )
}
