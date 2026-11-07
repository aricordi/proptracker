// A chat answer that types out word by word (owner, Nov 7). The reply is already complete; this only reveals it quickly
// (≤ 1.2 s). Shown at once when `animate` is off (answers already on screen) or the phone asks for less motion.
// Tapping the bubble shows the rest straight away.
import { useEffect, useMemo, useRef, useState } from 'react'
import RichText from './RichText'
import { revealMs, wordPieces, wordsShown } from '../lib/typeOut'

const lessMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function TypeOut({ text, animate, onDone, onGrow, className }: {
  text: string; animate: boolean; onDone?: () => void; onGrow?: () => void; className?: string
}) {
  const pieces = useMemo(() => wordPieces(text), [text])
  const typing = animate && !lessMotion() && pieces.length > 1
  const [n, setN] = useState(typing ? 1 : pieces.length)
  const done = useRef(false)
  const cb = useRef({ onDone, onGrow }); cb.current = { onDone, onGrow }
  const finish = () => { setN(pieces.length); if (!done.current) { done.current = true; cb.current.onDone?.() } }

  useEffect(() => {
    if (!typing) { finish(); return }
    const t0 = performance.now(), total = revealMs(pieces.length)
    const id = setInterval(() => {
      const ms = performance.now() - t0
      setN(wordsShown(pieces.length, ms)); cb.current.onGrow?.()
      if (ms >= total) { clearInterval(id); finish() }
    }, 25)
    return () => clearInterval(id)
  }, [text, typing])

  const full = n >= pieces.length
  return (
    <div className={className} onClick={full ? undefined : finish}>
      {full ? <RichText text={text} /> : <>
        <span className="sr-only">{text}</span>
        <div aria-hidden><RichText text={pieces.slice(0, n).join('')} /></div>
      </>}
    </div>
  )
}
