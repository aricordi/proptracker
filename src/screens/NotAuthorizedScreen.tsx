import { signOut, User } from 'firebase/auth'
import { auth } from '../firebase'

interface Props {
  user: User
}

export default function NotAuthorizedScreen({ user }: Props) {
  return (
    <div className="min-h-screen bg-pt-bg flex flex-col items-center justify-center p-8 text-center pt-safe">
      <div className="text-5xl mb-4">🔒</div>
      <h1 className="font-display text-2xl text-pt-text mb-2">You're not on the list yet</h1>
      <p className="text-pt-muted text-sm mb-6 max-w-sm">
        You're signed in as <span className="text-pt-text break-all">{user.email}</span>,
        but this email hasn't been invited to Prime App, or its access was turned off.
      </p>
      <p className="text-pt-muted text-sm mb-8 max-w-sm">
        Ask someone in the arts department to invite this exact email address,
        then sign in again.
      </p>

      <button
        onClick={() => signOut(auth)}
        className="bg-pt-surface border border-pt-border text-pt-text px-5 py-3 rounded-2xl text-sm font-medium active:opacity-70"
      >
        Sign out and try another account
      </button>
    </div>
  )
}
