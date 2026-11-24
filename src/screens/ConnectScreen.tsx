// "Let ChatGPT use Prime Capitol as you?" — where ChatGPT or Claude send people to sign in (owner, Nov 24).
// The person is already signed in with Google (the app's normal sign-in screen shows first if not). Allow sends the
// assistant a one-time code; it can then only do what this person can do in the app, with the same rules.
import { useEffect, useState } from 'react'
import BrandMark from '../components/BrandMark'
import { useSession } from '../auth'
import { connectorRequestInfo, approveConnector } from '../services/connector'
import { friendlyError } from '../lib/errors'
import { connectReq, clearConnectPending } from '../lib/connectPending'

export default function ConnectScreen() {
  const { profile, demo, canBook } = useSession()
  const req = connectReq()
  const [info, setInfo] = useState<{ ok: boolean; assistant?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!req) { setInfo({ ok: false }); return }
    connectorRequestInfo({ req }).then(r => { setInfo(r.data); if (!r.data.ok) clearConnectPending() }).catch(e => setError(friendlyError(e)))
  }, [req])
  const go = async (deny = false) => {
    setBusy(true); setError('')
    try { const r = await approveConnector({ req, deny }); clearConnectPending(); window.location.href = r.data.redirect }
    catch (e) { setError(friendlyError(e)); setBusy(false) }
  }
  const who = info?.assistant ?? 'your AI assistant'
  return (
    <div className="min-h-screen bg-pt-bg text-pt-text flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-pt-surface rounded-[28px] shadow-card p-6 space-y-5">
        <div className="flex items-center gap-3"><BrandMark className="w-9 h-9 text-white" /><span className="font-display text-lg tracking-title">PRIME CAPITOL</span></div>
        {!info && !error && <p className="text-pt-muted">Checking the link…</p>}
        {info && !info.ok && <>
          <h1 className="text-[22px] font-display">This link ran out</h1>
          <p className="text-pt-muted">Go back to ChatGPT or Claude and connect Prime Capitol again.</p>
          <a href="/" className="block text-center min-h-[44px] leading-[44px] rounded-2xl bg-pt-raised text-pt-text">Open the app instead</a>
        </>}
        {info?.ok && <>
          <h1 className="text-[22px] font-display leading-tight">Let {who} use Prime Capitol as you?</h1>
          <p className="text-pt-muted">Signed in as <b className="text-pt-text">{profile.name}</b> ({profile.email}).</p>
          <ul className="space-y-2 text-[15px]">
            <li>✓ Search the props closet and show photos</li>
            {!demo && canBook && <>
              <li>✓ See the schedule and your own shoots</li>
              <li>✓ Book, move or cancel your shoots and request props, after asking you</li>
            </>}
            <li className="text-pt-muted">Same rules as the app: your bookings still go to the schedule team for approval. It never sees other people's emails, internal notes or costs. It only does what you ask.</li>
          </ul>
          <div className="space-y-2 pt-1">
            <button disabled={busy} onClick={() => go(false)} className="w-full min-h-[52px] rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">{busy ? 'Connecting…' : `Allow ${who}`}</button>
            <button disabled={busy} onClick={() => go(true)} className="w-full min-h-[44px] rounded-2xl text-pt-muted">Cancel</button>
          </div>
          <p className="text-xs text-pt-muted">You can disconnect any time in the app: Me → ChatGPT & Claude.</p>
        </>}
        {error && <p className="text-amber-300 text-sm">{error}</p>}
      </div>
    </div>
  )
}
