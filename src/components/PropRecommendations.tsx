// "Similar props" and "Booked together" at the bottom of a prop page (owner, Nov 7: like a shop's "people who viewed this
// also viewed", so creators discover props without the AI helper). Similar = closest smart-search fingerprints;
// booked together = props asked for in the same request (totals only, nobody's name). Both come from one server call
// (no AI cost). If the server has nothing yet (a brand-new prop), similar falls back to shared tags and category here.
import { useEffect, useMemo, useState } from 'react'
import ItemCard, { type Badge } from './ItemCard'
import { useItems } from '../hooks/useItems'
import { useSession } from '../auth'
import { useCart } from '../cart'
import { useActiveShoot } from '../activeShoot'
import { useBookings, useBookingSettings } from '../hooks/useBookings'
import { useTurnaround } from '../hooks/useTurnaround'
import { useCategories } from '../hooks/useCategories'
import { freeForRange, todayInStudio } from '../../functions/src/booking'
import { propsLike, type PropsLike } from '../services/propsLike'
import { similarByTags } from '../lib/propInsights'
import type { Item } from '../types'

export default function PropRecommendations({ item }: { item: Item }) {
  const items = useItems()
  const { isStaff } = useSession()
  const cart = useCart()
  const active = useActiveShoot()
  const bookings = useBookings()
  const settings = useBookingSettings()
  const turnaround = useTurnaround()
  const categories = useCategories()
  const [data, setData] = useState<PropsLike | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let off = false
    setData(null); setFailed(false)
    propsLike(item.id).then(r => { if (!off) setData(r) }).catch(() => { if (!off) setFailed(true) })
    return () => { off = true }
  }, [item.id])

  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const shown = (i: Item | undefined): i is Item => !!i && i.id !== item.id && !i.archived && i.collection === item.collection
  const together = useMemo(() => (data?.together ?? []).map(t => ({ it: byId.get(t.id), times: t.times })).filter((t): t is { it: Item; times: number } => shown(t.it)),
    [data, byId])   // eslint-disable-line react-hooks/exhaustive-deps
  const similar = useMemo(() => {
    if (!data && !failed) return []
    const skip = new Set(together.map(t => t.it.id))
    const fromServer = (data?.similar ?? []).map(s => byId.get(s.id)).filter(shown).filter(i => !skip.has(i.id))
    if (fromServer.length >= 3) return fromServer
    // Not in smart search yet (or few matches): props sharing its tags and category.
    const more = similarByTags(item, items.filter(i => shown(i) && !skip.has(i.id) && !fromServer.some(f => f.id === i.id)), 10 - fromServer.length)
    return [...fromServer, ...more]
  }, [data, failed, byId, items, item, together])   // eslint-disable-line react-hooks/exhaustive-deps

  // Free / Booked for the shoot being planned (creators with a shoot picked; staff with a day picked).
  const dates = cart.start && cart.end && (isStaff || active.shoot) ? { start: cart.start, end: cart.end } : null
  const today = todayInStudio()
  const badgeFor = (i: Item): Badge | undefined => {
    if (!dates) return undefined
    if (i.condition === 'damaged') return { label: 'Damaged', style: 'bg-red-600 text-white' }
    const free = freeForRange({ quantity: i.quantity, missingQty: i.missingQty, legacyCheckedOut: i.status === 'checked-out' },
      bookings[i.id] ?? [], dates.start, dates.end, today, turnaround(i), settings)
    if (free === 0) return { label: 'Booked', style: 'bg-stone-900/90 text-red-300' }
    return { label: i.quantity > 1 ? `${free} of ${i.quantity} free` : 'Free', style: 'bg-green-500/90 text-stone-900' }
  }
  const catLabel = (i: Item) => categories.find(c => c.id === i.categoryId)?.label ?? ''

  if (!together.length && !similar.length) return null
  const row = (title: string, sub: string, list: { it: Item; subtitle: string }[]) => (
    <section aria-label={title}>
      <h2 className="text-pt-text text-[20px] font-semibold leading-tight">{title}</h2>
      <p className="text-pt-muted text-[14px] mt-0.5">{sub}</p>
      <div className="mt-3 -mx-4 px-4 flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-px-4 pb-1">
        {list.map(({ it, subtitle }) => (
          <div key={it.id} className="w-[148px] shrink-0 snap-start">
            <ItemCard item={it} subtitle={subtitle} badge={badgeFor(it)} />
          </div>
        ))}
      </div>
    </section>
  )
  return (
    <div className="space-y-6 pt-2">
      {together.length > 0 && row('Booked together with this', 'Creators who asked for this also asked for these',
        together.map(t => ({ it: t.it, subtitle: t.times > 1 ? `Together ${t.times} times` : 'Booked together once' })))}
      {similar.length > 0 && row('Similar props', 'Might work too, or go with it', similar.map(it => ({ it, subtitle: catLabel(it) })))}
    </div>
  )
}
