// Prop insights (owner, Nov 7): an at-a-glance dashboard for the arts department. What creators ask for most, what's hot
// right now, what runs out or was wanted while booked out (buy another?), what they ask for that we don't have, what could live on a grab-and-go shelf,
// who damages or loses props, and what's never asked for. Owner, arts and admins; view only. Numbers: src/lib/propInsights.ts.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useItems } from '../hooks/useItems'
import { useCategories } from '../hooks/useCategories'
import { subscribeToReservations, type Reservation } from '../services/reservations'
import { subscribeToPropWants } from '../services/propWants'
import { todayInStudio } from '../../functions/src/booking'
import { HIGH_VALUE_THRESHOLD } from '../config'
import { propInsights, agoLabel, studioDay, PERIODS, TREND_DAYS, GRAB_DAYS, GRAB_MIN_REQUESTS, GRAB_MIN_CREATORS, BUY_MIN_FULL_DAYS, BUY_MIN_WANTED, type Period, type PersonLoss, type PropWant, type Unavailable } from '../lib/propInsights'
import { PropThumb } from '../components/cleanup/Parts'
import Avatar from '../components/Avatar'
import { Icon, type IconName } from '../components/Icon'
import { formatMoney } from '../components/ItemCard'
import { useDesk } from '../desk/desk'
import type { Item } from '../types'

const times = (n: number) => n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const money = (n: number) => formatMoney(n).replace(/\.00$/, '')
/** "2 people wanted it while booked out" (or "wanted 3 times…" when someone wanted it on more than one day). */
const wantedText = (u: Unavailable) => u.wantedBy === u.wantedWhileBooked
  ? `${plural(u.wantedBy, 'person', 'people')} wanted it while booked out` : `wanted ${times(u.wantedWhileBooked)} while booked out`

export default function PropInsightsScreen() {
  const navigate = useNavigate()
  const desk = useDesk().on
  const [params, setParams] = useSearchParams()
  const period = (PERIODS.some(p => p.id === params.get('p')) ? params.get('p') : '30d') as Period
  const items = useItems()
  const categories = useCategories()
  const [reservations, setReservations] = useState<Reservation[] | null>(null)
  useEffect(() => subscribeToReservations({ email: '', all: true }, setReservations), [])
  const [wants, setWants] = useState<PropWant[]>([])
  useEffect(() => subscribeToPropWants(setWants), [])
  const today = todayInStudio()
  const data = useMemo(() => reservations ? propInsights({ items, reservations, wants, today, period, highValue: HIGH_VALUE_THRESHOLD }) : null,
    [items, reservations, wants, today, period])
  const catLabel = (id: string) => categories.find(c => c.id === id)?.label ?? id
  const open = (id: string, item?: Item) => item && navigate(`/item/${id}`)

  const t = data?.totals
  const label = PERIODS.find(p => p.id === period)!.label
  const inLabel = period === 'all' ? 'so far' : `in the last ${label}`

  return (
    <div className="min-h-screen bg-pt-bg pb-16">
      <div className="sticky top-0 bg-pt-bg pt-safe z-20 px-4 pb-3">
        <div className="flex items-center gap-2 min-h-[52px]">
          <button onClick={() => navigate(-1)} aria-label="Back" className="w-11 h-11 -ml-2 grid place-items-center text-pt-text text-[28px] leading-none">‹</button>
          <h1 className="font-display text-[28px] text-pt-text flex-1 truncate">Prop insights</h1>
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="tablist" aria-label="Period">
          {PERIODS.map(p => (
            <button key={p.id} role="tab" aria-selected={period === p.id} onClick={() => setParams(p.id === '30d' ? {} : { p: p.id }, { replace: true })}
              className={`min-h-[40px] inline-flex items-center gap-1 rounded-full px-3.5 text-[15px] shrink-0 ${period === p.id ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-white/[0.08] text-pt-text'}`}>{p.label}</button>
          ))}
        </div>
      </div>

      {!data || !t ? <p className="px-4 pt-6 text-pt-muted">Loading the requests…</p> : (
        <div className="px-4 space-y-4">
          <p className="text-pt-muted text-[15px]">What creators asked for {inLabel}, what ran out, and what came back broken. Tap any prop to open it.</p>

          {/* Headline numbers */}
          <div className={`grid gap-2 ${desk ? 'grid-cols-4' : 'grid-cols-2'}`}>
            <Tile n={t.requests} label="Requests" sub={`from ${plural(t.creators, 'creator')}${t.declined ? ` · ${t.declined} declined` : ''}`} />
            <Tile n={t.units} label="Props sent out" sub={`${plural(t.props, 'different prop')}`} />
            <Tile n={`${t.catalogue ? Math.round((t.everBooked / t.catalogue) * 100) : 0}%`} label="Of the closet ever booked" sub={`${t.everBooked} of ${t.catalogue} props`} />
            <Tile n={t.damagedUnits + t.missingUnits} label="Damaged or lost" sub={t.lossValue ? `${money(t.lossValue)} to replace` : `${t.damagedUnits} damaged · ${t.missingUnits} missing`} tone={t.damagedUnits + t.missingUnits ? 'red' : undefined} />
          </div>

          <div className={desk ? 'grid grid-cols-2 gap-4 items-start' : 'space-y-4'}>
            <Card icon="star" title="Most booked" sub={`Asked for the most ${inLabel}.`}>
              <Ranked list={data.mostBooked} empty="No props were asked for in this period." render={s => ({
                main: plural(s.requests, 'request'), sub: `${plural(s.creators, 'creator')} · ${s.item ? `${s.item.quantity} in stock` : 'no longer in the app'}`, value: s.requests,
              })} onOpen={open} />
            </Card>

            <Card icon="flame" title="Trending now" sub={`Asked for more in the last ${TREND_DAYS} days than the ${TREND_DAYS} before.`}>
              <Ranked list={data.trending.map(x => ({ ...x.stat, x }))} empty="Nothing is picking up right now. Trends show once a prop is asked for at least twice in two weeks." render={s => ({
                main: s.x.before ? `↑ ${s.x.recent} (was ${s.x.before})` : `New: ${s.x.recent}`, sub: `${plural(s.x.recent, 'request')} in 2 weeks · last ${agoLabel(s.last, today)}`, value: s.x.recent - s.x.before,
              })} onOpen={open} />
            </Card>

            <Card icon="alert" title="Often unavailable" sub={`Every unit booked on a shoot day (props we have 2 or more of), couldn't be found when packing, in a declined request, or creators wanted it for their shoot while it was booked out. "Buy another?" = ran out on ${BUY_MIN_FULL_DAYS}+ days, or ${BUY_MIN_WANTED}+ wanted it while booked out.`}>
              <Ranked list={data.unavailable} empty="Nothing ran out in this period ✓" render={u => ({
                main: u.buyMore ? 'Buy another?' : '', badge: u.buyMore,
                sub: [u.fullDays && ((u.item?.quantity ?? 1) > 1 ? `All ${u.item!.quantity} booked on ${plural(u.fullDays, 'day')}` : `Booked out on ${plural(u.fullDays, 'day')}`),
                  u.cantFind && `couldn't find it ${times(u.cantFind)}`, u.declined && `in ${plural(u.declined, 'declined request')}`,
                  u.wantedWhileBooked && wantedText(u)].filter(Boolean).join(' · '),
                value: u.fullDays + 2 * u.cantFind + u.declined + u.wantedWhileBooked,
              })} onOpen={open} />
            </Card>

            <Card icon="basket" title="Asked for, but we don't have it" sub="Things creators asked the team to make or find. Asked for often = worth buying.">
              {data.wanted.length ? <ShowMore list={data.wanted} row={w => (
                <div key={w.key} className="flex items-center gap-3 py-2.5">
                  <span className="w-12 h-12 rounded-xl bg-white/[0.06] grid place-items-center text-pt-muted shrink-0"><Icon name="plus" className="w-5 h-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-pt-text text-[16px] font-semibold leading-snug line-clamp-2">{w.label}</span>
                    <span className="block text-pt-muted text-[14px]">{plural(w.requests, 'request')} · last {agoLabel(w.last, today)}{w.couldntGet ? ` · couldn't get it ${times(w.couldntGet)}` : ''}{w.made ? ` · made ${times(w.made)}` : ''}</span>
                  </span>
                  <span className="text-pt-text text-[20px] font-bold tabular-nums">{w.requests}</span>
                </div>
              )} /> : <Empty>No make-or-find requests in this period.</Empty>}
            </Card>

            <Card icon="hand" title="Grab-and-go candidates" sub={`Last ${GRAB_DAYS} days: asked for ${GRAB_MIN_REQUESTS}+ times by ${GRAB_MIN_CREATORS}+ creators, under ${money(HIGH_VALUE_THRESHOLD)} and in good shape. Worth keeping on an easy shelf so they don't need picking every time.`}>
              <Ranked list={data.grabAndGo} empty="No prop is asked for often enough yet." render={g => ({
                main: `${g.perMonth} a month`, sub: `${plural(g.requests, 'request')} · ${plural(g.creators, 'creator')}${g.item?.replacementCost != null ? ` · ${money(g.item.replacementCost)}` : ''}`, value: g.requests,
              })} onOpen={open} />
            </Card>

            <Card icon="alert" title="Damaged the most" sub={`Props the arts department marked damaged at check-in ${inLabel}, on the creator who booked them.`}>
              <People list={data.damagedBy} today={today} empty="Nothing came back damaged ✓" onPerson={e => navigate(`/people/${encodeURIComponent(e)}`)} onProp={open} items={items} />
            </Card>

            <Card icon="search" title="Missing after return" sub={`Props that didn't come back (missing at check-in) ${inLabel}, on the creator who booked them.`}>
              <People list={data.missingBy} today={today} empty="Nothing went missing ✓" onPerson={e => navigate(`/people/${encodeURIComponent(e)}`)} onProp={open} items={items} />
            </Card>

            <Card icon="tools" title="Needs attention now" sub="Can't be booked as they are. Fix, replace or find them.">
              {data.damagedNow.length + data.missingNow.length ? <>
                {data.damagedNow.length > 0 && <SubHead>Damaged · {data.damagedNow.length}</SubHead>}
                <ShowMore list={data.damagedNow} max={4} row={i => <PropRow key={i.id} item={i} main={i.replacementCost != null ? money(i.replacementCost) : ''} sub="Damaged" onOpen={() => open(i.id, i)} />} />
                {data.missingNow.length > 0 && <SubHead>Missing · {data.missingNow.length}</SubHead>}
                <ShowMore list={data.missingNow} max={4} row={i => <PropRow key={i.id} item={i} main={`${i.missingQty} of ${i.quantity}`} sub="Missing since a return. Tap Found it on its page" onOpen={() => open(i.id, i)} />} />
              </> : <Empty>Nothing damaged or missing ✓</Empty>}
            </Card>

            <Card icon="archive" title="Never asked for" sub={`${data.neverBooked.length} of ${t.catalogue} props have never been in a request. Oldest first: they've had the longest chance.`}>
              {data.neverBooked.length ? <ShowMore list={data.neverBooked} max={5} row={i => (
                <PropRow key={i.id} item={i} main="" sub={`${catLabel(i.categoryId)} · added ${agoLabel(studioDay(i.createdAt), today)}`} onOpen={() => open(i.id, i)} />
              )} /> : <Empty>Every prop has been asked for at least once ✓</Empty>}
            </Card>

            <Card icon="chart" title="By category" sub="Requests for each kind of prop, and per prop we own (high = buy more of that kind).">
              {data.byCategory.length ? <Bars rows={data.byCategory.map(c => ({ key: c.id, label: catLabel(c.id), value: c.lines, sub: `${plural(c.lines, 'request')} · ${plural(c.props, 'prop')} · ${c.perProp} per prop` }))} />
                : <Empty>No categories yet.</Empty>}
            </Card>
          </div>

          <details className="rounded-[20px] bg-pt-surface px-4 py-3 text-[15px] text-pt-muted">
            <summary className="text-pt-text font-semibold min-h-[44px] flex items-center cursor-pointer">How these numbers work</summary>
            <ul className="mt-1 mb-2 space-y-1.5 list-disc pl-5">
              <li>A <b className="text-pt-text">request</b> counts on the day it was asked for. Cancelled requests never count; declined ones do (someone wanted the prop).</li>
              <li><b className="text-pt-text">Props sent out</b> leaves out declined requests.</li>
              <li><b className="text-pt-text">Ran out</b> = a shoot day on which every unit (minus missing ones) was booked.</li>
              <li><b className="text-pt-text">Wanted while booked out</b> = a creator opened the prop while adding to their shoot and every unit was already booked that day. The app notes it quietly (the creator sees nothing). Each person counts once per prop and shoot day, and not when it was their own request that booked it.</li>
              <li><b className="text-pt-text">Damaged / missing</b> come from the check-in after a return and go on the creator who booked it. Values use the replacement cost on the prop.</li>
              <li>Props combined in the clean-up keep their old requests.</li>
            </ul>
          </details>
        </div>
      )}
    </div>
  )
}

function Tile({ n, label, sub, tone }: { n: number | string; label: string; sub: string; tone?: 'red' }) {
  return (
    <div className="rounded-[20px] bg-pt-surface px-4 py-3">
      <p className={`text-[28px] font-bold leading-tight tabular-nums ${tone === 'red' ? 'text-red-300' : 'text-pt-text'}`}>{n}</p>
      <p className="text-pt-text text-[15px] font-semibold leading-snug">{label}</p>
      <p className="text-pt-muted text-[13px] leading-snug">{sub}</p>
    </div>
  )
}

function Card({ icon, title, sub, children }: { icon: IconName; title: string; sub: string; children: ReactNode }) {
  return (
    <section className="rounded-[20px] bg-pt-surface p-4" aria-label={title}>
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-full bg-pt-accent/15 text-pt-accent grid place-items-center shrink-0"><Icon name={icon} className="w-[18px] h-[18px]" /></span>
        <h2 className="text-pt-text text-[18px] font-semibold">{title}</h2>
      </div>
      <p className="text-pt-muted text-[14px] mt-1 mb-1">{sub}</p>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-pt-text text-[15px] py-2">{children}</p>
const SubHead = ({ children }: { children: ReactNode }) => <p className="text-pt-muted text-[13px] font-semibold mt-2">{children}</p>

function ShowMore<T>({ list, row, max = 5 }: { list: T[]; row: (x: T) => ReactNode; max?: number }) {
  const [all, setAll] = useState(false)
  return (
    <div className="divide-y divide-white/[0.06]">
      {(all ? list : list.slice(0, max)).map(row)}
      {list.length > max && (
        <button onClick={() => setAll(a => !a)} className="w-full min-h-[44px] text-pt-accent text-[15px] font-semibold text-left">{all ? 'Show less' : `Show all ${list.length}`}</button>
      )}
    </div>
  )
}

function PropRow({ item, main, sub, onOpen, bar, badge }: { item: Item; main: string; sub: string; onOpen: () => void; bar?: number; badge?: boolean }) {
  return (
    <div className="py-2.5">
      <div className="flex items-center gap-3">
        <PropThumb item={item} size={48} />
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block text-pt-text text-[16px] font-semibold leading-snug line-clamp-2">{item.name}</span>
          <span className="block text-pt-muted text-[14px] leading-snug">{sub}</span>
        </button>
        {main && <span className={badge ? 'shrink-0 rounded-full px-2.5 py-1 text-[13px] font-semibold bg-pt-accent text-stone-900' : 'shrink-0 text-pt-text text-[15px] font-semibold tabular-nums text-right'}>{main}</span>}
      </div>
      {bar != null && <div className="mt-1.5 ml-[60px] h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full bg-pt-accent" style={{ width: `${Math.max(4, bar * 100)}%` }} /></div>}
    </div>
  )
}

/** A ranked list of props with a bar for the number that ranks them. */
function Ranked<T extends { id: string; name: string; item?: Item }>({ list, render, empty, onOpen }: {
  list: T[]; render: (x: T) => { main: string; sub: string; value: number; badge?: boolean }; empty: string; onOpen: (id: string, item?: Item) => void
}) {
  if (!list.length) return <Empty>{empty}</Empty>
  const top = Math.max(1, ...list.map(x => render(x).value))
  return <ShowMore list={list} row={x => {
    const r = render(x)
    const item = x.item ?? ({ id: x.id, name: x.name, photos: [] } as unknown as Item)
    return <PropRow key={x.id} item={item} main={r.main} sub={r.sub} badge={r.badge} bar={r.value / top} onOpen={() => onOpen(x.id, x.item)} />
  }} />
}

function People({ list, today, empty, onPerson, onProp, items }: { list: PersonLoss[]; today: string; empty: string; onPerson: (email: string) => void; onProp: (id: string, item?: Item) => void; items: Item[] }) {
  const [openOne, setOpenOne] = useState('')
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  if (!list.length) return <Empty>{empty}</Empty>
  const top = Math.max(1, ...list.map(p => p.units))
  return <ShowMore list={list} row={p => (
    <div key={p.email} className="py-2.5">
      <button onClick={() => setOpenOne(o => o === p.email ? '' : p.email)} aria-expanded={openOne === p.email} className="w-full flex items-center gap-3 text-left">
        <Avatar email={p.email} name={p.name} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block text-pt-text text-[16px] font-semibold truncate">{p.name}</span>
          <span className="block text-pt-muted text-[14px]">{plural(p.units, 'prop')}{p.value ? ` · ${money(p.value)}` : ''}{p.valueMissing ? ' · some have no value' : ''}</span>
        </span>
        <span className="text-pt-text text-[20px] font-bold tabular-nums">{p.units}</span>
        <span aria-hidden className={`text-pt-muted transition-transform ${openOne === p.email ? 'rotate-90' : ''}`}>›</span>
      </button>
      <div className="mt-1.5 ml-[56px] h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full bg-red-400" style={{ width: `${Math.max(4, (p.units / top) * 100)}%` }} /></div>
      {openOne === p.email && (
        <div className="ml-[56px] mt-2 space-y-1">
          {p.props.map((x, i) => (
            <button key={`${x.id}-${i}`} onClick={() => onProp(x.id, byId.get(x.id))} className="w-full flex items-center justify-between gap-2 min-h-[40px] text-left text-[15px]">
              <span className="text-pt-text truncate">{x.name}{x.units > 1 ? ` ×${x.units}` : ''}</span><span className="text-pt-muted shrink-0">{agoLabel(x.day, today)}</span>
            </button>
          ))}
          <button onClick={() => onPerson(p.email)} className="min-h-[44px] text-pt-accent text-[15px] font-semibold">Open {p.name.split(' ')[0]}’s record ›</button>
        </div>
      )}
    </div>
  )} />
}

function Bars({ rows }: { rows: { key: string; label: string; value: number; sub: string }[] }) {
  const top = Math.max(1, ...rows.map(r => r.value))
  return <ShowMore list={rows} max={6} row={r => (
    <div key={r.key} className="py-2.5">
      <div className="flex items-baseline justify-between gap-2"><span className="text-pt-text text-[16px] font-semibold truncate">{r.label}</span><span className="text-pt-text text-[15px] font-semibold tabular-nums">{r.value}</span></div>
      <p className="text-pt-muted text-[13px]">{r.sub}</p>
      <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full bg-pt-accent" style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }} /></div>
    </div>
  )} />
}
