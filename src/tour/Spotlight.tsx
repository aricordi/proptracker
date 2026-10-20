// The tour's coach panel (owner, Oct 20: "best practice UX and clarity… people shouldn't fight the UX"):
// - everything is dimmed except the one thing to use (found by data-tour="<target>");
// - the tip is ALWAYS docked to the top or bottom edge of the screen (never floating over what you're doing);
// - every tip has the same shape: part + progress, a bold "what to do" line, one line of "why", and a footer that
//   either says "Tap the highlighted part" or has Continue (with the reason when it's greyed out), plus ‹ Back;
// - a tap anywhere else is ignored but says so in the tip; scrolling works everywhere;
// - while a text box is focused (iPhone keyboard up) only a slim Continue bar shows, just above the keyboard.
// Calm on purpose (owner, Oct 19): no pulsing, no sliding, no pop-in.
import { useEffect, useRef, useState, type ReactNode } from 'react'

const PAD = 6
export const PART_NAMES = ['Find your way around', 'Book your first shoot', 'Add props and gear', 'Check on your request', 'Try the AI', 'When a friend invites you', 'Shoot day', 'Bring it all back', 'Turn on notifications']

export interface Coach {
  title: ReactNode; body?: ReactNode
  part?: number; stepInPart?: number; stepsInPart?: number
  next?: string; nextDisabled?: boolean; disabledHint?: string
  onNext?: () => void; onBack?: () => void; onSkip?: () => void; onClose?: () => void
}

// Scroll the nearest scrolling box (a sheet or the page) so the element sits clear of the coach panel and the edges.
function keepInView(el: HTMLElement, topGap: number, bottomGap: number) {
  const box = el.parentElement?.closest<HTMLElement>('.overflow-y-auto')
  if (!box) return
  const b = el.getBoundingClientRect(), h = window.innerHeight
  const below = b.bottom - (h - bottomGap), above = topGap - b.top
  if (below > 0) box.scrollTop += Math.min(below, Math.max(0, -above))
  else if (above > 0) box.scrollTop -= above
}

function Panel({ c, nudge, innerRef }: { c: Coach; nudge: boolean; innerRef: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={innerRef} className="rounded-[20px] bg-pt-raised shadow-float px-4 py-3.5 space-y-2 pointer-events-auto">
      {c.part ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-xs font-semibold text-pt-accent">Part {c.part} of {PART_NAMES.length} · {PART_NAMES[c.part - 1]}</p>
            {c.stepsInPart && c.stepsInPart > 1 ? <span className="text-xs text-pt-muted tabular-nums">{c.stepInPart} of {c.stepsInPart}</span> : null}
            {c.onClose && <button onClick={c.onClose} aria-label="Close the tour" className="tap text-pt-muted text-sm">✕</button>}
          </div>
          <div className="flex gap-1" aria-hidden>{PART_NAMES.map((_, i) => <i key={i} className={`flex-1 h-1 rounded-full ${i < (c.part ?? 0) ? 'bg-pt-accent' : 'bg-pt-border'}`} />)}</div>
        </div>
      ) : c.onClose && <div className="flex justify-end"><button onClick={c.onClose} aria-label="Close the tour" className="tap text-pt-muted text-sm">✕</button></div>}
      <p className="text-[16px] font-semibold leading-snug text-pt-text">{c.title}</p>
      {c.body && <div className="text-[13px] leading-snug text-pt-muted">{c.body}</div>}
      <div className="flex items-center gap-3 pt-1">
        {c.onBack && <button onClick={c.onBack} className="shrink-0 rounded-xl px-3 py-3 text-[15px] text-pt-text bg-pt-border">‹ Back</button>}
        {c.next
          ? <button onClick={c.onNext} disabled={c.nextDisabled} className="flex-1 rounded-xl py-3 font-bold text-stone-900 bg-pt-accent shadow-gold disabled:opacity-40 disabled:shadow-none">{c.next}</button>
          : <p className={`flex-1 text-[13px] ${nudge ? 'text-pt-accent font-semibold' : 'text-pt-muted'}`}>👆 {nudge ? 'Tap the highlighted part to keep going' : 'Tap the highlighted part'}</p>}
        {c.onSkip && <button onClick={c.onSkip} className="tap shrink-0 text-pt-muted text-sm underline">No camera? Skip</button>}
      </div>
      {c.next && c.nextDisabled && c.disabledHint && <p className={`text-[13px] ${nudge ? 'text-pt-accent font-semibold' : 'text-pt-muted'}`}>{c.disabledHint}</p>}
      {c.next && !c.nextDisabled && nudge && <p className="text-[13px] text-pt-accent font-semibold">Use the highlighted part, or tap {c.next}.</p>}
    </div>
  )
}

// dim = false: just a gold outline, the rest of the screen stays bright (steps where you're only looking around).
export function Spotlight({ target, top, dim = true, ...c }: Coach & { target?: string; top?: boolean; dim?: boolean }) {
  const [r, setR] = useState<DOMRect | null>(null)
  const [side, setSide] = useState<'top' | 'bottom'>('bottom')
  const cardRef = useRef<HTMLDivElement>(null)
  const [nudge, setNudge] = useState(false)

  // Taps outside the highlight (and outside the panel) are ignored, and the panel says so for a moment.
  useEffect(() => {
    if (!target) return
    let t = 0
    const stop = (e: Event) => {
      const el = document.querySelector(`[data-tour="${target}"]`), n = e.target as Node
      if (el?.contains(n) || cardRef.current?.contains(n)) return
      e.preventDefault(); e.stopPropagation()
      setNudge(true); clearTimeout(t); t = window.setTimeout(() => setNudge(false), 2500)
    }
    document.addEventListener('click', stop, true)
    return () => { document.removeEventListener('click', stop, true); clearTimeout(t) }
  }, [target])

  // iPhone keyboard: the page slides up, so the dim would land in the wrong place. While a text box is focused only a
  // slim Continue bar shows, just above the keyboard (visualViewport = the part of the screen you can see).
  const [typing, setTyping] = useState(false)
  const [vv, setVv] = useState({ top: 0, height: typeof window !== 'undefined' ? window.innerHeight : 800 })
  useEffect(() => {
    const isText = (el: Element | null) => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'file'].includes((el as HTMLInputElement).type)))
    const on = (e: FocusEvent) => { if (isText(e.target as Element)) setTyping(true) }
    const off = () => setTimeout(() => { if (!isText(document.activeElement)) { setTyping(false); window.scrollTo(0, 0) } }, 50)
    document.addEventListener('focusin', on); document.addEventListener('focusout', off)
    const v = window.visualViewport, update = () => v && setVv({ top: v.offsetTop, height: v.height })
    update(); v?.addEventListener('resize', update); v?.addEventListener('scroll', update)
    return () => { document.removeEventListener('focusin', on); document.removeEventListener('focusout', off); v?.removeEventListener('resize', update); v?.removeEventListener('scroll', update) }
  }, [])

  // Find the target, pick the panel's edge once (away from the target), keep the target in view, follow it while scrolling.
  useEffect(() => {
    setR(null)
    if (!target) return
    let raf = 0, last = '', height = -1, chosen: 'top' | 'bottom' | null = null
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
      if (el) {
        const h = window.innerHeight
        if (!chosen) {
          const b0 = el.getBoundingClientRect()
          chosen = top || (b0.height < h * 0.6 && b0.top + b0.height / 2 > h * 0.5) ? 'top' : 'bottom'
          setSide(chosen)
        }
        const hh = Math.round(el.offsetHeight)
        if (hh !== height) {
          height = hh
          const panel = (cardRef.current?.offsetHeight ?? 190) + 24
          // Clear of the panel, and of the sticky header / bottom button bars on the other side.
          if (hh < h * 0.6) keepInView(el, chosen === 'top' ? panel + 8 : 100, chosen === 'bottom' ? panel + 8 : 110)
        }
        const b = el.getBoundingClientRect()
        const k = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`
        if (k !== last) { last = k; setR(b) }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [target, top])

  // Nothing to point at (part intros, info cards): a card in the middle of a dimmed screen.
  if (!target) return (
    <div className="fixed inset-0 z-[70] bg-black/65 grid place-items-center px-4">
      <div className="w-full max-w-sm"><Panel c={c} nudge={false} innerRef={cardRef} /></div>
    </div>
  )
  if (typing) return c.next ? (
    <div ref={cardRef} className="fixed z-[71] inset-x-4" style={{ top: vv.top + vv.height - 64 }}>
      <button onClick={c.onNext} disabled={c.nextDisabled} className="w-full rounded-xl py-3 font-bold text-stone-900 bg-pt-accent shadow-gold disabled:opacity-40 disabled:shadow-none">{c.nextDisabled && c.disabledHint ? c.disabledHint : c.next}</button>
    </div>
  ) : null
  if (!r) return null

  const hole = { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
  return (
    <>
      {/* The dim with a hole around the thing to use */}
      <div aria-hidden className="fixed z-[70] rounded-2xl pointer-events-none"
        style={{ ...hole, boxShadow: dim ? '0 0 0 2px rgba(201,169,97,0.9), 0 0 0 9999px rgba(0,0,0,0.6)' : '0 0 0 2px rgba(201,169,97,0.95), 0 0 24px 2px rgba(201,169,97,0.25)' }} />
      <div className="fixed z-[71] inset-x-3 pointer-events-none"
        style={side === 'top' ? { top: 'calc(env(safe-area-inset-top) + 8px)' } : { bottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
        <Panel c={c} nudge={nudge} innerRef={cardRef} />
      </div>
    </>
  )
}
