import { useState } from 'react'
import { signOut, User } from 'firebase/auth'
import { auth } from '../firebase'
import { Icon } from '../components/Icon'
import { switchGoogleAccount } from '../lib/googleSignIn'
import { connectPending } from '../lib/connectPending'

interface Props {
  user: User
}

export default function NotAuthorizedScreen({ user }: Props) {
  const [busy, setBusy] = useState(false)
  // Owner, Nov 4: wrong account? Open Google's account chooser straight away (signing in with another account
  // replaces this one), so they can pick (or add) the invited one without getting dropped back into the same account.
  // The pop-up opens first, before anything else is awaited, so phones don't block it.
  const switchAccount = async () => { setBusy(true); try { await switchGoogleAccount() } finally { setBusy(false) } }
  const connecting = !!connectPending()
  return (
    <div className="min-h-screen bg-pt-bg flex flex-col items-center justify-center p-8 text-center pt-safe">
      <Icon name="lock" className="w-12 h-12 mb-4 text-pt-muted mx-auto" />
      {connecting && <p className="text-pt-accent text-sm font-semibold mb-2">Connecting ChatGPT or Claude</p>}
      <h1 className="font-display text-2xl text-pt-text mb-2">{connecting ? 'Wrong Google account?' : "You're not on the list yet"}</h1>
      <p className="text-pt-muted text-sm mb-6 max-w-sm">
        You're signed in as <span className="text-pt-text break-all">{user.email}</span>,
        but this email hasn't been invited to Prime Capitol, or its access was turned off.
      </p>
      <p className="text-pt-muted text-sm mb-8 max-w-sm">
        Used the wrong Google account? Tap below and pick the one you were invited with.
        Otherwise, ask the owner or an admin to invite this exact email address.
      </p>

      <button disabled={busy} onClick={switchAccount}
        className="min-h-[52px] bg-pt-accent text-stone-900 px-6 py-3 rounded-2xl text-base font-semibold active:opacity-80 disabled:opacity-60">
        {busy ? 'Opening Google…' : 'Use a different Google account'}
      </button>
      <button onClick={() => signOut(auth)} className="mt-4 text-pt-muted text-sm underline underline-offset-4 tap">
        Just sign out
      </button>
    </div>
  )
}
