import { useEffect, useRef, useState } from 'react'

// Hide part of a header while scrolling down through a list, bring it back when
// scrolling up (or near the top). Attach the returned ref to any element inside the
// scrolling area; it finds the scroll container itself (the app's <main>, else the page).
export function useHideOnScroll<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null)
  const [hidden, setHidden] = useState(false)
  const state = useRef(false)   // same as `hidden`, readable inside the scroll handler

  useEffect(() => {
    if (!enabled) { state.current = false; setHidden(false); return }
    const el = ref.current?.closest('main') as HTMLElement | null
    const target: HTMLElement | Window = el ?? window
    const pos = () => (el ? el.scrollTop : window.scrollY)
    // The header changing height must not make the browser nudge the scroll
    // position (that nudge looks like scrolling up, and the header would flicker).
    const scroller = el ?? document.documentElement
    const before = scroller.style.overflowAnchor
    scroller.style.overflowAnchor = 'none'
    let last = pos(), quietUntil = 0
    const set = (h: boolean) => {
      if (h === state.current) return
      state.current = h; setHidden(h)
      quietUntil = Date.now() + 300   // ignore the jiggle while the header animates
    }
    const onScroll = () => {
      const y = pos(), d = y - last
      if (y < 60) { set(false); last = y; return }       // near the top: always show
      if (Date.now() < quietUntil) { last = y; return }
      if (d > 8) set(true)                               // scrolling down through photos
      else if (d < -8) set(false)                        // scrolling back up a little
      if (Math.abs(d) > 8) last = y
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => { target.removeEventListener('scroll', onScroll); scroller.style.overflowAnchor = before }
  }, [enabled])

  return { ref, hidden, show: () => { state.current = false; setHidden(false) } }
}
