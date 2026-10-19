// Turning phone notifications on: the card on Me, the short prompt on Home, and the iPhone
// "Add to Home Screen" guide (iPhone only allows notifications in the app on the Home Screen).
import { useState } from 'react'
import BottomSheet from './BottomSheet'
import { pushState, turnOnPush, turnOffPush, testPush, isIOS, type PushState } from '../services/push'
import { errorText } from '../services/schedule'

const bell = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" /><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0" />
  </svg>
)

function usePush() {
  const [state, setState] = useState<PushState>(() => pushState())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function on() {
    setBusy(true); setMsg('')
    try { setState(await turnOnPush()) } catch (e) { setMsg(errorText(e)) } finally { setBusy(false) }
  }
  async function off() { setBusy(true); await turnOffPush(); setState(pushState()); setBusy(false) }
  async function test() {
    setBusy(true); setMsg('')
    try { const r = await testPush(); setMsg(r.data.sent ? 'Sent ✓ It should pop up in a few seconds.' : 'Nothing was sent. Turn notifications off and on again.') }
    catch (e) { setMsg(errorText(e)) } finally { setBusy(false) }
  }
  return { state, busy, msg, on, off, test }
}

// Me tab.
export function NotificationsCard() {
  const p = usePush()
  const [guide, setGuide] = useState(false)
  return (
    <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className={`w-11 h-11 rounded-full grid place-items-center shrink-0 ${p.state === 'on' ? 'bg-pt-accent/15 text-pt-accent' : 'bg-pt-bg text-pt-muted'}`}>{bell}</span>
        <span className="flex-1 min-w-0">
          <b className="block text-pt-text">Notifications</b>
          <span className="block text-pt-muted text-xs">{{
            on: 'On for this phone',
            off: 'Invites, swaps, props ready, shoot reminders',
            blocked: 'Blocked in your phone settings',
            'needs-install': 'Add the app to your Home Screen first',
            unsupported: "This browser can't show them",
          }[p.state]}</span>
        </span>
        {p.state === 'off' && <button disabled={p.busy} onClick={p.on} className="shrink-0 bg-pt-accent text-stone-900 font-semibold rounded-full px-4 min-h-[40px] text-sm shadow-gold disabled:opacity-40">Turn on</button>}
        {p.state === 'needs-install' && <button onClick={() => setGuide(true)} className="shrink-0 bg-pt-accent text-stone-900 font-semibold rounded-full px-4 min-h-[40px] text-sm shadow-gold">How</button>}
      </div>
      {p.state === 'on' && (
        <div className="flex gap-2">
          <button disabled={p.busy} onClick={p.test} className="flex-1 bg-pt-raised rounded-xl min-h-[44px] text-sm text-pt-text disabled:opacity-40">Send me a test</button>
          <button disabled={p.busy} onClick={p.off} className="flex-1 bg-pt-raised rounded-xl min-h-[44px] text-sm text-pt-muted disabled:opacity-40">Turn off</button>
        </div>
      )}
      {p.state === 'blocked' && <p className="text-pt-muted text-xs">{isIOS() ? 'iPhone Settings → Notifications → Prime Capitol → Allow Notifications.' : 'Tap the lock or ⓘ next to the web address → Notifications → Allow, then come back.'}</p>}
      {p.msg && <p className="text-pt-muted text-xs">{p.msg}</p>}
      {guide && <InstallGuide onClose={() => setGuide(false)} />}
    </div>
  )
}

// Home: a one-time nudge (hidden once it's on or dismissed).
const DISMISS = 'pc-push-nudge-off'
export function NotificationsNudge() {
  const p = usePush()
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(DISMISS) === '1' } catch { return false } })
  const [guide, setGuide] = useState(false)
  if (hidden || !(p.state === 'off' || p.state === 'needs-install')) return null
  const dismiss = () => { try { localStorage.setItem(DISMISS, '1') } catch { /* private mode */ } setHidden(true) }
  return (
    <div className="rise-in rounded-2xl bg-pt-surface shadow-hairline p-4">
      <div className="flex items-center gap-3">
      <span className="w-11 h-11 rounded-full grid place-items-center shrink-0 bg-pt-accent/15 text-pt-accent">{bell}</span>
      <span className="flex-1 min-w-0"><b className="block text-pt-text text-[15px]">Get a ping</b><span className="block text-pt-muted text-xs">When a friend invites you, props are ready, or your shoot is coming up.</span></span>
      <span className="flex flex-col items-stretch gap-1 shrink-0 text-center">
        <button disabled={p.busy} onClick={() => p.state === 'needs-install' ? setGuide(true) : p.on()} className="bg-pt-accent text-stone-900 font-semibold rounded-full px-4 min-h-[36px] text-sm shadow-gold disabled:opacity-40">{p.busy ? 'Turning on…' : 'Turn on'}</button>
        <button onClick={dismiss} className="tap text-pt-muted text-xs text-center">Not now</button>
      </span>
      {guide && <InstallGuide onClose={() => setGuide(false)} />}
      </div>
      {p.msg && <p className="text-amber-300 text-xs mt-3">Couldn't turn them on: {p.msg}</p>}
    </div>
  )
}

// iPhone: notifications only work in the app added to the Home Screen.
export function InstallGuide({ onClose }: { onClose: () => void }) {
  const share = (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#0A84FF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="inline -mt-1"><path d="M12 3v12M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
  )
  const steps: [React.ReactNode, string][] = [
    [<>Tap {share} <b>Share</b> at the bottom of Safari</>, 'In Chrome: the ⋯ menu, then Share'],
    [<>Scroll down, tap <b>Add to Home Screen</b></>, 'Then tap Add'],
    [<>Open <b>Prime Capitol</b> from your Home Screen</>, 'The eagle icon'],
    [<>Me → Notifications → <b>Turn on</b></>, 'Tap Allow when your phone asks'],
  ]
  return (
    <BottomSheet open onClose={onClose} title="Put the app on your Home Screen">
      <p className="text-pt-muted text-sm mb-4">iPhone only sends notifications to apps on your Home Screen. It takes 10 seconds.</p>
      <ol className="space-y-3">
        {steps.map(([what, hint], i) => (
          <li key={i} className="flex gap-3 items-start">
            <span className="w-7 h-7 rounded-full grid place-items-center bg-pt-accent/15 text-pt-accent text-sm font-bold shrink-0">{i + 1}</span>
            <span><span className="block text-pt-text text-[15px]">{what}</span><span className="block text-pt-muted text-xs">{hint}</span></span>
          </li>
        ))}
      </ol>
      <button onClick={onClose} className="mt-6 w-full bg-pt-raised rounded-[14px] min-h-[48px] text-pt-text font-semibold">Got it</button>
    </BottomSheet>
  )
}
