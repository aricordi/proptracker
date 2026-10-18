import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import BottomSheet from './BottomSheet'
import ProofPhotos from './ProofPhotos'
import {
  addSuggestion, applySuggestion, resolveSuggestion, subscribeToItemSuggestions, hasChanges,
  type Suggestion, type ProposedChanges,
} from '../services/suggestions'
import { CONDITION_LABELS } from './ItemCard'
import { formatDay } from '../lib/dates'
import type { Condition, Item } from '../types'

const FIELD: Record<keyof ProposedChanges, string> = { name: 'Name', quantity: 'How many', condition: 'Condition', description: 'Description' }

// What the suggestion would change, as "Name: Old → New".
export function ChangesList({ s, item }: { s: Suggestion; item?: Item }) {
  if (!hasChanges(s.changes)) return null
  const current = (k: keyof ProposedChanges) => {
    const v = item?.[k]
    return k === 'condition' && v ? CONDITION_LABELS[v as Condition] : v ?? '—'
  }
  const shown = (k: keyof ProposedChanges, v: unknown) => k === 'condition' ? CONDITION_LABELS[v as Condition] : String(v)
  return (
    <div className="space-y-0.5">
      {(Object.keys(FIELD) as (keyof ProposedChanges)[]).filter(k => s.changes[k] !== undefined && s.changes[k] !== '').map(k => (
        <p key={k} className="text-xs text-pt-muted">{FIELD[k]}: {item ? <>{String(current(k))} → </> : null}<span className="text-pt-text">{shown(k, s.changes[k])}</span></p>
      ))}
    </div>
  )
}

// Staff: one suggestion with Apply / Dismiss.
export function SuggestionCard({ s, item, showProp }: { s: Suggestion; item?: Item; showProp?: boolean }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null)
    try { await fn() } catch { setError("Couldn't save. Try again.") } finally { setBusy(false) }
  }
  return (
    <div className="bg-pt-surface shadow-hairline rounded-xl p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-pt-text text-sm">
          {showProp && <><button onClick={() => navigate(`/item/${s.itemId}`)} className="font-medium text-pt-accent">{s.itemName}</button> · </>}
          <span className="text-pt-muted">{s.byName || s.by} · {formatDay(s.at.slice(0, 10))}</span>
        </p>
        {s.status !== 'open' && <span className={`text-xs shrink-0 ${s.status === 'applied' ? 'text-green-400' : 'text-pt-muted'}`}>{s.status}</span>}
      </div>
      <p className="text-pt-text text-sm whitespace-pre-wrap">“{s.message}”</p>
      <ChangesList s={s} item={item} />
      {!!s.photos?.length && (
        <div className="flex gap-2">{s.photos.map(u => <a key={u} href={u} target="_blank" rel="noreferrer"><img loading="lazy" decoding="async" src={u} alt="" className="w-16 h-16 rounded-lg object-cover" /></a>)}</div>
      )}
      {s.reply && <p className="text-pt-muted text-xs">Reply: {s.reply}</p>}
      {error && <p className="text-red-300 text-xs">{error}</p>}
      {s.status === 'open' && (replying ? (
        <div className="space-y-2">
          <input value={reply} onChange={e => setReply(e.target.value)} placeholder="Optional reply to the creator" autoFocus
            className="w-full bg-pt-bg border border-pt-border rounded-lg px-3 py-2 text-pt-text text-sm focus:outline-none focus:border-pt-accent" />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setReplying(false)} className="py-2 rounded-lg shadow-hairline text-pt-text text-sm">Back</button>
            <button disabled={busy} onClick={() => run(() => resolveSuggestion(s.id, 'dismissed', reply))} className="py-2 rounded-lg bg-pt-bg shadow-hairline text-pt-text text-sm font-medium disabled:opacity-40">Dismiss</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button disabled={busy} onClick={() => setReplying(true)} className="py-2 rounded-lg shadow-hairline text-pt-muted text-sm">Dismiss…</button>
          {hasChanges(s.changes)
            ? <button disabled={busy} onClick={() => run(() => applySuggestion(s))} className="py-2 rounded-lg bg-pt-accent text-stone-900 text-sm font-semibold disabled:opacity-40">{busy ? 'Applying…' : 'Apply changes'}</button>
            : <button disabled={busy} onClick={() => run(() => resolveSuggestion(s.id, 'applied'))} className="py-2 rounded-lg bg-pt-accent text-stone-900 text-sm font-semibold disabled:opacity-40">Fixed it ✓</button>}
        </div>
      ))}
    </div>
  )
}

// On the prop page: creators suggest edits and see their suggestions; staff see open ones.
export default function PropSuggestions({ item }: { item: Item }) {
  const { isStaff, profile } = useSession()
  const [list, setList] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => subscribeToItemSuggestions(item.id, isStaff ? null : profile.email, setList), [item.id, isStaff, profile.email])

  if (isStaff) {
    if (!list.length) return null
    return (
      <div className="space-y-2">
        <p className="text-amber-300 text-xs uppercase tracking-wider">Suggested edits from creators ({list.length})</p>
        {list.map(s => <SuggestionCard key={s.id} s={s} item={item} />)}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {list.map(s => (
        <div key={s.id} className="bg-pt-surface shadow-hairline rounded-xl px-3 py-2">
          <p className="text-pt-text text-sm">Your suggestion: “{s.message}”</p>
          <p className={`text-xs ${s.status === 'applied' ? 'text-green-400' : 'text-pt-muted'}`}>
            {s.status === 'open' ? 'Waiting for the arts department' : s.status === 'applied' ? 'Fixed, thank you!' : `Not changed${s.reply ? `: ${s.reply}` : ''}`}
          </p>
        </div>
      ))}
      <button onClick={() => setOpen(true)} className="w-full py-3 rounded-xl shadow-hairline text-pt-muted text-sm active:opacity-70">
        Something wrong? Suggest an edit
      </button>
      {open && <SuggestSheet item={item} onClose={() => setOpen(false)} />}
    </div>
  )
}

function SuggestSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const { profile } = useSession()
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [condition, setCondition] = useState<Condition | ''>('')
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')

  async function send() {
    setState('busy')
    try {
      const changes: ProposedChanges = {
        ...(name.trim() && name.trim() !== item.name ? { name: name.trim().slice(0, 200) } : {}),
        ...(quantity && Number(quantity) !== item.quantity ? { quantity: Math.max(1, Math.floor(Number(quantity))) } : {}),
        ...(condition && condition !== item.condition ? { condition } : {}),
        ...(description.trim() ? { description: description.trim().slice(0, 300) } : {}),
      }
      await addSuggestion({ itemId: item.id, itemName: item.name, byName: profile.name || profile.email, message: message.trim().slice(0, 1000), changes, ...(photos.length ? { photos } : {}) })
      onClose()
    } catch { setState('error') }
  }

  const input = 'w-full bg-pt-bg border border-pt-border rounded-lg px-3 py-2 text-pt-text text-sm placeholder-pt-muted focus:outline-none focus:border-pt-accent'
  const label = 'text-pt-muted text-xs uppercase tracking-wider'
  return (
    <BottomSheet open onClose={onClose} title="Suggest an edit">
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className={label}>What's wrong?</span>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} autoFocus
            placeholder="e.g. There are only 8 chairs, not 10 / the sleeve is torn / this is a cowboy hat, not a top hat"
            className={input} />
        </label>
        <p className="text-pt-muted text-xs">Optional: fill in the correct details so the arts department can fix it in one tap.</p>
        <label className="block space-y-1"><span className={label}>Correct name</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={item.name} className={input} /></label>
        <div className="flex gap-2">
          <label className="block space-y-1 w-24"><span className={label}>How many</span>
            <input type="number" min={1} value={quantity} onChange={e => setQuantity(e.target.value)} placeholder={String(item.quantity)} className={input} /></label>
          <label className="block space-y-1 flex-1"><span className={label}>Condition</span>
            <select value={condition} onChange={e => setCondition(e.target.value as Condition | '')} className={input}>
              <option value="">No change</option>
              {(['good', 'fair', 'damaged'] as Condition[]).map(c => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
            </select></label>
        </div>
        <label className="block space-y-1"><span className={label}>Better description</span>
          <input value={description} onChange={e => setDescription(e.target.value)} className={input} /></label>
        <ProofPhotos cameraOnly={false} folder={`request-photos/${profile.email}`} urls={photos} onChange={setPhotos} onUploading={setUploading}
          label="Photo (optional)" hint="e.g. show the damage" max={5} />
        {state === 'error' && <p className="text-red-300 text-sm">Couldn't send. Try again.</p>}
        <button onClick={send} disabled={!message.trim() || uploading || state === 'busy'}
          className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">
          {state === 'busy' ? 'Sending…' : 'Send to the arts department'}
        </button>
      </div>
    </BottomSheet>
  )
}

// Creators: a quick "Wrong name?" link under the prop's name (names are what the AI gets wrong most).
export function WrongNameLink({ item }: { item: Item }) {
  const { profile } = useSession()
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const clean = name.trim().slice(0, 200)

  async function send() {
    setState('busy')
    try {
      await addSuggestion({ itemId: item.id, itemName: item.name, byName: profile.name || profile.email,
        message: note.trim().slice(0, 1000) || 'Wrong name', changes: { name: clean } })
      setOpen(false); setSent(true); setName(''); setNote(''); setState('idle')
    } catch { setState('error') }
  }

  const input = 'w-full bg-pt-bg border border-pt-border rounded-lg px-3 py-2 text-pt-text text-sm placeholder-pt-muted focus:outline-none focus:border-pt-accent'
  return (
    <>
      {sent
        ? <p className="text-green-400 text-xs mt-1">Thanks! Sent to the arts department.</p>
        : <button onClick={() => setOpen(true)} className="text-pt-accent text-xs mt-1 active:opacity-70 tap">Wrong name?</button>}
      {open && (
        <BottomSheet open onClose={() => setOpen(false)} title="Suggest the right name">
          <div className="space-y-3">
            <p className="text-pt-muted text-sm">Now called: <span className="text-pt-text">{item.name}</span></p>
            <label className="block space-y-1"><span className="text-pt-muted text-xs uppercase tracking-wider">Correct name</span>
              <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. Cowboy hat" className={input} /></label>
            <label className="block space-y-1"><span className="text-pt-muted text-xs uppercase tracking-wider">Note (optional)</span>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. it's a cowboy hat, not a top hat" className={input} /></label>
            {state === 'error' && <p className="text-red-300 text-sm">Couldn't send. Try again.</p>}
            <button onClick={send} disabled={!clean || clean === item.name || state === 'busy'}
              className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">
              {state === 'busy' ? 'Sending…' : 'Send to the arts department'}
            </button>
          </div>
        </BottomSheet>
      )}
    </>
  )
}
