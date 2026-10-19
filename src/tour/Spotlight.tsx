// The tour's highlight: dims everything except one element (found by data-tour="<target>"), blocks taps
// outside it, and shows a short tip next to it. No target = a centred card with "Next".
import { useEffect, useState, type ReactNode } from 'react'

const PAD = 6

export function Spotlight({ target, tip, step, total, next, onNext, onSkip }: {
  target?: string; tip: ReactNode; step: number; total: number
  next?: string; onNext?: () => void; onSkip?: () => void
}) {
  const [r, setR] = useState<DOMRect | null>(null)
  useEffect(() => {
    setR(null)
    if (!target) return
    let raf = 0, last = '', scrolled = false
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
      if (el) {
        if (!scrolled) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); scrolled = true }
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
    <div className="rise-in rounded-[20px] bg-pt-raised shadow-float p-4 space-y-3 pointer-events-auto">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-pt-accent">Step {step} of {total}</p>
      <div className="text-[15px] leading-snug text-pt-text">{tip}</div>
      {(next || onSkip) && (
        <div className="flex items-center gap-3">
          {next && <button onClick={onNext} className="flex-1 rounded-xl py-3 font-bold text-stone-900 bg-pt-accent shadow-gold">{next}</button>}
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
  return (
    <>
      {/* The dim with a hole (taps go through the hole only) */}
      <div aria-hidden className="fixed z-[70] rounded-2xl pointer-events-none tour-ring transition-all duration-300 ease-spring"
        style={{ ...hole, boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)' }} />
      <div className="fixed z-[70] inset-x-0 top-0" style={{ height: Math.max(0, hole.top) }} />
      <div className="fixed z-[70] inset-x-0 bottom-0" style={{ top: hole.top + hole.height }} />
      <div className="fixed z-[70] left-0" style={{ top: hole.top, height: hole.height, width: Math.max(0, hole.left) }} />
      <div className="fixed z-[70] right-0" style={{ top: hole.top, height: hole.height, left: hole.left + hole.width }} />
      <div className="fixed z-[71] inset-x-4 pointer-events-none" style={below ? { top: Math.min(h - 220, hole.top + hole.height + 14) } : { bottom: Math.min(h - 220, h - hole.top + 14) }}>
        {card}
      </div>
    </>
  )
}
