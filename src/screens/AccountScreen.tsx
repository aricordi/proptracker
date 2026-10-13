import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useSession } from '../auth'

export const ROLE_LABELS: Record<string, string> = {
  owner:   'Owner',
  arts:    'Arts department',
  creator: 'Creator',
  equipment: 'Equipment team',
}

export default function AccountScreen() {
  const { user, profile, realRole, role, setViewAs } = useSession()
  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <h1 className="font-display text-3xl text-pt-text py-2">Account</h1>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-1">
          <p className="text-pt-text font-semibold">{profile.name || user.displayName || profile.email}</p>
          <p className="text-pt-muted text-sm break-all">{profile.email}</p>
          <p className="text-pt-accent text-sm pt-1">{ROLE_LABELS[realRole]}</p>
        </div>
        {realRole === 'owner' && (
          <div className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
            <p className="text-pt-text font-medium">View the app as…</p>
            <p className="text-pt-muted text-sm">
              See exactly which screens and buttons each role gets. This only changes what you see.
              The server still knows you're the owner, so to test what a role is truly blocked from,
              use a second Google account invited with that role.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['owner', 'arts', 'equipment', 'creator'] as const).map(r => (
                <button key={r} onClick={() => setViewAs(r === 'owner' ? null : r)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium ${role === r ? 'bg-sky-500 text-stone-900' : 'bg-pt-bg border border-pt-border text-pt-muted'}`}>
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
        )}
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
