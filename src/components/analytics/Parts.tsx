// The building blocks of Analytics and the Dashboard, so every level of drill-down has the same shape:
// headline sentence → metric cards (pick what the chart shows) → one column chart with the average → ranked lists.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Avatar from '../Avatar'
import { Icon } from '../Icon'
import { METRICS, fmt, compare, averageOf, bucketLabel, type Metric, type Grain } from '../../lib/insights'

const TONE = { good: 'text-green-300', bad: 'text-red-300', flat: 'text-pt-muted' }

export function Delta({ m, cur, prev, vs }: { m: Metric; cur: number | null; prev: number | null; vs?: string }) {
  const c = compare(m, cur, prev)
  if (!c) return <span className="text-pt-muted text-xs">No data to compare</span>
  return <span className="text-xs"><span className={`font-medium ${TONE[c.tone]}`}>{c.text}</span>{vs && <span className="text-pt-muted"> vs {vs}</span>}</span>
}

// YouTube Studio's metric strip: each card is a tab for the chart under it.
export function MetricCards({ metrics, cur, prev, selected, onSelect, tourId }: {
  metrics: Metric[]; cur: (m: Metric) => number | null; prev: (m: Metric) => number | null; selected?: Metric; onSelect?: (m: Metric) => void; tourId?: string }) {
  return (
    <div data-tour={tourId} role="tablist" aria-label="Pick what the chart shows" className="-mx-4 px-4 scroll-px-4 flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory">
      {metrics.map(m => {
        const on = selected === m, v = cur(m)
        return (
          <button key={m} role="tab" aria-selected={on} onClick={() => onSelect?.(m)}
            className={`snap-start shrink-0 w-[46%] min-w-[150px] max-w-[200px] text-left rounded-2xl p-3 pt-2.5 relative overflow-hidden ${on ? 'bg-pt-raised shadow-hairline' : 'bg-pt-surface'}`}>
            <span className={`absolute inset-x-0 top-0 h-[3px] ${on ? 'bg-pt-accent' : 'bg-transparent'}`} />
            <span className={`block text-[13px] ${on ? 'text-pt-text' : 'text-pt-muted'}`}>{METRICS[m].label}</span>
            <span className="block text-[28px] font-bold leading-tight tabular-nums text-pt-text">{fmt(m, v)}</span>
            <Delta m={m} cur={v} prev={prev(m)} />
          </button>
        )
      })}
    </div>
  )
}

const niceTop = (x: number) => {
  if (x <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(x))
  return [1, 2, 4, 5, 10].map(f => f * p).find(t => t >= x) ?? 10 * p
}

// One measure over time: columns, a dashed line at the average, and a details line under it (tap a column).
export function ColumnChart({ data, grain, m, onZoom, avgWord, goal }: {
  data: { bucket: string; value: number | null }[]; grain: Grain; m: Metric; onZoom?: (bucket: string) => void; avgWord: string; goal?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(340)
  const [pick, setPick] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(e => setW(e[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const key = `${data[0]?.bucket}|${data.length}|${m}`
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) { setLastKey(key); setPick(null) }

  const pct = METRICS[m].fmt === 'pct'
  const vals = data.map(d => d.value)
  const avg = averageOf(vals)
  const top = pct ? 1 : niceTop(Math.max(0, ...vals.map(v => v ?? 0), avg ?? 0, goal ?? 0))
  const H = 176, padL = 34, padB = 22, padT = 8, ch = H - padB - padT
  const n = Math.max(1, data.length), slot = (w - padL) / n
  const barW = Math.max(3, Math.min(30, slot * 0.64)), r = Math.min(4, barW / 2)
  const y = (v: number) => padT + ch - (v / top) * ch
  const every = Math.ceil(n / 6)
  const tick = (v: number) => pct ? `${Math.round(v * 100)}%` : METRICS[m].fmt === 'hours' ? fmt(m, v).replace(' days', 'd').replace(' h', 'h').replace(' min', 'm') : String(Math.round(v * 10) / 10)
  const picked = pick !== null ? data[pick] : null
  const summary = `${METRICS[m].label} by ${grain}: ${data.map(d => `${bucketLabel(d.bucket, grain)} ${fmt(m, d.value)}`).join(', ')}. Average ${fmt(m, avg)}.`

  return (
    <div className="bg-pt-surface rounded-2xl p-3 pb-2">
      <div ref={box} className="w-full">
        <svg width={w} height={H} role="img" aria-label={summary} className="block select-none touch-pan-y">
          {[0, top / 2, top].map(t => (
            <g key={t}>
              <line x1={padL} x2={w} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.08)" />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="fill-pt-muted" fontSize={12}>{tick(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const v = d.value ?? 0, x = padL + i * slot + (slot - barW) / 2, h = Math.max(d.value ? 2 : 0, y(0) - y(v))
            const dim = pick !== null && pick !== i
            const path = h <= 0 ? '' : h < r ? `M${x},${y(0)}h${barW}v${-h}h${-barW}z`
              : `M${x},${y(0)}v${-(h - r)}q0,${-r} ${r},${-r}h${barW - 2 * r}q${r},0 ${r},${r}v${h - r}z`
            return (
              <g key={d.bucket} onClick={() => setPick(pick === i ? null : i)} onPointerEnter={e => { if (e.pointerType === 'mouse') setPick(i) }} className="cursor-pointer">
                <rect x={padL + i * slot} y={padT} width={slot} height={ch + padB} fill="transparent" />
                {path && <path d={path} className={pick === i ? 'fill-amber-200' : 'fill-pt-accent'} opacity={dim ? 0.35 : 1} />}
                {d.value === null && <line x1={x} x2={x + barW} y1={y(0) - 1} y2={y(0) - 1} stroke="rgba(255,255,255,.25)" strokeDasharray="2 2" />}
                {(i % every === 0 || i === n - 1) && (n - 1 - i >= every || i === n - 1) &&
                  <text x={i === n - 1 && n > 1 ? w - 2 : padL + i * slot + slot / 2} y={H - 6} textAnchor={i === n - 1 && n > 1 ? 'end' : 'middle'} className={pick === i ? 'fill-pt-text' : 'fill-pt-muted'} fontSize={12}>{bucketLabel(d.bucket, grain)}</text>}
              </g>
            )
          })}
          {goal !== undefined && <g pointerEvents="none"><line x1={padL} x2={w} y1={y(goal)} y2={y(goal)} stroke="#fff" strokeWidth={2} /><text x={w - 2} y={y(goal) - 5} textAnchor="end" className="fill-pt-text" fontSize={12}>Minimum {goal}</text></g>}
          {avg !== null && goal === undefined && <line x1={padL} x2={w} y1={y(avg)} y2={y(avg)} stroke="rgba(255,255,255,.55)" strokeWidth={1.5} strokeDasharray="4 4" pointerEvents="none" />}
        </svg>
      </div>
      <div className="min-h-[44px] flex items-center gap-3 border-t border-white/[0.06] mt-1 pt-2">
        {picked ? <>
          <span className="flex-1 min-w-0">
            <span className="block text-pt-text text-[15px]"><b className="tabular-nums">{fmt(m, picked.value)}</b> <span className="text-pt-muted">{METRICS[m].unit || METRICS[m].label.toLowerCase()}</span></span>
            <span className="block text-pt-muted text-xs">{bucketLabel(picked.bucket, grain, true)}</span>
          </span>
          {onZoom && grain !== 'day' && <button onClick={() => onZoom(picked.bucket)} className="shrink-0 px-3 py-2 rounded-full bg-pt-border text-pt-text text-sm">Zoom in ›</button>}
          {onZoom && grain === 'day' && <button onClick={() => onZoom(picked.bucket)} className="shrink-0 px-3 py-2 rounded-full bg-pt-border text-pt-text text-sm">See that day ›</button>}
        </> : <>
          {goal === undefined && <svg width="22" height="8" aria-hidden className="shrink-0"><line x1="0" x2="22" y1="4" y2="4" stroke="rgba(255,255,255,.55)" strokeWidth={1.5} strokeDasharray="4 4" /></svg>}
          <span className="flex-1 text-pt-muted text-xs">{goal !== undefined ? `White line = the minimum. Average ${fmt(m, avg)} ${avgWord}.` : `Average ${fmt(m, avg)} ${avgWord}. Tap a column for details.`}</span>
        </>}
      </div>
    </div>
  )
}

export function SectionHead({ title, sub, more, onMore }: { title: string; sub?: string; more?: string; onMore?: () => void }) {
  return (
    <div className="flex items-end justify-between gap-3 pt-3">
      <div className="min-w-0"><h2 className="text-pt-text text-[20px] font-semibold tracking-tight">{title}</h2>{sub && <p className="text-pt-muted text-xs">{sub}</p>}</div>
      {onMore && <button onClick={onMore} className="shrink-0 text-pt-accent text-sm tap">{more ?? 'See more'} ›</button>}
    </div>
  )
}

// A ranked list (YouTube's "Top content"): label, a bar for the share of the biggest, the value, and a tap target.
export function RankList({ rows, empty = 'Nothing in this view.', tourId }: {
  rows: { key: string; label: string; sub?: ReactNode; email?: string; value: string; share: number; tone?: string; onClick?: () => void }[]; empty?: string; tourId?: string }) {
  return (
    <div data-tour={tourId} className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
      {rows.length === 0 && <p className="text-pt-muted text-sm px-3 py-4">{empty}</p>}
      {rows.map(r => (
        <button key={r.key} onClick={r.onClick} disabled={!r.onClick} className="w-full flex items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default">
          {r.email !== undefined && <Avatar email={r.email} name={r.label} size={32} />}
          <span className="flex-1 min-w-0">
            <span className="flex items-baseline gap-2"><span className="flex-1 min-w-0 truncate text-pt-text text-[15px]">{r.label}</span><span className={`shrink-0 tabular-nums font-semibold ${r.tone ?? 'text-pt-text'}`}>{r.value}</span></span>
            <span className="block h-1.5 rounded-full bg-white/[0.06] mt-1.5 overflow-hidden"><i className="block h-full rounded-full bg-pt-accent/80" style={{ width: `${Math.max(r.share > 0 ? 3 : 0, r.share * 100)}%` }} /></span>
            {r.sub && <span className="block text-pt-muted text-xs mt-1 truncate">{r.sub}</span>}
          </span>
          {r.onClick && <span className="text-pt-muted shrink-0">›</span>}
        </button>
      ))}
    </div>
  )
}

// What's waiting on someone right now (not tied to the date range).
export function NeedsYou({ items, tourId }: { items: { n: number; text: string; onClick: () => void; serious?: boolean }[]; tourId?: string }) {
  const live = items.filter(i => i.n > 0)
  return (
    <div data-tour={tourId} className={`rounded-2xl ${live.length ? 'bg-amber-500/10' : 'bg-pt-surface'} divide-y divide-white/[0.06]`}>
      {live.length === 0 && <p className="px-3 py-3 text-[15px] text-green-300 flex items-center gap-2"><Icon name="check" className="w-4 h-4" />All clear: nothing is waiting on you.</p>}
      {live.map(i => (
        <button key={i.text} onClick={i.onClick} className="w-full flex items-center gap-3 px-3 py-3 text-left">
          <span className={`min-w-[32px] h-8 px-2 rounded-full grid place-items-center text-sm font-bold tabular-nums ${i.serious ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-200'}`}>{i.n}</span>
          <span className="flex-1 text-pt-text text-[15px]">{i.text}</span>
          <span className="text-pt-accent">›</span>
        </button>
      ))}
    </div>
  )
}

export const showRateTone = (r: number | null) => r === null ? 'text-pt-muted' : r < 0.7 ? 'text-red-300' : r < 0.9 ? 'text-amber-200' : 'text-green-300'

// The same "waiting on someone" list on the Dashboard and in Analytics.
export function needsYouItems(a: { incidents: { kind: string; open?: boolean; to?: string }[]; backlog: { propsPackLate: number; propsToCheckIn: number; gearToCheckIn: number; propsOutLate: number; gearOutLate: number } },
  pausedNow: string[], go: (to: string) => void) {
  const open = (k: string[]) => new Set(a.incidents.filter(i => i.open && k.includes(i.kind)).map(i => i.to ?? Math.random())).size
  const b = a.backlog, decide = open(['missed-checkin']), reports = open(['ran-over', 'mess']), late = b.propsOutLate + b.gearOutLate
  return [
    { n: decide, text: `Missed check-in${decide === 1 ? '' : 's'} to decide`, onClick: () => go('/schedule/team'), serious: true },
    { n: reports, text: `House report${reports === 1 ? '' : 's'} to review`, onClick: () => go('/schedule/team') },
    { n: late, text: `Late return${late === 1 ? '' : 's'} still out`, onClick: () => go('/analytics?tab=flags&theme=returns'), serious: true },
    { n: b.propsPackLate, text: 'Props requests to pack today or overdue', onClick: () => go('/reservations') },
    { n: b.propsToCheckIn, text: `Props return${b.propsToCheckIn === 1 ? '' : 's'} to check in`, onClick: () => go('/reservations') },
    { n: b.gearToCheckIn, text: `Gear return${b.gearToCheckIn === 1 ? '' : 's'} to check in`, onClick: () => go('/gear/bookings') },
    { n: pausedNow.length, text: `Creator${pausedNow.length === 1 ? '' : 's'} paused right now`, onClick: () => go('/creators') },
  ]
}

// ── Accountability: who's doing well, who isn't ──
export const LEVEL_STYLE: Record<'attention' | 'behind' | 'good', { pill: string; fill: string; tile: string; text: string }> = {
  attention: { pill: 'bg-red-500/15 text-red-300', fill: 'bg-red-300', tile: 'bg-red-500/10', text: 'text-red-300' },
  behind: { pill: 'bg-amber-500/15 text-amber-200', fill: 'bg-amber-200', tile: 'bg-amber-500/10', text: 'text-amber-200' },
  good: { pill: 'bg-green-500/15 text-green-300', fill: 'bg-green-300', tile: 'bg-green-500/10', text: 'text-green-300' },
}
type St = import('../../lib/insights').Standing
type Lv = import('../../lib/insights').Level
const LABEL: Record<Lv, string> = { attention: 'Needs attention', behind: 'Behind', good: 'On track' }

export function LevelPill({ level }: { level: Lv }) {
  return <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 ${LEVEL_STYLE[level].pill}`}>
    {level === 'good' ? <Icon name="check" className="w-3.5 h-3.5" /> : <span aria-hidden className="font-bold">{level === 'attention' ? '!' : '–'}</span>}{LABEL[level]}</span>
}
// Three tiles that are also the filter: "2 need attention · 3 behind · 9 on track".
export function StandingTiles({ list, filter, onFilter, tourId }: { list: St[]; filter?: Lv | ''; onFilter?: (l: Lv | '') => void; tourId?: string }) {
  return (
    <div data-tour={tourId} className="grid grid-cols-3 gap-2">
      {(['attention', 'behind', 'good'] as Lv[]).map(l => {
        const n = list.filter(s => s.level === l).length, on = filter === l
        return (
          <button key={l} onClick={() => onFilter?.(on ? '' : l)} aria-pressed={on} disabled={!onFilter}
            className={`rounded-2xl p-3 text-left ${LEVEL_STYLE[l].tile} ${on ? 'ring-2 ring-inset ring-white/40' : ''} disabled:cursor-default`}>
            <span className={`block text-[28px] font-bold leading-none tabular-nums ${n ? LEVEL_STYLE[l].text : 'text-pt-muted'}`}>{n}</span>
            <span className="block text-pt-text text-[13px] mt-1">{LABEL[l]}</span>
          </button>
        )
      })}
    </div>
  )
}
// Progress to the minimum: filmed (coloured), booked still to come (light), a tick where they should be by now.
export function TargetBar({ s }: { s: St }) {
  const scale = Math.max(s.target.full, s.filmed + s.coming, 1)
  const pace = s.target.byNow < s.target.full ? s.target.byNow : null
  return (
    <span className="relative block h-2 rounded-full bg-white/[0.08] overflow-hidden" aria-hidden>
      <i className={`absolute inset-y-0 left-0 ${LEVEL_STYLE[s.level].fill}`} style={{ width: `${(s.filmed / scale) * 100}%` }} />
      {s.coming > 0 && <i className="absolute inset-y-0 bg-white/25" style={{ left: `${(s.filmed / scale) * 100}%`, width: `${(s.coming / scale) * 100}%` }} />}
      {pace !== null && pace > 0 && <i className="absolute inset-y-0 w-[2px] bg-white/70" style={{ left: `calc(${(pace / scale) * 100}% - 1px)` }} />}
      <i className="absolute inset-y-0 w-[2px] bg-white" style={{ left: `calc(${(s.target.full / scale) * 100}% - 2px)` }} />
    </span>
  )
}
export function StandingRow({ s, onClick }: { s: St; onClick?: () => void }) {
  const good = s.level === 'good'
  return (
    <button onClick={onClick} disabled={!onClick} className="w-full flex items-center gap-3 px-3 py-3 text-left disabled:cursor-default">
      <Avatar email={s.email} name={s.name} size={40} />
      <span className="flex-1 min-w-0 space-y-1.5">
        <span className="flex items-center gap-2"><b className="flex-1 min-w-0 truncate text-pt-text text-[15px]">{s.name}</b><LevelPill level={s.level} /></span>
        <TargetBar s={s} />
        <span className="flex items-baseline gap-2 text-xs">
          <span className="text-pt-text tabular-nums shrink-0"><b>{s.filmed}</b> of {s.target.full} filmed{s.coming ? ` · ${s.coming} booked` : ''}</span>
          <span className={`min-w-0 truncate ${good ? 'text-pt-muted' : LEVEL_STYLE[s.level].text}`}>{good ? `${s.showRate === null ? 'nothing booked yet' : `showed up ${Math.round(s.showRate * 100)}%`}${s.flags ? ` · ${s.flags} small flag${s.flags > 1 ? 's' : ''}` : ''}` : s.reasons.join(' · ')}</span>
        </span>
      </span>
      {onClick && <span className="text-pt-muted shrink-0">›</span>}
    </button>
  )
}
export function StandingList({ list, onOpen, empty = 'Nobody in this view.', tourId }: { list: St[]; onOpen?: (email: string) => void; empty?: string; tourId?: string }) {
  return (
    <div data-tour={tourId} className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
      {list.length === 0 && <p className="text-pt-muted text-sm px-3 py-4">{empty}</p>}
      {list.map(s => <StandingRow key={s.email} s={s} onClick={onOpen ? () => onOpen(s.email) : undefined} />)}
    </div>
  )
}
export function TargetKey({ byNow, full }: { byNow: number; full: number }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-pt-muted text-xs">
      <span className="flex items-center gap-1.5"><i className="w-3 h-2 rounded-sm bg-green-300" />Filmed</span>
      <span className="flex items-center gap-1.5"><i className="w-3 h-2 rounded-sm bg-white/25" />Booked, still to come</span>
      <span className="flex items-center gap-1.5"><i className="w-[2px] h-3 bg-white" />Minimum ({full})</span>
      {byNow < full && <span className="flex items-center gap-1.5"><i className="w-[2px] h-3 bg-white/70" />Where they should be by now ({byNow})</span>}
    </p>
  )
}
