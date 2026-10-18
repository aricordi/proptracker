import { useSession } from '../auth'
import { ROLE_LABELS } from '../screens/AccountScreen'

// Thin strip across the top while the owner previews the app as another role.
// It's part of the page (not floating), so it never covers buttons or fields.
export default function ViewAsBanner() {
  const { viewingAs, setViewAs } = useSession()
  if (!viewingAs) return null
  return (
    <div className="bg-sky-500 text-stone-900 pt-safe">
      <div className="flex items-center justify-center gap-2 px-3 py-1 text-xs font-semibold">
        <span>👁 Viewing as {ROLE_LABELS[viewingAs]}</span>
        <button onClick={() => setViewAs(null)} className="bg-stone-900/20 rounded-full px-3 py-0.5 active:opacity-70">
          Exit
        </button>
      </div>
    </div>
  )
}
