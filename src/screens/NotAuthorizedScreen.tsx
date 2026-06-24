import { signOut, User } from 'firebase/auth'
import { auth } from '../firebase'

interface Props {
  user: User
}

export default function NotAuthorizedScreen({ user }: Props) {
  return (
    <div className="min-h-screen bg-pt-bg flex flex-col items-center justify-center p-8 text-center pt-safe">
      <div className="text-5xl mb-4">🔒</div>
      <h1 className="font-display text-2xl text-pt-text mb-2">Not authorized yet</h1>
      <p className="text-pt-muted text-sm mb-6">
        You're signed in as <span className="text-pt-text">{user.email}</span>,
        but this account hasn't been added to the app yet.
      </p>

      <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 mb-4 text-left w-full max-w-sm">
        <p className="text-pt-muted text-xs mb-2 uppercase tracking-wider">Your User ID — copy this:</p>
        <p className="font-mono text-pt-accent text-sm break-all select-all">{user.uid}</p>
      </div>

      <p className="text-pt-muted text-xs mb-8 max-w-xs">
        Paste this UID into <code className="bg-pt-surface px-1.5 py-0.5 rounded text-pt-text">src/config.ts</code> and
        both rules files, then redeploy. See the README for step-by-step instructions.
      </p>

      <button
        onClick={() => signOut(auth)}
        className="text-pt-muted text-sm underline active:text-pt-text"
      >
        Sign out
      </button>
    </div>
  )
}
