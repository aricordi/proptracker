import { useEffect, useRef } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

// How far (px) a downward swipe must go before the sheet closes; shorter swipes spring back.
const CLOSE_AFTER = 110

export default function BottomSheet({ open, onClose, title, children }: Props) {
  // Prevent body scroll while sheet is open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Swipe down to close (owner, Oct 19). Starts on the handle/title, or anywhere once the content is
  // scrolled to the top, so scrolling the sheet's content still works normally.
  const sheet = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; dy: number; on: boolean } | null>(null)
  const setY = (y: number, animate: boolean) => {
    const el = sheet.current
    if (!el) return
    // `translate` (not `transform`) so it doesn't fight the slide-up animation, which holds `transform`.
    el.style.transition = animate ? 'translate 250ms cubic-bezier(.32,.72,0,1)' : 'none'
    el.style.translate = y ? `0 ${y}px` : ''
  }
  const onStart = (e: React.TouchEvent) => {
    const inBody = body.current?.contains(e.target as Node)
    if (inBody && (body.current!.scrollTop > 0)) return
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dy: 0, on: !inBody }
  }
  const onMove = (e: React.TouchEvent) => {
    const d = drag.current
    if (!d) return
    d.dy = e.touches[0].clientY - d.y
    // Sideways swipes (day strips, chips) are never a close.
    if (!d.on && Math.abs(e.touches[0].clientX - d.x) > Math.abs(d.dy)) { drag.current = null; return }
    // In the content, only a downward pull from the top turns into a drag.
    if (!d.on) { if (d.dy > 8 && (body.current?.scrollTop ?? 0) <= 0) d.on = true; else if (d.dy < 0) { drag.current = null; return } else return }
    if (d.dy > 0) setY(d.dy, false)
  }
  const onEnd = () => {
    const d = drag.current
    drag.current = null
    if (!d?.on) return
    if (d.dy > CLOSE_AFTER) { setY(window.innerHeight, true); setTimeout(onClose, 200) }
    else setY(0, true)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/55 fade-in" onClick={onClose} />

      {/* Sheet */}
      <div ref={sheet} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}
        className="relative bg-pt-surface rounded-t-[28px] pb-safe max-h-[85vh] flex flex-col shadow-float sheet-up">
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-2 shrink-0">
          <div className="w-9 h-[5px] rounded-full bg-white/20" />
        </div>

        {title && (
          <div className="px-6 pb-2 pt-2 shrink-0">
            <h2 className="font-display text-[22px] text-pt-text">{title}</h2>
          </div>
        )}

        <div ref={body} className="overflow-y-auto overscroll-contain px-6 pt-3 pb-6">{children}</div>
      </div>
    </div>
  )
}
