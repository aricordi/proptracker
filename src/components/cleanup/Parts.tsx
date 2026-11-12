// Shared pieces of the clean-up tools (owner, Nov 6). Big text and big buttons: the crew has never used the app before.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import BottomSheet from '../BottomSheet'
import { useBins } from '../../hooks/useBins'
import { useLocations } from '../../hooks/useLocations'
import type { Item } from '../../types'
import { thumbOf } from '../../services/itemShape'
import ImageLightbox from '../ImageLightbox'

export function CleanupHeader({ title, sub, right, back = '/cleanup' }: { title: string; sub?: ReactNode; right?: ReactNode; back?: string | -1 }) {
  const navigate = useNavigate()
  return (
    <div className="sticky top-0 bg-pt-bg pt-safe z-20 px-4 pb-2">
      <div className="flex items-center gap-2 min-h-[52px]">
        <button onClick={() => back === -1 ? navigate(-1) : navigate(back)} aria-label="Back" className="w-11 h-11 -ml-2 grid place-items-center text-pt-text text-[28px] leading-none">‹</button>
        <h1 className="font-display text-[24px] text-pt-text flex-1 truncate">{title}</h1>
        {right}
      </div>
      {sub && <div className="pb-1">{sub}</div>}
    </div>
  )
}

/** "Bin 12 · Main room", or "No bin". */
export function useBinLabel() {
  const bins = useBins(), locations = useLocations()
  return useMemo(() => {
    const byId = new Map(bins.map(b => [b.id, b]))
    const area = new Map(locations.map(l => [l.id, l.name]))
    return {
      bins,
      label: (id?: string) => id ? byId.get(id)?.label : undefined,
      where: (id?: string) => {
        const b = id ? byId.get(id) : undefined
        if (!b) return 'No bin'
        const a = area.get(b.locationId)
        return a ? `${b.label} · ${a}` : b.label
      },
      locationOf: (id?: string) => (id ? byId.get(id)?.locationId : undefined) ?? '',
    }
  }, [bins, locations])
}

/** Pick a bin: type to search, tap one. */
export function BinSheet({ open, onClose, onPick, current }: { open: boolean; onClose: () => void; onPick: (binId: string, locationId: string) => void; current?: string }) {
  const { bins } = useBinLabel()
  const locations = useLocations()
  const [q, setQ] = useState('')
  useEffect(() => { if (open) setQ('') }, [open])
  const area = new Map(locations.map(l => [l.id, l.name]))
  const t = q.trim().toLowerCase().replace(/^bin\s*/, '')
  const shown = bins.filter(b => !t || b.label.toLowerCase().includes(t) || (area.get(b.locationId) ?? '').toLowerCase().includes(t)).slice(0, 80)
  return (
    <BottomSheet open={open} onClose={onClose} title="Which bin is it in?">
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type the bin number or room"
        className="w-full bg-pt-bg rounded-2xl px-4 min-h-[52px] text-[18px] text-pt-text placeholder:text-pt-muted outline-none focus:ring-2 focus:ring-pt-accent" />
      <div className="mt-3 max-h-[50vh] overflow-y-auto -mx-1 px-1 space-y-1">
        {shown.map(b => (
          <button key={b.id} onClick={() => { onPick(b.id, b.locationId); onClose() }}
            className={`w-full flex items-center gap-3 rounded-2xl px-4 min-h-[56px] text-left ${b.id === current ? 'bg-pt-accent/15 text-pt-accent' : 'bg-white/[0.05] text-pt-text'}`}>
            <span className="text-[18px] font-semibold">{b.label}</span>
            <span className="text-pt-muted text-[14px] truncate">{area.get(b.locationId) ?? ''}</span>
            {b.id === current && <span className="ml-auto">✓</span>}
          </button>
        ))}
        {!shown.length && <p className="text-pt-muted text-[16px] px-2 py-3">No bin called "{q}". Bins are made on Admin → Bins &amp; storage.</p>}
        <button onClick={() => { onPick('', ''); onClose() }} className="w-full rounded-2xl px-4 min-h-[52px] text-left text-pt-muted text-[16px]">It has no bin</button>
      </div>
    </BottomSheet>
  )
}

export function QtyStepper({ value, onChange, big = false }: { value: number; onChange: (n: number) => void; big?: boolean }) {
  const btn = big ? 'w-14 h-14 text-[28px]' : 'w-11 h-11 text-[22px]'
  // What's typed, kept here so the box can be empty while typing (deleting "5" to type "3" must not turn into "13").
  // Only a real number of 1 or more is passed on; leaving the box empty puts the last count back.
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(t => (parseInt(t, 10) === value ? t : String(value))) }, [value])
  return (
    <div className="inline-flex items-center gap-1">
      <button aria-label="One less" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1}
        className={`${btn} rounded-full bg-white/[0.08] text-pt-text grid place-items-center disabled:opacity-30`}>−</button>
      <input inputMode="numeric" aria-label="How many" value={text}
        onChange={e => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
          setText(digits)
          const n = parseInt(digits, 10)
          if (Number.isFinite(n) && n >= 1) onChange(Math.min(9999, n))
        }}
        onBlur={() => { const n = parseInt(text, 10); if (!Number.isFinite(n) || n < 1) setText(String(value)) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={`${big ? 'w-16 text-[28px]' : 'w-12 text-[18px]'} text-center font-bold bg-transparent text-pt-text outline-none`} />
      <button aria-label="One more" onClick={() => onChange(Math.min(9999, value + 1))}
        className={`${btn} rounded-full bg-white/[0.08] text-pt-text grid place-items-center`}>+</button>
    </div>
  )
}

/** A short message at the top (never over the buttons) with an optional Undo. */
export function Toast({ text, onUndo, onDone }: { text: string; onUndo?: () => void; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 6000); return () => clearTimeout(t) }, [text])   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div role="status" onClick={onDone} className="fixed left-4 right-4 z-50 mx-auto max-w-[560px] rounded-2xl bg-pt-raised shadow-float px-4 min-h-[56px] flex items-center gap-3"
      style={{ top: 'calc(env(safe-area-inset-top) + 8px)' }}>
      <span className="flex-1 text-pt-text text-[16px]">{text}</span>
      {onUndo && <button onClick={e => { e.stopPropagation(); onUndo(); onDone() }} className="tap text-pt-accent font-bold text-[16px] px-2 min-h-[44px]">Undo</button>}
    </div>
  )
}

/** A prop's photo (small version), or a grey box. Tap it to see the full photo, big (owner, Nov 6: every picture opens
 *  larger). The tap never reaches the row around it, so rows that select on tap still work from their text. */
export function PropThumb({ item, size = 56, className = '', zoom = true }: { item: Item; size?: number; className?: string; zoom?: boolean }) {
  const url = item.photos?.[0]
  const [open, setOpen] = useState(false)
  const box = `relative rounded-xl bg-white/[0.06] overflow-hidden shrink-0 ${className}`
  if (!url) return <div className={box} style={{ width: size, height: size }}><div className="w-full h-full grid place-items-center text-pt-muted text-xs">No photo</div></div>
  const img = <img src={thumbOf(item, url)} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
  if (!zoom) return <div className={box} style={{ width: size, height: size }}>{img}</div>
  return (
    <>
      <span role="button" tabIndex={0} aria-label={`See the photo of ${item.name} bigger`} className={`${box} block cursor-zoom-in`} style={{ width: size, height: size }}
        onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(true) }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setOpen(true) } }}>
        {img}<ZoomBadge />
      </span>
      {open && <ImageLightbox src={url} alt={item.name} item={item} onClose={() => setOpen(false)} />}
    </>
  )
}

/** The little magnifier in a photo's corner: "tap to see it bigger". */
export function ZoomBadge({ className = 'bottom-1 right-1' }: { className?: string }) {
  return (
    <span aria-hidden className={`absolute ${className} w-6 h-6 rounded-full bg-black/65 grid place-items-center text-white`}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5M11 8v6M8 11h6" /></svg>
    </span>
  )
}

/** A big photo tile (bin view, quick approve): tap the magnifier to open the full photo. */
export function ZoomButton({ src, alt, item }: { src: string; alt: string; item?: Item }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={e => { e.stopPropagation(); setOpen(true) }} aria-label={`See the photo of ${alt} bigger`}
        className="absolute bottom-1 right-1 w-11 h-11 grid place-items-center"><ZoomBadge className="inset-0 m-auto !w-8 !h-8" /></button>
      {open && <ImageLightbox src={src} alt={alt} item={item} title={alt} onClose={() => setOpen(false)} />}
    </>
  )
}
