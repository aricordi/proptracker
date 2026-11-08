// "Report a problem" (owner, Nov 5: "takes screenshots and data… when people encounter bugs, see something unexpected,
// or miss something they should see"). Everyone can send one, from anywhere:
//  - Me / More, Help, every team menu, the chat ("the app is broken"): a slim bar asks them to go to the screen with the
//    problem first, then "Report this screen" takes the screenshot there (a screenshot of a menu helps nobody);
//  - a two-finger press and hold anywhere: screenshot of this screen straight away.
// The form: what kind (broke / looks wrong / missing), what happened, what they expected, the screenshot (can be removed)
// + their own photos. What the app also sends is listed on the form: the page, the last pages, phone + app version and
// recent errors (src/lib/bugLog.ts). The owner reads them on /bugs.
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Icon } from './Icon'
import { notePage } from '../lib/bugLog'

interface Ctx { start: () => void; now: () => void }
const BugCtx = createContext<Ctx>({ start: () => {}, now: () => {} })
export const useBugReport = () => useContext(BugCtx)

const BugSheet = lazy(() => import('./BugSheet'))

/** A picture of the screen as it is right now (the app's own page, drawn into a JPEG). Null if the phone can't. */
async function snapScreen(): Promise<string | null> {
  try {
    const { toJpeg } = await import('html-to-image')
    const root = document.getElementById('root') ?? document.body
    const w = window.innerWidth, h = window.innerHeight
    const shot = toJpeg(root, {
      quality: 0.7, pixelRatio: Math.min(2, window.devicePixelRatio || 1), backgroundColor: '#000000',
      width: w, height: h, style: { transform: `translateY(-${root.scrollTop}px)` },
      // Photos from other addresses can't always be copied into the picture: a grey square stands in.
      imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAIAAAEdHR////yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==',
      cacheBust: false, skipFonts: true,
      filter: n => !(n instanceof HTMLElement && n.dataset.bugSkip !== undefined),
    })
    return await Promise.race([shot, new Promise<null>(res => setTimeout(() => res(null), 6000))])
  } catch { return null }
}

export function BugReportProvider({ children }: { children: ReactNode }) {
  const [aiming, setAiming] = useState(false)
  const [sheet, setSheet] = useState<{ shot: string | null; page: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const loc = useLocation()
  useEffect(() => { notePage(loc.pathname + loc.search) }, [loc.pathname, loc.search])

  const now = useCallback(async () => {
    setAiming(false); setBusy(true)
    const page = window.location.pathname + window.location.search
    const shot = await snapScreen()
    setBusy(false)
    setSheet({ shot, page })
  }, [])
  const start = useCallback(() => setAiming(true), [])

  // Two fingers held on the screen for a moment = report this screen (a shortcut; also written on the form).
  useEffect(() => {
    let t: number | undefined
    const down = (e: TouchEvent) => { if (e.touches.length === 2) { clearTimeout(t); t = window.setTimeout(() => { void now() }, 900) } else clearTimeout(t) }
    const up = () => clearTimeout(t)
    window.addEventListener('touchstart', down, { passive: true })
    window.addEventListener('touchend', up, { passive: true })
    window.addEventListener('touchmove', up, { passive: true })
    return () => { window.removeEventListener('touchstart', down); window.removeEventListener('touchend', up); window.removeEventListener('touchmove', up) }
  }, [now])

  return (
    <BugCtx.Provider value={{ start, now }}>
      {children}
      {aiming && (
        <div data-bug-skip className="fixed inset-x-3 z-[70] bottom-[calc(env(safe-area-inset-bottom)+76px)] mx-auto max-w-[480px] rounded-2xl bg-pt-raised shadow-float p-3 space-y-2">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-full bg-amber-400/15 text-amber-300 flex items-center justify-center shrink-0"><Icon name="alert" className="w-4 h-4" /></span>
            <p className="flex-1 min-w-0 text-[14px] text-pt-text leading-snug">Go to the screen with the problem, then tap <b>Report this screen</b>.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setAiming(false)} className="min-h-[44px] px-4 rounded-full bg-pt-bg shadow-hairline text-pt-text text-[14px]">Cancel</button>
            <button onClick={() => void now()} className="flex-1 min-h-[44px] px-4 rounded-full bg-pt-accent text-stone-900 text-[14px] font-semibold">Report this screen</button>
          </div>
        </div>
      )}
      {busy && (
        <div data-bug-skip className="fixed inset-x-0 z-[70] bottom-[calc(env(safe-area-inset-bottom)+90px)] flex justify-center pointer-events-none">
          <p className="rounded-full bg-pt-raised shadow-float px-4 py-2 text-[14px] text-pt-text">Taking a screenshot…</p>
        </div>
      )}
      {sheet && <Suspense fallback={null}><BugSheet shot={sheet.shot} page={sheet.page} onClose={() => setSheet(null)} /></Suspense>}
    </BugCtx.Provider>
  )
}


export function ReportProblemRow({ className = '' }: { className?: string }) {
  const { start } = useBugReport()
  return (
    <button onClick={start} className={`w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-left rounded-2xl bg-pt-surface shadow-hairline active:opacity-80 ${className}`}>
      <span className="w-9 h-9 rounded-full bg-amber-400/15 text-amber-300 flex items-center justify-center shrink-0"><Icon name="alert" className="w-4 h-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] text-pt-text font-medium">Report a problem</span>
        <span className="block text-[14px] text-pt-muted">Something broke, looks wrong or is missing</span>
      </span>
      <span className="text-pt-muted" aria-hidden>›</span>
    </button>
  )
}
