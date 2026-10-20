import { useEffect, useState } from 'react'
import { signInWithPopup, signInWithRedirect, getRedirectResult, signInWithCredential, GoogleAuthProvider } from 'firebase/auth'
import { auth, USING_EMULATORS } from '../firebase'
import BrandMark from '../components/BrandMark'
import { inAppBrowser } from '../lib/inAppBrowser'

// Emulator only: one-tap sign-in as a pretend Google account, so each role
// can be tried without real accounts. Never shown on the live site.
const TEST_ACCOUNTS = [
  { email: 'alexisricordi@gmail.com', label: 'Owner' },
  { email: 'arts@example.com',        label: 'Arts department' },
  { email: 'creator@example.com',     label: 'Creator' },
  { email: 'kyle@example.com',        label: 'Kyle (creator)' },
  { email: 'gear@example.com',        label: 'Equipment team' },
  { email: 'admin@example.com',       label: 'Admin' },
  { email: 'stranger@example.com',    label: 'Not invited' },
]

function testSignIn(email: string) {
  const fakeIdToken = JSON.stringify({ sub: email, email, email_verified: true, name: email.split('@')[0] })
  return signInWithCredential(auth, GoogleAuthProvider.credential(fakeIdToken))
}

// Plain-language reason a Google sign-in failed (the code in brackets helps Claude fix it).
function signInProblem(code: string) {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
  const msg: Record<string, string> = {
    'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.',
    'auth/popup-closed-by-user': 'The Google window closed before you could sign in. An ad blocker or Private Browsing usually causes this: try "Sign in another way" below, or turn the blocker off for this site.',
    'auth/cancelled-popup-request': 'The Google window closed before sign-in finished. Try again.',
    'auth/unauthorized-domain': 'This web address isn\'t allowed to use Google sign-in yet.',
    'auth/network-request-failed': 'No connection. Check your internet and try again.',
    'auth/operation-not-supported-in-this-environment': 'Sign-in doesn\'t work inside this app view.',
  }
  const base = msg[code] ?? 'Google sign-in didn\'t work.'
  const tip = standalone ? ' If you opened Prime Capitol from your home screen, try it in Safari or Chrome instead.' : ''
  return `${base}${tip} (${code})`
}

export default function LoginScreen() {
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const insideApp = USING_EMULATORS ? null : inAppBrowser(navigator.userAgent)

  // Coming back from the full-page Google sign-in (the fallback below): show any error.
  useEffect(() => {
    getRedirectResult(auth).catch(err => setProblem(signInProblem((err as { code?: string })?.code ?? 'unknown')))
  }, [])

  const handleSignIn = async () => {
    setProblem(null)
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (err) {
      const code = (err as { code?: string })?.code ?? 'unknown'
      console.error('Sign-in failed:', err)
      // The browser blocked the Google window: sign in on a full page instead.
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        try { await signInWithRedirect(auth, new GoogleAuthProvider()); return } catch { /* show the message below */ }
      }
      setProblem(signInProblem(code))
    }
  }

  // Full-page Google sign-in (no pop-up window); also works on phones that block pop-ups.
  const handleRedirect = async () => {
    setProblem(null)
    try { await signInWithRedirect(auth, new GoogleAuthProvider()) }
    catch (err) { setProblem(signInProblem((err as { code?: string })?.code ?? 'unknown')) }
  }

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.origin); setCopied(true) } catch { setCopied(false) }
  }

  return (
    <div className="min-h-screen bg-pt-bg flex flex-col items-center justify-center p-8 pt-safe">
      <div className="mb-10 text-center">
        <BrandMark className="w-40 mx-auto mb-8 text-pt-text" />
        <h1 className="text-3xl font-semibold tracking-tight text-pt-text">Welcome</h1>
        <p className="text-pt-muted mt-2 text-sm">Props and gear for Prime Capitol shoots</p>
      </div>

      {insideApp && (
        <div className="mb-6 max-w-xs rounded-2xl bg-amber-500/15 px-4 py-3 text-center text-amber-100 text-sm space-y-2">
          <p><b>Open this page in Safari or Chrome.</b> You opened it inside {insideApp}, and Google doesn't allow signing in there.</p>
          <p className="text-amber-200/80">Tap the <b>⋯</b> or share button at the top or bottom and choose <b>Open in browser</b> / <b>Open in Safari</b>. Or copy the link and paste it into Safari or Chrome.</p>
          <button onClick={copyLink} className="rounded-xl bg-amber-400 text-stone-900 font-semibold px-4 py-2">{copied ? 'Copied ✓' : 'Copy link'}</button>
        </div>
      )}
      <button
        onClick={handleSignIn}
        className="flex items-center gap-3 bg-white text-gray-800 px-6 py-4 rounded-2xl font-semibold text-base shadow-lg active:scale-95 transition-transform"
      >
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        Sign in with Google
      </button>
      {problem && <p className="mt-4 max-w-xs text-center text-amber-300 text-sm">{problem}</p>}
      <button onClick={handleRedirect} className="mt-4 text-pt-muted text-sm underline underline-offset-4 active:opacity-70">
        Trouble signing in? Sign in another way
      </button>
      {problem && (
        <details className="mt-3 max-w-xs text-pt-muted text-xs">
          <summary className="text-center cursor-pointer">Using an ad blocker or Private Browsing?</summary>
          <p className="mt-2">Ad blockers can stop Google's sign-in page from loading (it stays blank). On iPhone: tap <b>aA</b> in
            Safari's address bar → <b>Turn Off Content Blockers</b>, then sign in again. Private Browsing tabs can also block it:
            use a normal tab. You only need to sign in once; you stay signed in after that.</p>
        </details>
      )}

      {USING_EMULATORS && (
        <div className="mt-10 w-full max-w-xs space-y-2">
          <p className="text-pt-muted text-xs text-center">Test mode: sign in as</p>
          {TEST_ACCOUNTS.map(a => (
            <button key={a.email} onClick={() => testSignIn(a.email)}
              className="w-full bg-pt-surface shadow-hairline text-pt-text py-3 rounded-xl text-sm active:opacity-70">
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
