import { useState, useEffect, useMemo } from 'react'
import { onSnapshot, query, collection, where, orderBy, limit } from 'firebase/firestore'
import { db } from '../firebase'
import { normalizeItem } from '../services/itemShape'
import { useSession } from '../auth'
import type { Item } from '../types'

// ONE live copy of the props list for the whole app (owner, Nov 2: "a bit laggy").
// Before, every screen opened its own listener, so each visit to Browse re-read and re-decoded
// ~1,200 props from the phone's storage (2–3 s of a frozen screen on a mid-range phone). Now the
// list stays in memory while the app is open: screens get it instantly and share the same array.
// Nov 8 (owner: "older devices… bad wifi"): on a phone that has never loaded the closet, the full list (~1,600 props) can
// take 10+ s on weak signal, and Firestore only answers once ALL of it has arrived. So a small first page (the newest
// QUICK props) is asked for at the same time and shown straight away; the full list replaces it when it lands. `complete`
// says the whole closet is in (screens show "Loading the rest…" and don't say "No props yet" before that).
type Scope = 'all' | 'company'
const QUICK = 40
interface Store {
  items: Item[]; ready: boolean; complete: boolean; subs: Set<(i: Item[]) => void>
  stop?: () => void; stopQuick?: () => void; linger?: ReturnType<typeof setTimeout>
}
const stores = new Map<Scope, Store>()
const LINGER_MS = 30 * 60_000   // keep listening this long after the last screen using it closes

function storeFor(scope: Scope): Store {
  let s = stores.get(scope)
  if (!s) { s = { items: [], ready: false, complete: false, subs: new Set() }; stores.set(scope, s) }
  return s
}
function start(scope: Scope, s: Store) {
  if (s.stop) return
  const col = collection(db, 'items')
  const base = scope === 'all' ? [orderBy('updatedAt', 'desc')] as const : [where('collection', '==', 'company'), orderBy('updatedAt', 'desc')] as const
  const stopQuick = () => { s.stopQuick?.(); s.stopQuick = undefined }
  // The first page, only until the full list arrives (from the phone's copy that's a fraction of a second, so this mostly
  // matters on a phone's first visit).
  s.stopQuick = onSnapshot(query(col, ...base, limit(QUICK)), snap => {
    if (s.complete) return
    s.items = snap.docs.map(d => normalizeItem(d.id, d.data()))
    s.ready = true
    s.subs.forEach(f => f(s.items))
  }, () => stopQuick())
  s.stop = onSnapshot(query(col, ...base), snap => {
    // Only re-shape the props that changed; the others keep their object (cheaper, and lists don't redraw them).
    const old = new Map(s.items.map(i => [i.id, i]))
    const changed = new Set(snap.docChanges().map(c => c.doc.id))
    s.items = snap.docs.map(d => (!changed.has(d.id) && old.get(d.id)) || normalizeItem(d.id, d.data()))
    s.ready = true
    s.complete = true
    stopQuick()
    s.subs.forEach(f => f(s.items))
  }, () => {   // signed out / not allowed: forget it so the next sign-in starts fresh
    stopQuick()
    s.stop = undefined; s.ready = false; s.complete = false; s.items = []
    s.subs.forEach(f => f([]))
  })
}
function watch(scope: Scope, cb: (i: Item[]) => void) {
  const s = storeFor(scope)
  if (s.linger) { clearTimeout(s.linger); s.linger = undefined }
  s.subs.add(cb)
  start(scope, s)
  if (s.ready) cb(s.items)
  return () => {
    s.subs.delete(cb)
    if (!s.subs.size) s.linger = setTimeout(() => {
      s.stopQuick?.(); s.stopQuick = undefined; s.stop?.(); s.stop = undefined; s.ready = false; s.complete = false; s.linger = undefined
    }, LINGER_MS)
  }
}
// Start loading in the background right after sign-in, so Browse opens with the list already there.
export function warmItems(scope: Scope) { return watch(scope, () => {}) }

// The props this person may see. The owner gets everything (personal props
// included) unless previewing another role with "View as".
// `partial` (Browse only): also take the quick first page while the rest loads. Every other screen gets the list only
// once it's complete, so counts, duplicate checks and "not found" never work from half the closet.
export function useItems(opts: { partial?: boolean } = {}) {
  const { realRole, viewingAs } = useSession()
  const scope: Scope = realRole === 'owner' ? 'all' : 'company'
  const pick = () => { const s = stores.get(scope); return s && (opts.partial || s.complete) ? s.items : [] }
  const [items, setItems] = useState<Item[]>(pick)
  useEffect(() => watch(scope, () => setItems(pick())), [scope, opts.partial])
  return useMemo(() => viewingAs ? items.filter(i => i.collection === 'company') : items, [items, viewingAs])
}

/** Is the props list here yet? `ready` = something to show (maybe only the first page), `complete` = the whole closet. */
export function useItemsStatus(): { ready: boolean; complete: boolean } {
  const { realRole } = useSession()
  const scope: Scope = realRole === 'owner' ? 'all' : 'company'
  const read = () => { const s = stores.get(scope); return { ready: !!s?.ready, complete: !!s?.complete } }
  const [st, setSt] = useState(read)
  useEffect(() => watch(scope, () => setSt(prev => { const n = read(); return n.ready === prev.ready && n.complete === prev.complete ? prev : n })), [scope])
  return st
}
