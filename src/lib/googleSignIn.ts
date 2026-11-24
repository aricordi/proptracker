import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth'
import { auth } from '../firebase'

// Owner, Nov 4: people who signed in with the wrong Google account got sent straight back into it, even after
// Sign out (Google remembers the last account). prompt=select_account makes Google show its account chooser
// EVERY time, so anyone can pick (or add) the right account.
export function googleProvider() {
  const p = new GoogleAuthProvider()
  p.setCustomParameters({ prompt: 'select_account' })
  return p
}

// Open Google's account chooser straight away (pop-up first, before anything else is awaited, so phones don't block it;
// redirect when pop-ups can't open). Signing in with another account replaces the current one.
export async function switchGoogleAccount() {
  try { await signInWithPopup(auth, googleProvider()) }
  catch (err) {
    const code = (err as { code?: string })?.code ?? ''
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      try { await signInWithRedirect(auth, googleProvider()); return } catch { /* fall through */ }
    }
    if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') await signOut(auth)
  }
}
