import { GoogleAuthProvider } from 'firebase/auth'

// Owner, Nov 4: people who signed in with the wrong Google account got sent straight back into it, even after
// Sign out (Google remembers the last account). prompt=select_account makes Google show its account chooser
// EVERY time, so anyone can pick (or add) the right account.
export function googleProvider() {
  const p = new GoogleAuthProvider()
  p.setCustomParameters({ prompt: 'select_account' })
  return p
}
