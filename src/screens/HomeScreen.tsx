import { useRef, useState, useEffect, useMemo } from 'react'
import { useItems } from '../hooks/useItems'
import { useTags } from '../hooks/useTags'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import { useCategories } from '../hooks/useCategories'
import { useSession } from '../auth'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { useHideOnScroll } from '../hooks/useHideOnScroll'
import BrandMark from '../components/BrandMark'
import { useGearCart } from '../gearCart'
import { useActiveShoot } from '../activeShoot'
import AddingToBar, { BrowseTabs } from '../components/AddingToBar'
import IdeasSheet, { IdeasButton } from '../components/IdeasSheet'

// Folds part of the header away (smoothly) and makes it untappable while hidden.
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  useEffect(() => { if (inner.current) (inner.current as HTMLDivElement & { inert: boolean }).inert = !open }, [open])
  return (
    <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
      <div ref={inner} className="overflow-hidden min-h-0" aria-hidden={!open}>{children}</div>
    </div>
  )
}

type AvailabilityFilter = Availability | 'all' | 'archived'

const AVAILABILITY_OPTIONS: { value: AvailabilityFilter; label: string; staffOnly?: boolean }[] = [
  { value: 'all',         label: 'Any status' },
  { value: 'available',   label: 'Available' },
  { value: 'checked-out', label: 'Checked out' },
  { value: 'damaged',     label: 'Damaged' },
  { value: 'archived',    label: 'Archived', staffOnly: true },
]

export default function HomeScreen() {
  const { isStaff, isOwner, shootFlow } = useSession()
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
  const [ideas, setIdeas] = useState(false)
  const today = todayInStudio()
  const minStart = earliestStart(today, settings, isStaff)
  const active = useActiveShoot()
  // Creators see availability for the shoot they're adding to; staff pick any day.
  const dates = cart.start && cart.end && (isStaff || active.shoot) ? { start: cart.start, end: cart.end } : null

  // With shoot dates picked, "free" means free for those dates (incl. turnaround).
  const freeFor = (i: Item) => dates
    ? freeForRange({ quantity: i.quantity, missingQty: i.missingQty, legacyCheckedOut: i.status === 'checked-out' },
        bookings[i.id] ?? [], dates.start, dates.end, today, turnaround(i), settings)
    : null

  // ?q= lets other screens open a search (e.g. "find something similar").
  const [params] = useSearchParams()
  const [query, setQuery] = useState(() => params.get('q') ?? '')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (params.get('focus')) searchRef.current?.focus() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
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

  // Creators with a shoot picked: + on the photo adds one (tap again to take it out).
  const quickAdd = (item: Item) => shootFlow && active.shoot && !item.archived && item.condition !== 'damaged' && (freeFor(item) ?? 0) > 0
    ? () => cart.setQty(item.id, cart.lines[item.id] ? 0 : 1)
    : undefined
  const card = (item: Item) => (
    <ItemCard key={item.id} item={item} subtitle={subtitle(item)} badge={badgeFor(item)} inCart={cart.lines[item.id]} onAdd={quickAdd(item)} />
  )

  const filtersActive = !!categoryFilter || availability !== 'all'
  // Scrolling down through the photos folds the header away (the search box stays);
  // scrolling up brings it back. Never while the date picker is open.
  const { ref: headerRef, hidden: folded, show: unfold } = useHideOnScroll<HTMLDivElement>(!showDates)
  const activeCategory = categoryFilter ? categories.find(c => c.id === categoryFilter)?.label : null
  const nothingAtAll = allItems.length === 0

  return (
    <div className="min-h-full bg-pt-bg">
      {/* Sticky header + search */}
      <div ref={headerRef} className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <Collapse open={!folded}>
          <h1 className="font-display text-3xl text-pt-text py-2 flex items-center gap-2.5"><BrandMark className="w-10 text-pt-text" title="" /><span className="flex-1">{shootFlow ? 'Browse' : 'Props'}</span>{shootFlow && <IdeasButton small onClick={() => setIdeas(true)} />}</h1>
          {shootFlow && <div className="mb-3"><BrowseTabs /></div>}
        </Collapse>
        {folded && <div className="h-3" />}

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
            className="w-full bg-pt-surface border border-pt-border rounded-xl pl-10 pr-10 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent text-base"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-pt-muted text-xl leading-none"
            >
              ×
            </button>
          )}
        </div>

        {/* Folded: one tappable line saying what's filtered, so nothing is a surprise. */}
        {folded && (dates || filtersActive) && (
          <button onClick={unfold} className="mt-2 w-full text-left text-xs text-pt-muted truncate">
            {[dates && `📅 ${formatRange(dates.start, dates.end)}`, activeCategory, availability !== 'all' && AVAILABILITY_OPTIONS.find(o => o.value === availability)?.label]
              .filter(Boolean).join(' · ')} <span className="text-pt-accent">Show filters</span>
          </button>
        )}

        <Collapse open={!folded}>
        {isOwner && (
          <div className="flex gap-1 mt-3 p-1 bg-pt-surface border border-pt-border rounded-xl">
            {(['company', 'personal'] as PropCollection[]).map(c => (
              <button key={c} onClick={() => pickCollection(c)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium ${shownCollection === c ? 'bg-pt-accent text-stone-900' : 'text-pt-muted'}`}>
                {COLLECTION_LABELS[c]}
              </button>
            ))}
          </div>
        )}

        {/* Category chips */}
        <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
          {[{ id: null as string | null, label: 'All' }, ...categories.filter(c => c.active).map(c => ({ id: c.id as string | null, label: c.label }))].map(({ id, label }) => (
            <button
              key={label}
              onClick={() => setCategoryFilter(id)}
              className={`shrink-0 px-3 py-1 rounded-full text-sm transition-colors ${
                categoryFilter === id
                  ? 'bg-pt-accent text-stone-900 font-medium'
                  : 'bg-pt-surface border border-pt-border text-pt-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Availability */}
        <div className="flex items-center justify-between gap-3 mt-2">
          <select
            value={availability}
            onChange={e => setAvailability(e.target.value as AvailabilityFilter)}
            aria-label="Availability"
            className={`bg-pt-surface border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none ${
              availability === 'all' ? 'border-pt-border text-pt-muted' : 'border-pt-accent text-pt-accent'
            }`}
          >
            {AVAILABILITY_OPTIONS.filter(o => isStaff || !o.staffOnly).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="text-pt-muted text-xs">
            {matched.length} prop{matched.length !== 1 ? 's' : ''}
            {filtersActive && (
              <button onClick={() => { setCategoryFilter(null); setAvailability('all') }} className="ml-2 text-pt-accent">
                Clear filters
              </button>
            )}
          </span>
        </div>

        {/* Shoot dates (creators: the shoot they're adding to) */}
        {shootFlow && <div className="mt-3"><AddingToBar kind="props" /></div>}
        {/* Staff can also pick any day (the owner: when not adding to one of their shoots) */}
        {!isStaff || active.shoot ? null : showDates || !dates ? (
          showDates ? (
            <div className="mt-3 space-y-2">
              <DateRangePicker start={cart.start} end={cart.end} min={minStart}
                maxDays={1}
                onChange={(s, e) => cart.setDates(s, e)}
                leadTimeNote={!isStaff && settings.leadTimeDays > 0
                  ? `Props must be booked ${settings.leadTimeDays} open day${settings.leadTimeDays > 1 ? 's' : ''} ahead. Earliest: ${formatDay(minStart)}.`
                  : undefined} />
              <button onClick={() => setShowDates(false)} className="w-full py-2 rounded-xl bg-pt-accent text-stone-900 text-sm font-semibold">
                {dates ? 'Show what’s free' : 'Done'}
              </button>
            </div>
          ) : (
            <button onClick={() => setShowDates(true)}
              className="mt-3 w-full py-2.5 rounded-xl border border-dashed border-pt-accent/60 text-pt-accent text-sm font-medium active:opacity-70">
              📅 Pick your shoot day to see what’s free
            </button>
          )
        ) : (
          <button onClick={() => setShowDates(true)}
            className="mt-3 w-full flex items-center justify-between py-2 px-3 rounded-xl bg-pt-accent/10 border border-pt-accent/40 text-sm active:opacity-70">
            <span className="text-pt-text">📅 {formatRange(dates.start, dates.end)}</span>
            <span className="text-pt-accent text-xs">Change</span>
          </button>
        )}
        </Collapse>
      </div>

      <div className="p-4">
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
            {q && !similarLoading && (
              <button onClick={() => navigate('/reserve')} className="mt-3 text-violet-300 text-sm font-medium">
                🛠️ Don't have it? Ask the arts department to make or find it
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

        <div className={cart.count + gearCart.count > 0 ? 'h-20' : 'h-4'} />
      </div>

      {/* The shoot being put together (props + gear) */}
      {cart.count + gearCart.count > 0 && (
        <div className="sticky bottom-3 px-4">
          <button onClick={() => navigate('/reserve')}
            className="w-full flex items-center justify-between bg-pt-accent text-stone-900 rounded-2xl px-4 py-3.5 shadow-lg font-semibold active:opacity-90">
            <span>Your shoot · {[cart.count && `${cart.count} prop${cart.count !== 1 ? 's' : ''}`, gearCart.count && `${gearCart.count} gear`].filter(Boolean).join(' · ')}</span>
            <span>Review →</span>
          </button>
        </div>
      )}
      {shootFlow && <IdeasSheet open={ideas} onClose={() => setIdeas(false)} />}
    </div>
  )
}
