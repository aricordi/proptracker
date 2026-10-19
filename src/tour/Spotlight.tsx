// The tour's highlight: dims everything except one element (found by data-tour="<target>"), blocks taps
// outside it, and shows a short tip next to it. No target = a centred card with "Next".
// Calm on purpose (owner, Oct 19: the animations were distracting): no pulsing, no sliding, no pop-in.
import { useEffect, useState, type ReactNode } from 'react'

const PAD = 6

// Scroll the nearest scrolling box (a sheet or the page) so the element clears the sticky header and any bottom button bar.
function keepInView(el: HTMLElement) {
  const box = el.parentElement?.closest<HTMLElement>('.overflow-y-auto')
  if (!box) return
  const b = el.getBoundingClientRect(), h = window.innerHeight
  const below = b.bottom - (h - 140), above = 110 - b.top
  if (below > 0) box.scrollTop += Math.min(below, Math.max(0, -above))
  else if (above > 0) box.scrollTop -= above
}

export function Spotlight({ target, tip, step, total, next, onNext, onSkip, nextDisabled, onClose }: {
  target?: string; tip: ReactNode; step: number; total: number
  next?: string; onNext?: () => void; onSkip?: () => void; nextDisabled?: boolean; onClose?: () => void
}) {
  const [r, setR] = useState<DOMRect | null>(null)
  useEffect(() => {
    setR(null)
    if (!target) return
    let raf = 0, last = '', height = -1
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
      if (el) {
        // Bring it into view when found, and again when it grows (e.g. a form opening), unless it's bigger than the screen.
        const hh = Math.round(el.offsetHeight)
        if (hh !== height) { height = hh; if (hh < window.innerHeight * 0.7) keepInView(el) }
        const b = el.getBoundingClientRect()
        const k = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`
        if (k !== last) { last = k; setR(b) }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [target])

  const card = (
    <div className="rounded-[20px] bg-pt-raised shadow-float p-4 space-y-3 pointer-events-auto">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-pt-accent">Practice · step {step} of {total}</p>
        {onClose && <button onClick={onClose} aria-label="Close the tour" className="tap text-pt-muted text-sm">✕</button>}
      </div>
      <div className="text-[15px] leading-snug text-pt-text">{tip}</div>
      {(next || onSkip) && (
        <div className="flex items-center gap-3">
          {next && <button onClick={onNext} disabled={nextDisabled} className="flex-1 rounded-xl py-3 font-bold text-stone-900 bg-pt-accent shadow-gold disabled:opacity-40 disabled:shadow-none">{next}</button>}
          {onSkip && <button onClick={onSkip} className="tap text-pt-muted text-sm underline">No camera? Skip</button>}
        </div>
      )}
    </div>
  )

  // Nothing to point at: a card in the middle of a dimmed screen.
  if (!target) return (
    <div className="fixed inset-0 z-[70] bg-black/60 grid place-items-center px-4">
      <div className="w-full max-w-sm">{card}</div>
    </div>
  )
  if (!r) return <div className="fixed inset-0 z-[70]" />   // still finding it: block taps for a moment

  const h = window.innerHeight
  const hole = { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
  const below = r.top + r.height / 2 < h * 0.55
  const room = below ? h - (hole.top + hole.height) : hole.top
  const dock = room < 190
  return (
    <>
      {/* The dim with a hole (taps go through the hole only) */}
      <div aria-hidden className="fixed z-[70] rounded-2xl pointer-events-none"
        style={{ ...hole, boxShadow: '0 0 0 2px rgba(201,169,97,0.85), 0 0 0 9999px rgba(0,0,0,0.6)' }} />
      <div className="fixed z-[70] inset-x-0 top-0" style={{ height: Math.max(0, hole.top) }} />
      <div className="fixed z-[70] inset-x-0 bottom-0" style={{ top: hole.top + hole.height }} />
      <div className="fixed z-[70] left-0" style={{ top: hole.top, height: hole.height, width: Math.max(0, hole.left) }} />
      <div className="fixed z-[70] right-0" style={{ top: hole.top, height: hole.height, left: hole.left + hole.width }} />
      {/* Next to the highlight if there's room; a big highlight (search + results) gets the tip docked at the bottom. */}
      <div className="fixed z-[71] inset-x-4 pointer-events-none" style={dock ? { bottom: 'calc(env(safe-area-inset-bottom) + 12px)' } : below ? { top: hole.top + hole.height + 14 } : { bottom: h - hole.top + 14 }}>
        {card}
      </div>
    </>
  )
}
