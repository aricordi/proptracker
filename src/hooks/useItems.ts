import { useState, useEffect, useMemo } from 'react'
import { onSnapshot, query, collection, where, orderBy } from 'firebase/firestore'
import { db } from '../firebase'
import { normalizeItem } from '../services/itemShape'
import { useSession } from '../auth'
import type { Item } from '../types'

// ONE live copy of the props list for the whole app (owner, Nov 2: "a bit laggy").
// Before, every screen opened its own listener, so each visit to Browse re-read and re-decoded
// ~1,200 props from the phone's storage (2–3 s of a frozen screen on a mid-range phone). Now the
// list stays in memory while the app is open: screens get it instantly and share the same array.
type Scope = 'all' | 'company'
interface Store { items: Item[]; ready: boolean; subs: Set<(i: Item[]) => void>; stop?: () => void; linger?: ReturnType<typeof setTimeout> }
const stores = new Map<Scope, Store>()
const LINGER_MS = 30 * 60_000   // keep listening this long after the last screen using it closes

function storeFor(scope: Scope): Store {
  let s = stores.get(scope)
  if (!s) { s = { items: [], ready: false, subs: new Set() }; stores.set(scope, s) }
  return s
}
function start(scope: Scope, s: Store) {
  if (s.stop) return
  const col = collection(db, 'items')
  const q = scope === 'all' ? query(col, orderBy('updatedAt', 'desc')) : query(col, where('collection', '==', 'company'), orderBy('updatedAt', 'desc'))
  s.stop = onSnapshot(q, snap => {
    // Only re-shape the props that changed; the others keep their object (cheaper, and lists don't redraw them).
    const old = new Map(s.items.map(i => [i.id, i]))
    const changed = new Set(snap.docChanges().map(c => c.doc.id))
    s.items = snap.docs.map(d => (!changed.has(d.id) && old.get(d.id)) || normalizeItem(d.id, d.data()))
    s.ready = true
    s.subs.forEach(f => f(s.items))
  }, () => {   // signed out / not allowed: forget it so the next sign-in starts fresh
    s.stop = undefined; s.ready = false; s.items = []
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
    if (!s.subs.size) s.linger = setTimeout(() => { s.stop?.(); s.stop = undefined; s.ready = false; s.linger = undefined }, LINGER_MS)
  }
}
// Start loading in the background right after sign-in, so Browse opens with the list already there.
export function warmItems(scope: Scope) { return watch(scope, () => {}) }

// The props this person may see. The owner gets everything (personal props
// included) unless previewing another role with "View as".
export function useItems() {
  const { realRole, viewingAs } = useSession()
  const scope: Scope = realRole === 'owner' ? 'all' : 'company'
  const [items, setItems] = useState<Item[]>(() => stores.get(scope)?.items ?? [])
  useEffect(() => watch(scope, setItems), [scope])
  return useMemo(() => viewingAs ? items.filter(i => i.collection === 'company') : items, [items, viewingAs])
}
