import { useEffect, useRef, useState } from 'react'

interface Props {
  src: string
  alt: string
  onClose: () => void
}

export default function ImageLightbox({ src, alt, onClose }: Props) {
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [animate, setAnimate] = useState(false)

  const pinchDistRef = useRef<number | null>(null)
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null)
  const lastTapRef   = useRef<number>(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  function zoomTo(s: number, animated = false) {
    setAnimate(animated)
    setScale(s)
    if (s <= 1) setPan({ x: 0, y: 0 })
  }

  function handleTouchStart(e: React.TouchEvent) {
    e.stopPropagation()
    if (e.touches.length === 2) {
      setAnimate(false)
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinchDistRef.current = Math.hypot(dx, dy)
      lastTouchRef.current = null
    } else if (e.touches.length === 1) {
      const now = Date.now()
      if (now - lastTapRef.current < 280) {
        if (scale > 1) zoomTo(1, true)
        else zoomTo(2.5, true)
        lastTapRef.current = 0
      } else {
        lastTapRef.current = now
      }
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    e.stopPropagation()
    if (e.touches.length === 2 && pinchDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      setScale(s => Math.max(1, Math.min(5, s * (dist / pinchDistRef.current!))))
      setAnimate(false)
      pinchDistRef.current = dist
    } else if (e.touches.length === 1 && scale > 1 && lastTouchRef.current) {
      const dx = e.touches[0].clientX - lastTouchRef.current.x
      const dy = e.touches[0].clientY - lastTouchRef.current.y
      setPan(p => ({ x: p.x + dx, y: p.y + dy }))
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    } else if (e.touches.length === 1 && lastTouchRef.current) {
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinchDistRef.current = null
    if (e.touches.length === 0) {
      lastTouchRef.current = null
      if (scale < 1.05) zoomTo(1, true)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black" onClick={onClose}>
      {/* Close button */}
      <div className="absolute top-0 right-0 pt-safe pr-4 z-10">
        <button
          onClick={e => { e.stopPropagation(); onClose() }}
          className="w-10 h-10 flex items-center justify-center text-white/80 bg-black/50 rounded-full active:bg-black/80 mt-2"
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Image */}
      <div
        className="w-full h-full flex items-center justify-center overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={e => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-w-full max-h-full object-contain select-none pointer-events-none"
          style={{
            transform: `scale(${scale}) translate(${pan.x / scale}px, ${pan.y / scale}px)`,
            transition: animate ? 'transform 0.25s ease' : 'none',
            touchAction: 'none',
          }}
        />
      </div>

      {scale === 1 && (
        <p className="absolute bottom-8 inset-x-0 text-center text-white/30 text-xs pointer-events-none select-none pb-safe">
          Pinch or double-tap to zoom
        </p>
      )}
    </div>
  )
}
