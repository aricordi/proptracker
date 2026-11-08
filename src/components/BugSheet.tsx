// The "Report a problem" form, loaded only when someone opens it (Nov 8: not part of every app start).
import { useRef, useState } from 'react'
import { useSession } from '../auth'
import BottomSheet from './BottomSheet'
import ProofPhotos from './ProofPhotos'
import { Icon } from './Icon'
import { recentErrors, recentPages } from '../lib/bugLog'
import { friendlyError } from '../lib/errors'
import { reportBug, type BugKind } from '../services/bugs'
import { IS_PRACTICE } from './PracticeBar'

const KINDS: { k: BugKind; title: string; detail: string; icon: 'x' | 'eye' | 'search' }[] = [
  { k: 'broken', title: 'Something broke', detail: 'An error, a button that does nothing, it froze', icon: 'x' },
  { k: 'wrong', title: 'Something looks wrong', detail: 'Wrong info, odd layout, not what I expected', icon: 'eye' },
  { k: 'missing', title: 'Something is missing', detail: "I should see something here and don't", icon: 'search' },
]



export default function BugSheet({ shot, page, onClose }: { shot: string | null; page: string; onClose: () => void }) {
  const session = useSession()
  const [kind, setKind] = useState<BugKind | null>(null)
  const [what, setWhat] = useState('')
  const [expected, setExpected] = useState('')
  const [keepShot, setKeepShot] = useState(!!shot)
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [details, setDetails] = useState(false)
  const folder = `bug-reports/${(session.user.email ?? '').toLowerCase()}`
  const sentOnce = useRef(false)

  async function send() {
    if (!kind || what.trim().length < 3 || sentOnce.current) return
    sentOnce.current = true
    setSending(true); setError(null)
    try {
      const shots = [...photos]
      if (shot && keepShot) {
        const st = await import('../lib/storage')
        const r = st.ref(st.storage, `${folder}/${Date.now()}_screen.jpg`)
        await st.uploadString(r, shot, 'data_url', { contentType: 'image/jpeg' })
        shots.unshift(await st.getDownloadURL(r))
      }
      await reportBug({
        kind, what: what.trim(), expected: expected.trim(), screenshots: shots,
        context: {
          page, trail: recentPages(), errors: recentErrors(),
          agent: navigator.userAgent, width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio,
          standalone: window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
          online: navigator.onLine, lang: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          build: typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev',
          role: session.realRole, viewAs: session.viewingAs ?? (session.creatorMode ? 'creator mode' : ''),
          desk: document.documentElement.classList.contains('desk') || window.innerWidth >= 1100, practice: IS_PRACTICE,
        },
      })
      setDone(true)
    } catch (e) {
      sentOnce.current = false
      setError(friendlyError(e, "Couldn't send it. Try again in a moment."))
    } finally { setSending(false) }
  }

  const input = 'w-full rounded-2xl bg-pt-bg shadow-hairline px-4 py-3 text-[16px] text-pt-text placeholder-pt-muted outline-none focus:shadow-[0_0_0_2px_rgba(201,169,97,.6)]'
  return (
    <BottomSheet open onClose={onClose} title={done ? 'Thanks!' : 'Report a problem'}>
      {done ? (
        <div className="space-y-4 pb-2">
          <p className="text-pt-text text-[16px]">Sent. The screenshot and details went with it, so there's nothing else to do.</p>
          <p className="text-pt-muted text-[14px]">If it stops you from working right now, tell the team too.</p>
          <button onClick={onClose} className="w-full min-h-[52px] rounded-2xl bg-pt-accent text-stone-900 font-semibold">Done</button>
        </div>
      ) : (
        <div className="space-y-4 pb-2">
          <div className="space-y-2">
            {KINDS.map(o => (
              <button key={o.k} onClick={() => setKind(o.k)} aria-pressed={kind === o.k}
                className={`w-full flex items-center gap-3 text-left rounded-2xl px-4 py-3 min-h-[60px] ${kind === o.k ? 'bg-pt-accent/15 shadow-[inset_0_0_0_1.5px_rgba(201,169,97,.8)]' : 'bg-pt-bg shadow-hairline'}`}>
                <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${kind === o.k ? 'bg-pt-accent text-stone-900' : 'bg-white/[0.07] text-pt-muted'}`}><Icon name={o.icon} className="w-4 h-4" /></span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-semibold text-pt-text">{o.title}</span>
                  <span className="block text-[14px] text-pt-muted">{o.detail}</span>
                </span>
              </button>
            ))}
          </div>
          <label className="block space-y-1.5">
            <span className="text-[14px] text-pt-muted">What happened?</span>
            <textarea value={what} onChange={e => setWhat(e.target.value)} rows={3} maxLength={1500} className={input}
              placeholder={kind === 'missing' ? 'e.g. My Thursday shoot isn’t in my list' : 'e.g. I tapped Send and nothing happened'} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[14px] text-pt-muted">What did you expect? <span className="text-pt-muted/70">(optional)</span></span>
            <input value={expected} onChange={e => setExpected(e.target.value)} maxLength={800} className={input} />
          </label>
          <div className="space-y-2">
            <p className="text-[14px] text-pt-muted">Screenshots</p>
            <div className="flex gap-2 items-start">
              {shot && keepShot && (
                <div className="relative shrink-0">
                  <img src={shot} alt="Screenshot of the screen you were on" className="w-20 h-36 object-cover object-top rounded-xl shadow-hairline bg-pt-bg" />
                  <button onClick={() => setKeepShot(false)} aria-label="Don't send this screenshot"
                    className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-pt-raised shadow-float text-pt-text text-sm">✕</button>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <ProofPhotos folder={folder} urls={photos} onChange={setPhotos} onUploading={setUploading} cameraOnly={false} max={3}
                  label="Add your own screenshot or photo" />
              </div>
            </div>
            {!shot && <p className="text-[12px] text-pt-muted">This phone couldn't take the screenshot by itself. Add one from your photos if you can.</p>}
          </div>
          <button onClick={() => setDetails(d => !d)} className="text-[14px] text-pt-muted tap text-left">
            Also sent: this page, the last pages you opened, your phone and app version, and recent errors. {details ? 'Hide' : 'Show'}
          </button>
          {details && (
            <pre className="text-[12px] leading-relaxed text-pt-muted bg-pt-bg rounded-xl p-3 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
              {[`Page: ${page}`, `Pages: ${recentPages().join(' → ') || '–'}`, `Errors: ${recentErrors().join('\n') || 'none'}`, `Phone: ${navigator.userAgent}`].join('\n')}
            </pre>
          )}
          <p className="text-[12px] text-pt-muted">Tip: hold two fingers on any screen to report it straight away.</p>
          {error && <p className="text-red-300 text-[14px]">{error}</p>}
          <button onClick={() => void send()} disabled={!kind || what.trim().length < 3 || sending || uploading}
            className="w-full min-h-[52px] rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">
            {sending ? 'Sending…' : uploading ? 'Adding your photo…' : !kind ? 'Pick what kind of problem' : what.trim().length < 3 ? 'Say what happened' : 'Send report'}
          </button>
        </div>
      )}
    </BottomSheet>
  )
}

/** A menu row for Me / More, Help and the team menus. */
