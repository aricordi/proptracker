// The tour's coach (owner, Oct 20: "more visual… nicer, smoother… like a polished App Store app… fun, with character"):
// - Cap (the Prime Capitol eagle) talks in a cream card that sits right next to the thing to use, with a pointer;
// - the highlight and the card stay mounted and GLIDE from one target to the next, so your eye follows them;
// - on "tap this" steps a finger slides in, taps once and fades (no loops); a wrong tap shakes the card once;
// - big targets (a whole list, a sheet) get the card docked to the top or bottom edge instead;
// - while a text box is focused (iPhone keyboard up) only a slim Continue bar shows, just above the keyboard.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { CHAPTERS, Cap, type Chapter } from './Fun'

const PAD = 6, GAP = 14, EDGE = 12
const EASE = 'cubic-bezier(.32,.72,0,1)'

export interface Coach {
  title: ReactNode; body?: ReactNode
  part?: number; stepInPart?: number; stepsInPart?: number; chapters?: Chapter[]
  next?: string; nextDisabled?: boolean; disabledHint?: string
  onNext?: () => void; onBack?: () => void; onSkip?: () => void; onClose?: () => void
}
type Box = { x: number; y: number; w: number; h: number }

// Scroll the nearest scrolling box (a sheet or the page) so the element sits clear of the card and the edges.
function keepInView(el: HTMLElement, topGap: number, bottomGap: number) {
  const box = el.parentElement?.closest<HTMLElement>('.overflow-y-auto')
  if (!box) return
  const b = el.getBoundingClientRect(), h = window.innerHeight
  const below = b.bottom - (h - bottomGap), above = topGap - b.top
  if (below > 0) box.scrollTop += Math.min(below, Math.max(0, -above))
  else if (above > 0) box.scrollTop -= above
}

// The phone's safe areas (notch, home bar), read once from CSS.
function useSafe() {
  const [safe, setSafe] = useState({ top: 0, bottom: 0 })
  useEffect(() => {
    const p = document.createElement('div')
    p.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)'
    document.body.appendChild(p)
    const cs = getComputedStyle(p)
    setSafe({ top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 })
    p.remove()
  }, [])
  return safe
}

function Card({ c, nudge, stepKey }: { c: Coach; nudge: number; stepKey?: string }) {
  const ch = c.part ? (c.chapters ?? CHAPTERS)[c.part - 1] : null
  return (
    <div key={stepKey} className="coach-in">
      <div key={nudge} className={nudge ? 'coach-nudge' : ''}>
        <div className="flex items-center gap-2.5 mb-2.5">
          <Cap size={30} className="cap-bob" />
          <span className="font-semibold text-[15px] text-stone-900">Cap</span>
          {ch && <span className="ml-auto text-[13px] text-stone-500 truncate">Ch {c.part} · {ch.name}</span>}
          {c.onClose && <button onClick={c.onClose} aria-label="Close the tour" className={`tap text-stone-500 text-base ${ch ? '' : 'ml-auto'}`}>✕</button>}
        </div>
        {c.stepsInPart && c.stepsInPart > 1 ? (
          <div className="flex gap-1 mb-3" aria-label={`Step ${c.stepInPart} of ${c.stepsInPart}`}>
            {Array.from({ length: c.stepsInPart }, (_, i) => <i key={i} className={`h-1 rounded-full transition-all duration-500 ${i < (c.stepInPart ?? 0) ? 'bg-[#9C7B32]' : 'bg-stone-300'}`} style={{ flex: i === (c.stepInPart ?? 0) - 1 ? 2 : 1 }} />)}
          </div>
        ) : null}
        <p className="text-[20px] font-bold leading-snug text-stone-900 tracking-[-0.01em]">{c.title}</p>
        {c.body && <div className="text-[16px] leading-relaxed text-stone-700 mt-1.5">{c.body}</div>}
        <div className="flex items-center gap-3 mt-4">
          {c.onBack && <button onClick={c.onBack} className="shrink-0 px-1 py-3 text-[15px] font-semibold text-stone-500">Back</button>}
          {c.next
            ? <button onClick={c.onNext} disabled={c.nextDisabled} className="flex-1 rounded-2xl py-3.5 text-[16px] font-bold bg-stone-900 text-[#F6F1E6] disabled:opacity-30">{c.next}</button>
            : <p className={`flex-1 flex items-center gap-2 text-[15px] ${nudge ? 'text-stone-900 font-bold' : 'text-stone-500'}`}>
                <svg viewBox="0 0 48 48" className="w-5 h-5 shrink-0" aria-hidden><path d="M19 6a4 4 0 0 1 8 0v14l9.2 2.3a5 5 0 0 1 3.7 5.7l-1.9 11A6 6 0 0 1 32.1 44H22a6 6 0 0 1-4.7-2.3L9 31.2a4 4 0 0 1 6.1-5.1L19 30z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" /></svg>
                {nudge ? 'Tap the glowing part to keep going' : 'Tap the glowing part'}
              </p>}
          {c.onSkip && <button onClick={c.onSkip} className="tap shrink-0 text-stone-500 text-sm underline">No camera? Skip</button>}
        </div>
        {c.next && c.nextDisabled && c.disabledHint && <p className={`text-[14px] mt-2 ${nudge ? 'text-stone-900 font-semibold' : 'text-stone-500'}`}>{c.disabledHint}</p>}
      </div>
    </div>
  )
}

// dim = false: just a gold outline, the rest of the screen stays bright (steps where you're only looking around).
export function Spotlight({ target, top, dim = true, stepKey, ...c }: Coach & { target?: string; top?: boolean; dim?: boolean; stepKey?: string }) {
  const [box, setBox] = useState<Box | null>(null)
  const cardRef = useRef<HTMLDivElement>(null), barRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(220)
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [nudge, setNudge] = useState(0)
  const safe = useSafe()
  useEffect(() => setNudge(0), [stepKey])
  // Glide only when the step changes. While you scroll, the highlight sticks to its target with no animation
  // (an animated follow lags behind the finger and looks jumpy).
  const [glide, setGlide] = useState(true)
  useEffect(() => {
    setGlide(true)
    const t = setTimeout(() => setGlide(false), 600)
    const scrolled = () => setGlide(false)
    document.addEventListener('scroll', scrolled, true)
    return () => { clearTimeout(t); document.removeEventListener('scroll', scrolled, true) }
  }, [stepKey, target])

  // Taps outside the highlight (and outside the card) are ignored, and the card shakes once to say so.
  useEffect(() => {
    if (!target) return
    const stop = (e: Event) => {
      // Only real taps count: the camera button opens its hidden photo picker with a script click, which must go through.
      if (!e.isTrusted) return
      const el = document.querySelector(`[data-tour="${target}"]`), n = e.target as Node
      if (el?.contains(n) || cardRef.current?.contains(n) || barRef.current?.contains(n)) return
      e.preventDefault(); e.stopPropagation()
      setNudge(x => x + 1)
    }
    document.addEventListener('click', stop, true)
    return () => document.removeEventListener('click', stop, true)
  }, [target])

  // iPhone keyboard: the page slides up, so only a slim Continue bar shows, just above the keyboard.
  const [typing, setTyping] = useState(false)
  const [vv, setVv] = useState({ top: 0, height: window.innerHeight })
  useEffect(() => {
    const isText = (el: Element | null) => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'file'].includes((el as HTMLInputElement).type)))
    const on = (e: FocusEvent) => { if (isText(e.target as Element)) setTyping(true) }
    const off = () => setTimeout(() => { if (!isText(document.activeElement)) { setTyping(false); window.scrollTo(0, 0) } }, 50)
    const resize = () => setView({ w: window.innerWidth, h: window.innerHeight })
    document.addEventListener('focusin', on); document.addEventListener('focusout', off); window.addEventListener('resize', resize)
    const v = window.visualViewport, update = () => v && setVv({ top: v.offsetTop, height: v.height })
    update(); v?.addEventListener('resize', update); v?.addEventListener('scroll', update)
    return () => { document.removeEventListener('focusin', on); document.removeEventListener('focusout', off); window.removeEventListener('resize', resize); v?.removeEventListener('resize', update); v?.removeEventListener('scroll', update) }
  }, [])

  // The card's height (for placing it above a target).
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCardH(el.offsetHeight))
    ro.observe(el); setCardH(el.offsetHeight)
    return () => ro.disconnect()
  }, [typing])

  // Follow the target. The last box is kept while the next screen mounts, so the highlight glides instead of blinking.
  useEffect(() => {
    if (!target) { setBox(null); return }
    let raf = 0, last = '', height = -1
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
      if (el) {
        const h = window.innerHeight, hh = Math.round(el.offsetHeight)
        if (hh !== height) {
          height = hh
          const gap = (cardRef.current?.offsetHeight ?? 220) + 32
          if (hh < h * 0.45) keepInView(el, 110, gap)
          else {
            // Big area hanging off the bottom (its button out of sight): bring its top up under the card (docked top)
            // or near the top of the screen, as far as the page allows.
            const box = el.parentElement?.closest<HTMLElement>('.overflow-y-auto'), b = el.getBoundingClientRect()
            const want = top ? (cardRef.current?.offsetHeight ?? 240) + 44 : 110
            if (box && b.bottom > h && b.top > want) box.scrollTop += b.top - want
          }
        }
        const b = el.getBoundingClientRect()
        const k = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`
        if (k !== last) { last = k; setBox({ x: b.x, y: b.y, w: b.width, h: b.height }) }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [target])

  if (typing) return c.next ? (
    <div ref={barRef} className="fixed z-[71] inset-x-4" style={{ top: vv.top + vv.height - 64 }}>
      <button onClick={c.onNext} disabled={c.nextDisabled} className="w-full rounded-2xl py-3.5 font-bold text-[16px] bg-stone-900 text-[#F6F1E6] shadow-float disabled:opacity-50">{c.nextDisabled && c.disabledHint ? c.disabledHint : c.next}</button>
    </div>
  ) : null

  const W = view.w, H = view.h
  const shown = target ? box : null
  const hole = shown ? { x: shown.x - PAD, y: shown.y - PAD, w: shown.w + PAD * 2, h: shown.h + PAD * 2 } : { x: W / 2, y: H / 2, w: 0, h: 0 }
  const cardW = Math.min(W - EDGE * 2, 440)
  const minTop = safe.top + EDGE, maxTop = H - safe.bottom - EDGE - cardH
  // Where the card goes: next to the target (with a pointer), else docked to an edge, else in the middle.
  let cardTop = (H - cardH) / 2, cardLeft = (W - cardW) / 2, arrow: { x: number; up: boolean } | null = null
  if (shown) {
    const cy = hole.y + hole.h / 2, below = cy < H / 2
    const anchored = below ? hole.y + hole.h + GAP : hole.y - GAP - cardH
    const fits = !top && hole.h < H * 0.45 && anchored >= minTop && anchored <= maxTop
    if (fits) {
      cardTop = anchored
      cardLeft = Math.min(Math.max(hole.x + hole.w / 2 - cardW / 2, EDGE), W - cardW - EDGE)
      arrow = { x: Math.min(Math.max(hole.x + hole.w / 2 - cardLeft, 28), cardW - 28), up: below }
    } else cardTop = top ? minTop : hole.h >= H * 0.45 || cy <= H / 2 ? maxTop : minTop   // big areas start near the top: dock below
  }
  const tapStep = !!shown && !c.next

  return (
    <>
      <div aria-hidden className="coach-hole fixed z-[70] pointer-events-none"
        style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h, borderRadius: shown ? 18 : 999, ...(glide ? {} : { transition: 'box-shadow .4s ease' }),
          boxShadow: !shown || dim ? `${shown ? '0 0 0 2.5px rgba(201,169,97,0.95), 0 0 22px 4px rgba(201,169,97,0.35), ' : ''}0 0 0 9999px rgba(0,0,0,0.62)` : '0 0 0 2.5px rgba(201,169,97,0.95), 0 0 24px 4px rgba(201,169,97,0.3)' }} />
      {tapStep && (
        <>
          <span key={`r${stepKey}`} aria-hidden className="coach-ripple fixed z-[71] pointer-events-none rounded-full border-2 border-pt-accent" style={{ width: 44, height: 44, left: hole.x + hole.w / 2 - 22, top: hole.y + hole.h / 2 - 22 }} />
          <svg key={`f${stepKey}`} viewBox="0 0 48 48" aria-hidden className="coach-finger fixed z-[71] pointer-events-none w-12 h-12 drop-shadow-[0_6px_10px_rgba(0,0,0,0.5)]"
            style={{ left: hole.x + hole.w / 2 - 23, top: hole.y + hole.h / 2 - 6 }}>
            <path d="M19 6a4 4 0 0 1 8 0v14l9.2 2.3a5 5 0 0 1 3.7 5.7l-1.9 11A6 6 0 0 1 32.1 44H22a6 6 0 0 1-4.7-2.3L9 31.2a4 4 0 0 1 6.1-5.1L19 30z" fill="#F6F1E6" stroke="#1c1917" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </>
      )}
      <div ref={cardRef} role="dialog" aria-live="polite" className="coach-card fixed z-[71] rounded-[24px] bg-[#F6F1E6] px-4 pt-3.5 pb-3.5 shadow-float"
        style={{ top: cardTop, left: cardLeft, width: cardW, transition: glide ? `top .55s ${EASE}, left .55s ${EASE}` : 'none' }}>
        {arrow && <span aria-hidden className="coach-arrow absolute w-4 h-4 rotate-45 rounded-[3px] bg-[#F6F1E6]" style={{ left: arrow.x - 8, ...(glide ? {} : { transition: 'none' }), ...(arrow.up ? { top: -6 } : { bottom: -6 }) }} />}
        <Card c={c} nudge={nudge} stepKey={stepKey} />
      </div>
    </>
  )
}
