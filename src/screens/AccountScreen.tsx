import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useSession } from '../auth'

export const ROLE_LABELS: Record<string, string> = {
  owner:   'Owner',
  arts:    'Arts department',
  creator: 'Creator',
}

export default function AccountScreen() {
  const { user, profile } = useSession()
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <h1 className="font-display text-2xl text-pt-accent py-2">Account</h1>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-1">
          <p className="text-pt-text font-semibold">{profile.name || user.displayName || profile.email}</p>
          <p className="text-pt-muted text-sm break-all">{profile.email}</p>
          <p className="text-pt-accent text-sm pt-1">{ROLE_LABELS[profile.role]}</p>
        </div>
        <button
          onClick={() => signOut(auth)}
          className="w-full py-3 rounded-xl bg-pt-surface border border-pt-border text-pt-text text-sm font-medium active:opacity-70"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
