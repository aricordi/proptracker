import { useRef, useState, useEffect, useMemo, useLayoutEffect } from 'react'
import { useItems, useItemsStatus } from '../hooks/useItems'
import { useTags } from '../hooks/useTags'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import { useCategories } from '../hooks/useCategories'
import { useSession } from '../auth'
import { useNavigate, useSearchParams, useNavigationType } from 'react-router-dom'
import ItemCard, { type Badge } from '../components/ItemCard'
import DateRangePicker from '../components/DateRangePicker'
import LateBanner from '../components/LateBanner'
import { type PropCollection } from '../../functions/src/collections'
import { useMyLateBookings } from '../hooks/useLateBookings'
import { useBookings, useBookingSettings } from '../hooks/useBookings'
import { useCart } from '../cart'
import { useTurnaround } from '../hooks/useTurnaround'
import { freeForRange, todayInStudio, earliestStart } from '../../functions/src/booking'
import { formatDay, formatRange } from '../lib/dates'
import { searchSimilar, photoSearch } from '../services/ai'
import { friendlyError } from '../lib/errors'
import { matchesQuery, availabilityOf, byName, type Availability } from '../lib/search'
import { SIMILAR_MIN_SCORE } from '../config'
import type { Item } from '../types'
import BrandMark from '../components/BrandMark'
import { useGearCart } from '../gearCart'
import { useScheduleSettings } from '../services/schedule'
import { useActiveShoot } from '../activeShoot'
import { AddingToChip, useAddingNote } from '../components/AddingToBar'
import { useAddWithoutShoot } from '../components/AddWithoutShoot'
import MyRequestsButton from '../components/MyRequestsButton'
import BottomSheet from '../components/BottomSheet'
import { readRequestDraft, writeRequestDraft } from '../lib/requestDraft'
import AiButton from '../components/AiButton'
import { useAssistant } from '../assistant'
import { Icon } from '../components/Icon'
import { useHotScores } from '../services/propsLike'
import { hotOrder } from '../../functions/src/hot'

type AvailabilityFilter = Availability | 'all' | 'archived'

const AVAILABILITY_OPTIONS: { value: AvailabilityFilter; label: string; staffOnly?: boolean }[] = [
  { value: 'all',         label: 'Any status' },
  { value: 'available',   label: 'Available' },
  { value: 'checked-out', label: 'Checked out' },
  { value: 'damaged',     label: 'Damaged' },
  { value: 'archived',    label: 'Archived', staffOnly: true },
]

const PAGE = 40

export default function HomeScreen({ personal = false }: { personal?: boolean }) {
  const { isStaff, isOwner, shootFlow, canBook, demo } = useSession()
  const ai = useAssistant()
  // Owner only (Nov 2: "I rarely search my own props"): Browse always shows Prime Capitol's props;
  // the owner's personal props live on their own page, Team → Props & storage → My personal props (/personal).
  const shownCollection: PropCollection = isOwner && personal ? 'personal' : 'company'
  const scrollKey = personal ? 'pc.personalScroll' : 'pc.browseScroll', shownKey = personal ? 'pc.personalShown' : 'pc.browseShown'
  const allItems   = useItems({ partial: true })
  const itemsStatus = useItemsStatus()
  const tags       = useTags()
  const locations  = useLocations()
  const bins       = useBins()
  const categories = useCategories()
  const bookings   = useBookings()
  const settings   = useBookingSettings()
  const late       = useMyLateBookings()
  const cart       = useCart()
  // Gear picked to take on the day isn't part of "Your shoot" while booking gear ahead is off (owner, Nov 3).
  const gearCartAll = useGearCart()
  const gearCart = useScheduleSettings().gearReserve ? gearCartAll : { count: 0 }
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
  // Owner, Nov 7: "hot" first (asked for lately), not A–Z. A–Z stays one tap away in the Status sheet; personal props stay A–Z.
  const [sortBy, setSortBy] = useState<'hot' | 'az'>(() => { try { return sessionStorage.getItem('pc.browseSort') === 'az' ? 'az' : 'hot' } catch { return 'hot' } })
  const hotScores = useHotScores(!personal)
  const useHot = !personal && sortBy === 'hot'
  const [similarIds, setSimilarIds] = useState<string[]>([])
  const [similarLoading, setSimilarLoading] = useState(false)

  const q = query.trim()

  // Snap a photo, find it in the closet (owner, Nov 7): the camera button opens the phone's picker (camera, photos or a
  // screenshot), the AI says what's in it, and the closest props show in their own section at the top.
  const photoInput = useRef<HTMLInputElement>(null)
  // Kept for this visit (like pc.browseScroll): Back from a matching prop shows the same results, so comparing
  // matches doesn't cost another AI use. Only a finished result is kept, and only restored on Back.
  const navType = useNavigationType()
  const rootRef = useRef<HTMLDivElement>(null)
  const photoKey = personal ? 'pc.personalPhoto' : 'pc.photoSearch'
  type PhotoResult = { description: string; ids: string[] }
  const [photo, setPhoto] = useState<{ busy: true } | { error: string } | PhotoResult | null>(() => {
    if (navType !== 'POP') return null
    try {
      const v = JSON.parse(sessionStorage.getItem(photoKey) || 'null')
      return v && typeof v.description === 'string' && Array.isArray(v.ids) ? { description: v.description, ids: v.ids.filter((x: unknown) => typeof x === 'string') } : null
    } catch { return null }
  })
  const keepPhoto = (r: PhotoResult | null) => {
    try { if (r) sessionStorage.setItem(photoKey, JSON.stringify(r)); else sessionStorage.removeItem(photoKey) } catch { /* private mode */ }
  }
  const photoRun = useRef(0)
  async function onPhoto(file: File | undefined) {
    if (!file) return
    const run = ++photoRun.current
    setPhoto({ busy: true })
    keepPhoto(null)
    // The camera sits in the sticky search bar, so the person may be far down the list: bring them up to the results.
    rootRef.current?.closest<HTMLElement>('.overflow-y-auto')?.scrollTo({ top: 0, behavior: 'smooth' })
    try {
      const r = await photoSearch(file)
      if (run === photoRun.current) {
        const result = { description: r.description, ids: r.results.map(x => x.id) }
        setPhoto(result)
        keepPhoto(result)
      }
    } catch (e) {
      if (run === photoRun.current) setPhoto({ error: friendlyError(e, "Couldn't read that photo. Try another one.") })
    }
  }
  const clearPhoto = () => { photoRun.current++; setPhoto(null); keepPhoto(null) }

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
  const unsorted = useMemo(
    () => allItems
      .filter(i =>
        (availability === 'archived' ? i.archived : !i.archived)
        && (availability === 'all' || availability === 'archived' || (
          dates && availability === 'available'
            ? (freeFor(i) ?? 0) > 0 && i.condition !== 'damaged'
            : availabilityOf(i) === availability))
        && i.collection === shownCollection
        && (!categoryFilter || i.categoryId === categoryFilter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allItems, availability, categoryFilter, dates?.start, dates?.end, bookings, turnaround, settings, shownCollection],
  )

  const filtered = useMemo(() => useHot ? hotOrder(unsorted, hotScores, today) : [...unsorted].sort(byName), [unsorted, useHot, hotScores, today])

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

  const photoMatches = useMemo(() => {
    if (!photo || !('ids' in photo)) return []
    const byId = new Map(allItems.filter(i => !i.archived && i.collection === 'company').map(i => [i.id, i]))
    return photo.ids.map(id => byId.get(id)).filter((i): i is Item => !!i)
  }, [photo, allItems])

  function subtitle(item: Item) {
    const category = categoryById[item.categoryId]?.label ?? ''
    if (!isStaff) return category
    const where = [item.locationId && locationById[item.locationId]?.name, item.binId && binById[item.binId]?.label]
      .filter(Boolean).join(' › ')
    return where || category
  }

  function badgeFor(item: Item): Badge | undefined {
    if (!dates || item.archived) return undefined
    if (item.condition === 'damaged') return { label: 'Damaged', style: 'bg-red-600 text-white' }
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
      // Free that day, plus what this request already holds. Booked props get no + (audit Nov 7).
      const cap = (freeFor(item) ?? item.quantity) + (draft?.orig[item.id] ?? 0)
      if (cap <= 0) return { inCart: draftQty(item.id) }
      return { inCart: draftQty(item.id), max: cap, onQty: (n: number) => setDraftQty(item.id, n) }
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
  const nothingAtAll = itemsStatus.complete && allItems.length === 0
  const stillLoading = !itemsStatus.ready
  const note = useAddingNote('props')
  const draftAdded = draft ? Object.entries(draft.lines).filter(([id, n]) => n > (draft.orig[id] ?? 0)).length : 0

  // Back from a prop page: the same spot in the list (owner, Oct 20).
  useEffect(() => {
    const box = rootRef.current?.closest<HTMLElement>('.overflow-y-auto')
    if (!box) return
    const save = () => { try { sessionStorage.setItem(scrollKey, String(box.scrollTop)) } catch { /* private mode */ } }
    box.addEventListener('scroll', save, { passive: true })
    return () => box.removeEventListener('scroll', save)
  }, [])
  // Draw the cards in pages as you scroll (owner, Nov 2: laggy): 1,000+ cards at once froze phones.
  const [shown, setShown] = useState(() => {
    if (navType !== 'POP') return PAGE
    try { return Math.max(PAGE, Number(sessionStorage.getItem(shownKey) || 0)) } catch { return PAGE }
  })
  const firstFilter = useRef(true)
  useEffect(() => {
    if (firstFilter.current) { firstFilter.current = false; return }
    setShown(PAGE)
  }, [q, categoryFilter, availability, shownCollection])
  useEffect(() => { try { sessionStorage.setItem(shownKey, String(shown)) } catch { /* private mode */ } }, [shown])
  const moreRef = useRef<HTMLDivElement>(null)
  const hasMore = matched.length > shown
  useEffect(() => {
    const el = moreRef.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(e => { if (e[0].isIntersecting) setShown(n => n + PAGE * 2) }, { rootMargin: '1200px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, shown])

  const restored = useRef(false)
  useLayoutEffect(() => {
    if (restored.current || navType !== 'POP' || !allItems.length) return
    restored.current = true
    const box = rootRef.current?.closest<HTMLElement>('.overflow-y-auto')
    let top = 0
    try { top = Number(sessionStorage.getItem(scrollKey) || 0) } catch { /* private mode */ }
    if (box && top) box.scrollTop = top
  }, [allItems.length, navType])

  const chip = (on: boolean) => `shrink-0 px-3.5 min-h-[40px] inline-flex items-center gap-1 rounded-full text-sm ${on ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`
  return (
    <div ref={rootRef} className="min-h-full bg-pt-bg">
      {/* Title and tabs scroll away with the page (owner, Oct 20: the old fold-away header was choppy). */}
      <div className="pt-safe px-4">
        {personal && <button onClick={() => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/admin')} className="text-pt-accent text-[17px] min-h-[44px] pr-3 inline-flex items-center">‹ Back</button>}
        {personal ? <h1 className="font-display text-[30px] leading-tight text-pt-text">My personal props</h1> : <h1 className="font-display text-[30px] leading-tight text-pt-text flex items-center gap-2.5">
          <BrandMark className="w-8 text-pt-text" title="" /><span className="flex-1">{toRequest ? 'Add to your request' : shootFlow ? 'Browse' : 'Props'}</span>
          {shootFlow && !toRequest && <><AiButton mode="props" /><MyRequestsButton /></>}
          {demo && <AiButton mode="props" />}
        </h1>}
        {personal && <p className="text-pt-muted text-sm mt-1">Only you can see these. They never show on Browse for anyone.</p>}
        {demo && (
          // Props only (owner, Oct 28): get people used to the AI before booking opens.
          <button onClick={() => ai.open('props')} className="mt-3 w-full min-h-[44px] flex items-center gap-2 rounded-full px-4 py-2.5 text-left text-[14px] font-semibold text-[#CDB8FF] bg-[#BF9DFF]/15 shadow-[inset_0_0_0_0.5px_rgba(191,157,255,0.35)]">
            <span className="text-[#BF9DFF]">✦</span><span className="flex-1">Got a video idea? Ask AI which props fit</span><span aria-hidden>›</span>
          </button>
        )}
        {/* No Gear tab (owner, Nov 3): gear isn't booked ahead; it's taken on the shoot day from the chat. */}
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
            className={`w-full bg-pt-surface border border-pt-border rounded-xl pl-10 ${personal ? 'pr-10' : 'pr-[84px]'} py-2.5 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent text-base`}
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className={`absolute ${personal ? 'right-1' : 'right-11'} top-1/2 -translate-y-1/2 w-10 h-10 text-pt-muted text-xl leading-none`}>×</button>
          )}
          {!personal && <>
            <button onClick={() => photoInput.current?.click()} aria-label="Search with a photo" title="Search with a photo" data-testid="photo-search"
              className="absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center text-pt-accent">
              <Icon name="camera" className="w-[22px] h-[22px]" />
            </button>
            {/* No `capture`: the phone offers the camera, the photo library and screenshots. */}
            <input ref={photoInput} type="file" accept="image/*" className="hidden" aria-hidden tabIndex={-1} data-testid="photo-search-input"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; onPhoto(f) }} />
          </>}
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
          <span className="text-pt-muted shrink-0 whitespace-nowrap">{!itemsStatus.complete ? (stillLoading ? 'Loading the closet…' : 'Loading the rest of the closet…') : `${matched.length} prop${matched.length !== 1 ? 's' : ''}`}</span>
          {toRequest && reqDay && <span className="text-pt-muted">· free on {formatDay(reqDay)}</span>}
          {shootFlow && !toRequest && <span className={`truncate ${note.late ? 'text-red-300' : 'text-pt-muted'}`}>· {note.text}</span>}
          {filtersActive && <button onClick={() => { setCategoryFilter(null); setAvailability('all') }} className="ml-auto text-pt-accent shrink-0 tap">Clear filters</button>}
        </p>
        {late.length > 0 && <div className="mb-4"><LateBanner late={late} /></div>}
        {photo && (
          <section className="mb-5" aria-live="polite" data-testid="photo-results">
            <div className="flex items-start gap-3 mb-3">
              <span className="w-10 h-10 shrink-0 rounded-full bg-pt-accent/15 text-pt-accent inline-flex items-center justify-center"><Icon name="camera" className="w-5 h-5" /></span>
              <div className="flex-1 min-w-0">
                <p className="text-pt-text text-[16px] font-semibold leading-snug">
                  {'busy' in photo ? 'Looking at your photo…' : 'error' in photo ? 'Photo search didn’t work' : photo.description ? 'Looks like your photo' : 'Couldn’t tell what that is'}
                </p>
                <p className={`text-sm leading-snug ${'error' in photo ? 'text-red-300' : 'text-pt-muted'}`}>
                  {'busy' in photo ? 'Finding the closest props in the closet.' : 'error' in photo ? photo.error
                    : !photo.description ? 'Try a closer, clearer photo, or type what you’re looking for.'
                    : photoMatches.length ? photo.description : `${photo.description} · nothing in the closet looks like it.`}
                </p>
              </div>
              {!('busy' in photo) && <button onClick={clearPhoto} className="shrink-0 min-h-[40px] px-3.5 rounded-full bg-pt-surface shadow-hairline text-pt-muted text-sm">Clear</button>}
            </div>
            {'description' in photo && photo.description && !photoMatches.length && (
              <button onClick={() => { setQuery(photo.description.replace(/^(an?|the)\s+/i, '')); clearPhoto() }} className="text-pt-accent text-sm font-medium tap">Search for “{photo.description.replace(/^(an?|the)\s+/i, '')}” instead</button>
            )}
            {photoMatches.length > 0 && <div className="grid grid-cols-2 gap-3">{photoMatches.map(card)}</div>}
            <div className="h-px bg-white/[0.06] mt-5" />
          </section>
        )}
        {nothingAtAll && (
          <p className="text-center mt-16 text-pt-muted text-sm leading-relaxed">
            No props yet.
            {isStaff && <><br />{shootFlow ? <>Open <strong className="text-pt-text">Team → Add a prop</strong></> : <>Tap <strong className="text-pt-text">Add</strong> in the bar below</>} to add your first prop.</>}
          </p>
        )}

        {stillLoading && (
          <div className="grid grid-cols-2 gap-3" aria-hidden data-testid="props-loading">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="rounded-[20px] bg-pt-surface shadow-card overflow-hidden"><div className="aspect-square bg-pt-border/60 animate-pulse" /><div className="h-12" /></div>)}
          </div>
        )}

        {!nothingAtAll && !stillLoading && itemsStatus.complete && matched.length === 0 && (
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
          {matched.slice(0, shown).map(card)}
        </div>
        {hasMore && <div ref={moreRef} className="h-10" aria-hidden />}

        {!hasMore && similar.length > 0 && (
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

      <BottomSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title={personal ? 'Status' : 'Order and status'}>
        <div className="space-y-2">
          {!personal && <>
            <p className="text-pt-muted text-[13px] px-1">Order</p>
            <div className="flex gap-2 pb-2">
              {([['hot', 'Hot first'], ['az', 'A to Z']] as const).map(([v, l]) => (
                <button key={v} onClick={() => { setSortBy(v); try { sessionStorage.setItem('pc.browseSort', v) } catch { /* fine */ } setFiltersOpen(false) }}
                  className={`flex-1 min-h-[44px] rounded-xl px-4 ${sortBy === v ? 'bg-pt-accent/15 text-pt-accent font-semibold' : 'bg-pt-bg text-pt-text'}`}>{l}</button>
              ))}
            </div>
            <p className="text-pt-muted text-[13px] px-1">Status</p>
          </>}
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
