import { useRef, useState, useEffect, useMemo, useLayoutEffect } from 'react'
import { useItems } from '../hooks/useItems'
import { useTags } from '../hooks/useTags'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import { useCategories } from '../hooks/useCategories'
import { useSession } from '../auth'
import { useNavigate, useSearchParams, useNavigationType } from 'react-router-dom'
import ItemCard, { type Badge } from '../components/ItemCard'
import DateRangePicker from '../components/DateRangePicker'
import LateBanner from '../components/LateBanner'
import { COLLECTION_LABELS, type PropCollection } from '../../functions/src/collections'
import { useMyLateBookings } from '../hooks/useLateBookings'
import { useBookings, useBookingSettings } from '../hooks/useBookings'
import { useCart } from '../cart'
import { useTurnaround } from '../hooks/useTurnaround'
import { freeForRange, todayInStudio, earliestStart } from '../../functions/src/booking'
import { formatDay, formatRange } from '../lib/dates'
import { searchSimilar } from '../services/ai'
import { matchesQuery, availabilityOf, byName, type Availability } from '../lib/search'
import { SIMILAR_MIN_SCORE } from '../config'
import type { Item } from '../types'
import BrandMark from '../components/BrandMark'
import { useGearCart } from '../gearCart'
import { useActiveShoot } from '../activeShoot'
import { BrowseTabs, AddingToChip, useAddingNote } from '../components/AddingToBar'
import { useAddWithoutShoot } from '../components/AddWithoutShoot'
import MyRequestsButton from '../components/MyRequestsButton'
import BottomSheet from '../components/BottomSheet'
import { readRequestDraft, writeRequestDraft } from '../lib/requestDraft'
import AiButton from '../components/AiButton'
import { Icon } from '../components/Icon'

type AvailabilityFilter = Availability | 'all' | 'archived'

const AVAILABILITY_OPTIONS: { value: AvailabilityFilter; label: string; staffOnly?: boolean }[] = [
  { value: 'all',         label: 'Any status' },
  { value: 'available',   label: 'Available' },
  { value: 'checked-out', label: 'Checked out' },
  { value: 'damaged',     label: 'Damaged' },
  { value: 'archived',    label: 'Archived', staffOnly: true },
]

export default function HomeScreen() {
  const { isStaff, isOwner, shootFlow, canBook } = useSession()
  // Owner only: switch between Prime Capitol's props and your own.
  const [collection, setCollection] = useState<PropCollection>(() => {
    try { return localStorage.getItem('pt-collection') === 'personal' ? 'personal' : 'company' } catch { return 'company' }
  })
  const pickCollection = (c: PropCollection) => { setCollection(c); try { localStorage.setItem('pt-collection', c) } catch { /* ignore */ } }
  const shownCollection: PropCollection = isOwner ? collection : 'company'
  const allItems   = useItems()
  const tags       = useTags()
  const locations  = useLocations()
  const bins       = useBins()
  const categories = useCategories()
  const bookings   = useBookings()
  const settings   = useBookingSettings()
  const late       = useMyLateBookings()
  const cart       = useCart()
  const gearCart   = useGearCart()
  const turnaround = useTurnaround()
  const navigate   = useNavigate()
  const [showDates, setShowDates] = useState(false)
  const today = todayInStudio()
  const minStart = earliestStart(today, settings, isStaff)
  const active = useActiveShoot()
  const [params, setParams] = useSearchParams()
  // ?toRequest=<id>&day=<date> (owner, Oct 20): searching from "Change your request" opens the whole closet;
  // + adds to that request's draft (src/lib/requestDraft.ts), "Back to your request" takes it back to Save.
  const toRequest = params.get('toRequest')
  const reqDay = params.get('day')
  const [draft, setDraft] = useState(() => toRequest ? readRequestDraft(toRequest) : null)
  // Creators see availability for the shoot they're adding to; staff pick any day.
  const dates = toRequest && reqDay ? { start: reqDay, end: reqDay } : cart.start && cart.end && (isStaff || active.shoot) ? { start: cart.start, end: cart.end } : null

  // With shoot dates picked, "free" means free for those dates (incl. turnaround).
  const freeFor = (i: Item) => dates
    ? freeForRange({ quantity: i.quantity, missingQty: i.missingQty, legacyCheckedOut: i.status === 'checked-out' },
        bookings[i.id] ?? [], dates.start, dates.end, today, turnaround(i), settings)
    : null

  // ?q= lets other screens open a search (e.g. "find something similar"), and keeps your search when you come back.
  const [query, setQuery] = useState(() => params.get('q') ?? '')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (params.get('focus')) searchRef.current?.focus() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const [categoryFilter, setCategoryFilter] = useState<string | null>(() => params.get('cat'))
  const [filtersOpen, setFiltersOpen] = useState(false)
  // The search and category live in the address, so Back from a prop page lands on the same results.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params)
      if (query.trim()) next.set('q', query); else next.delete('q')
      if (categoryFilter) next.set('cat', categoryFilter); else next.delete('cat')
      next.delete('focus')
      if (next.toString() !== params.toString()) setParams(next, { replace: true })
    }, 250)
    return () => clearTimeout(t)
  }, [query, categoryFilter])   // eslint-disable-line react-hooks/exhaustive-deps
  const [availability, setAvailability] = useState<AvailabilityFilter>('all')
  const [similarIds, setSimilarIds] = useState<string[]>([])
  const [similarLoading, setSimilarLoading] = useState(false)

  const q = query.trim()

  // Ask the server for similar-meaning props 600ms after typing stops.
  useEffect(() => {
    setSimilarIds([])
    if (q.length < 3) { setSimilarLoading(false); return }
    let cancelled = false
    setSimilarLoading(true)
    const timer = setTimeout(() => {
      searchSimilar(q).then(results => {
        if (cancelled) return
        setSimilarIds(results.filter(r => r.score >= SIMILAR_MIN_SCORE).map(r => r.id))
        setSimilarLoading(false)
      })
    }, 600)
    return () => { clearTimeout(timer); cancelled = true }
  }, [q])

  const tagById      = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags])
  const locationById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations])
  const binById      = useMemo(() => Object.fromEntries(bins.map(b => [b.id, b])), [bins])
  const categoryById = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories])

  // Filters apply to both exact and similar results.
  const filtered = useMemo(
    () => allItems
      .filter(i =>
        (availability === 'archived' ? i.archived : !i.archived)
        && (availability === 'all' || availability === 'archived' || (
          dates && availability === 'available'
            ? (freeFor(i) ?? 0) > 0 && i.condition !== 'damaged'
            : availabilityOf(i) === availability))
        && i.collection === shownCollection
        && (!categoryFilter || i.categoryId === categoryFilter))
      .sort(byName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allItems, availability, categoryFilter, dates?.start, dates?.end, bookings, turnaround, settings, shownCollection],
  )

  const matched = useMemo(
    () => q ? filtered.filter(i => matchesQuery(i, q, tagById)) : filtered,
    [filtered, q, tagById],
  )

  const similar = useMemo(() => {
    if (!q) return []
    const exact = new Set(matched.map(i => i.id))
    const byId = new Map(filtered.map(i => [i.id, i]))
    return similarIds.filter(id => !exact.has(id)).map(id => byId.get(id)).filter((i): i is Item => !!i).slice(0, 8)
  }, [q, matched, filtered, similarIds])

  function subtitle(item: Item) {
    const category = categoryById[item.categoryId]?.label ?? ''
    if (!isStaff) return category
    const where = [item.locationId && locationById[item.locationId]?.name, item.binId && binById[item.binId]?.label]
      .filter(Boolean).join(' › ')
    return where || category
  }

  function badgeFor(item: Item): Badge | undefined {
    if (!dates || item.archived) return undefined
    if (item.condition === 'damaged') return { label: 'Damaged', style: 'bg-red-500/90 text-white' }
    const free = freeFor(item) ?? 0
    if (free === 0) return { label: 'Booked', style: 'bg-stone-900/90 text-red-300' }
    if (item.quantity > 1) return { label: `${free} of ${item.quantity} free`, style: 'bg-green-500/90 text-stone-900' }
    return { label: 'Free', style: 'bg-green-500/90 text-stone-900' }
  }

  // Creators with a shoot picked: + on the photo adds one; with more free, − n + right there.
  // Adding to a sent request: the same, into that request's draft.
  const draftQty = (id: string) => draft?.lines[id] ?? 0
  const setDraftQty = (id: string, n: number) => {
    if (!draft || !toRequest) return
    const next = { ...draft, lines: { ...draft.lines, [id]: n } }
    if (n <= 0 && !(draft.orig[id] > 0)) delete next.lines[id]
    setDraft(next); writeRequestDraft(toRequest, next)
  }
  const canAdd = (item: Item) => !item.archived && item.condition !== 'damaged'
  const noShoot = useAddWithoutShoot()
  const qtyProps = (item: Item) => {
    if (toRequest) {
      if (!canAdd(item)) return {}
      return { inCart: draftQty(item.id), max: Math.max(1, (freeFor(item) ?? item.quantity) + (draft?.orig[item.id] ?? 0)), onQty: (n: number) => setDraftQty(item.id, n) }
    }
    // No shoot picked yet: + still works, it asks which shoot (or books one) instead of a dead end.
    if (shootFlow && canBook && !active.shoot && canAdd(item) && !(item.missingQty && item.missingQty >= item.quantity))
      return { inCart: cart.lines[item.id], onAdd: () => noShoot.open(item.name, 'props', item.id) }
    if (!(shootFlow && active.shoot && !note.late && canAdd(item) && (freeFor(item) ?? 0) > 0)) return { inCart: cart.lines[item.id] }
    return { inCart: cart.lines[item.id], max: freeFor(item) ?? 1, onQty: (n: number) => cart.setQty(item.id, n) }
  }
  // Cards settle in one after another (first dozen only, 30 ms apart) as the list appears.
  const card = (item: Item, i: number) => (
    <div key={item.id} className="rise-in" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
      <ItemCard item={item} subtitle={subtitle(item)} badge={badgeFor(item)} {...qtyProps(item)} />
    </div>
  )

  const filtersActive = !!categoryFilter || availability !== 'all'
  const nothingAtAll = allItems.length === 0
  const note = useAddingNote('props')
  const draftAdded = draft ? Object.entries(draft.lines).filter(([id, n]) => n > (draft.orig[id] ?? 0)).length : 0

  // Back from a prop page: the same spot in the list (owner, Oct 20).
  const navType = useNavigationType()
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = rootRef.current?.closest<HTMLElement>('.overflow-y-auto')
    if (!box) return
    const save = () => { try { sessionStorage.setItem('pc.browseScroll', String(box.scrollTop)) } catch { /* private mode */ } }
    box.addEventListener('scroll', save, { passive: true })
    return () => box.removeEventListener('scroll', save)
  }, [])
  const restored = useRef(false)
  useLayoutEffect(() => {
    if (restored.current || navType !== 'POP' || !allItems.length) return
    restored.current = true
    const box = rootRef.current?.closest<HTMLElement>('.overflow-y-auto')
    let top = 0
    try { top = Number(sessionStorage.getItem('pc.browseScroll') || 0) } catch { /* private mode */ }
    if (box && top) box.scrollTop = top
  }, [allItems.length, navType])

  const chip = (on: boolean) => `shrink-0 px-3 py-1 rounded-full text-sm ${on ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`
  return (
    <div ref={rootRef} className="min-h-full bg-pt-bg">
      {/* Title and tabs scroll away with the page (owner, Oct 20: the old fold-away header was choppy). */}
      <div className="pt-safe px-4">
        <h1 className="font-display text-[30px] leading-tight text-pt-text flex items-center gap-2.5">
          <BrandMark className="w-8 text-pt-text" title="" /><span className="flex-1">{toRequest ? 'Add to your request' : shootFlow ? 'Browse' : 'Props'}</span>
          {shootFlow && !toRequest && <><AiButton mode="props" /><MyRequestsButton /></>}
        </h1>
        {shootFlow && !toRequest && <div className="mt-2.5"><BrowseTabs /></div>}
        {isOwner && !toRequest && (
          <div className="flex gap-1 mt-2.5 p-1 bg-pt-surface shadow-hairline rounded-xl">
            {(['company', 'personal'] as PropCollection[]).map(c => (
              <button key={c} onClick={() => pickCollection(c)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium ${shownCollection === c ? 'bg-pt-accent text-stone-900' : 'text-pt-muted'}`}>
                {COLLECTION_LABELS[c]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Search + one row of chips stay pinned under the status bar. */}
      <div className="sticky z-10 bg-pt-bg px-4 pt-2.5 pb-2" style={{ top: 'env(safe-area-inset-top)' }}>
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-pt-muted pointer-events-none">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search props, costumes, set dressing…"
            enterKeyHint="search"
            aria-label="Search props"
            className="w-full bg-pt-surface border border-pt-border rounded-xl pl-10 pr-10 py-2.5 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent text-base"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 text-pt-muted text-xl leading-none">×</button>
          )}
        </div>
        <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar -mx-4 px-4">
          {shootFlow && !toRequest && <AddingToChip kind="props" />}
          {isStaff && !active.shoot && !toRequest && (
            <button onClick={() => setShowDates(v => !v)} className={chip(!!dates)}>
              <Icon name="calendar" className="w-4 h-4 inline -mt-0.5 mr-1" />{dates ? formatRange(dates.start, dates.end) : 'Pick a day'}
            </button>
          )}
          <button onClick={() => setFiltersOpen(true)} className={chip(availability !== 'all')}>
            {availability === 'all' ? 'Status' : AVAILABILITY_OPTIONS.find(o => o.value === availability)?.label} <span aria-hidden className="text-xs">▾</span>
          </button>
          {[{ id: null as string | null, label: 'All' }, ...categories.filter(c => c.active).map(c => ({ id: c.id as string | null, label: c.label }))].map(({ id, label }) => (
            <button key={label} onClick={() => setCategoryFilter(id)} className={chip(categoryFilter === id)}>{label}</button>
          ))}
        </div>
        {/* Staff: any day (the owner, when not adding to one of their shoots) */}
        {showDates && isStaff && !active.shoot && (
          <div className="mt-2 space-y-2">
            <DateRangePicker start={cart.start} end={cart.end} min={minStart} maxDays={1} onChange={(st, en) => cart.setDates(st, en)} />
            <button onClick={() => setShowDates(false)} className="w-full py-2 rounded-xl bg-pt-accent text-stone-900 text-sm font-semibold">{dates ? 'Show what’s free' : 'Done'}</button>
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-1">
        <p className="text-xs mb-3 flex items-center gap-2">
          <span className="text-pt-muted shrink-0 whitespace-nowrap">{matched.length} prop{matched.length !== 1 ? 's' : ''}</span>
          {toRequest && reqDay && <span className="text-pt-muted">· free on {formatDay(reqDay)}</span>}
          {shootFlow && !toRequest && <span className={`truncate ${note.late ? 'text-red-300' : 'text-pt-muted'}`}>· {note.text}</span>}
          {filtersActive && <button onClick={() => { setCategoryFilter(null); setAvailability('all') }} className="ml-auto text-pt-accent shrink-0 tap">Clear filters</button>}
        </p>
        {late.length > 0 && <div className="mb-4"><LateBanner late={late} /></div>}
        {nothingAtAll && (
          <p className="text-center mt-16 text-pt-muted text-sm leading-relaxed">
            No props yet.
            {isStaff && <><br />{shootFlow ? <>Open <strong className="text-pt-text">Team → Add a prop</strong></> : <>Tap <strong className="text-pt-text">Add</strong> in the bar below</>} to add your first prop.</>}
          </p>
        )}

        {!nothingAtAll && matched.length === 0 && (
          <div className="text-center mt-10 mb-6">
            <p className="text-pt-text font-medium mb-1">
              {q ? `No exact matches for "${q}"` : 'Nothing matches these filters'}
            </p>
            {q && similarLoading && <p className="text-pt-muted text-sm">Looking for similar props…</p>}
            {q && !similarLoading && similar.length === 0 && (
              <p className="text-pt-muted text-sm">Try a different word.</p>
            )}
            {q && !similarLoading && canBook && !toRequest && (
              <button onClick={() => navigate('/reserve')} className="mt-3 text-violet-300 text-sm font-medium">
                <Icon name="tools" className="w-4 h-4 inline -mt-0.5 mr-1" />Don't have it? Ask the arts department to make or find it
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {matched.map(card)}
        </div>

        {similar.length > 0 && (
          <>
            <div className="flex items-center gap-3 py-4">
              <div className="flex-1 h-px bg-pt-border" />
              <span className="text-pt-muted text-xs whitespace-nowrap">Similar, might work too</span>
              <div className="flex-1 h-px bg-pt-border" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {similar.map(card)}
            </div>
          </>
        )}

        <div className={toRequest || cart.count + gearCart.count > 0 ? 'h-20' : 'h-4'} />
      </div>

      <BottomSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Status">
        <div className="space-y-2">
          {AVAILABILITY_OPTIONS.filter(o => isStaff || !o.staffOnly).map(o => (
            <button key={o.value} onClick={() => { setAvailability(o.value); setFiltersOpen(false) }}
              className={`w-full text-left rounded-xl px-4 py-3 ${availability === o.value ? 'bg-pt-accent/15 text-pt-accent font-semibold' : 'bg-pt-bg text-pt-text'}`}>{o.label}</button>
          ))}
        </div>
      </BottomSheet>

      {/* Adding to a sent request: back to it, with the new props ready to save. */}
      {toRequest ? (
        <div className="sticky bottom-3 px-4">
          <button onClick={() => navigate(`/reservations/${toRequest}`, { replace: true, state: { draft: true } })}
            className="w-full flex items-center justify-between bg-pt-accent text-stone-900 rounded-2xl px-4 py-4 shadow-lg font-semibold active:opacity-90 shadow-gold">
            <span>{draftAdded ? `${draftAdded} new prop${draftAdded !== 1 ? 's' : ''}` : 'Your request'}</span>
            <span>Back to your request</span>
          </button>
        </div>
      ) : canBook && cart.count + gearCart.count > 0 && (
        <div className="sticky bottom-3 px-4">
          <button onClick={() => navigate('/reserve')}
            className="w-full flex items-center justify-between bg-pt-accent text-stone-900 rounded-2xl px-4 py-4 shadow-lg font-semibold active:opacity-90 shadow-gold">
            <span>Your shoot · {[cart.count && `${cart.count} prop${cart.count !== 1 ? 's' : ''}`, gearCart.count && `${gearCart.count} gear`].filter(Boolean).join(' · ')}</span>
            <span>Review</span>
          </button>
        </div>
      )}
      {noShoot.sheet}
    </div>
  )
}
