// Opening screen: the white Prime Capitol eagle and name, once per visit. Tap to skip.
import { useEffect, useState } from 'react'
import BrandMark from './BrandMark'

const KEY = 'primecapitol.splashSeen'

export default function Splash() {
  const [show, setShow] = useState(() => { try { return !sessionStorage.getItem(KEY) } catch { return false } })
  const [fading, setFading] = useState(false)
  useEffect(() => {
    if (!show) return
    try { sessionStorage.setItem(KEY, '1') } catch { /* private mode: fine */ }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const t1 = setTimeout(() => setFading(true), reduce ? 300 : 1400)
    const t2 = setTimeout(() => setShow(false), reduce ? 500 : 1900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [show])
  if (!show) return null
  return (
    <button onClick={() => setShow(false)} aria-label="Skip"
      className={`fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center gap-5 transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}>
      <BrandMark className="w-40 text-pt-text splash-rise drop-shadow-[0_0_22px_rgba(255,255,255,0.18)]" title="" />
      <span className="splash-rise-late text-pt-text font-extrabold text-sm tracking-[0.42em] pl-[0.42em]">PRIME CAPITOL</span>
    </button>
  )
}
