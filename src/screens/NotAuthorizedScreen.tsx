import { signOut, User } from 'firebase/auth'
import { auth } from '../firebase'
import { Icon } from '../components/Icon'

interface Props {
  user: User
}

export default function NotAuthorizedScreen({ user }: Props) {
  return (
    <div className="min-h-screen bg-pt-bg flex flex-col items-center justify-center p-8 text-center pt-safe">
      <Icon name="lock" className="w-12 h-12 mb-4 text-pt-muted mx-auto" />
      <h1 className="font-display text-2xl text-pt-text mb-2">You're not on the list yet</h1>
      <p className="text-pt-muted text-sm mb-6 max-w-sm">
        You're signed in as <span className="text-pt-text break-all">{user.email}</span>,
        but this email hasn't been invited to Prime Capitol, or its access was turned off.
      </p>
      <p className="text-pt-muted text-sm mb-8 max-w-sm">
        Ask someone in the arts department to invite this exact email address,
        then sign in again.
      </p>

      <button
        onClick={() => signOut(auth)}
        className="bg-pt-surface shadow-hairline text-pt-text px-5 py-3 rounded-2xl text-sm font-medium active:opacity-70"
      >
        Sign out and try another account
      </button>
    </div>
  )
}
