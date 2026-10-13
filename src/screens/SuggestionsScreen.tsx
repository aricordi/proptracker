import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeToSuggestions, type Suggestion } from '../services/suggestions'
import { SuggestionCard } from '../components/Suggestions'
import { useItems } from '../hooks/useItems'

// Admin → Suggested edits: creators' corrections to props, to apply or dismiss.
export default function SuggestionsScreen() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)
  const [list, setList] = useState<Suggestion[] | null>(null)
  const items = useItems()
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  useEffect(() => { setList(null); return subscribeToSuggestions(open, setList) }, [open])

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <div className="flex items-center gap-3 py-2">
          <button onClick={() => navigate(-1)} className="text-pt-text py-1">‹</button>
          <h1 className="font-display text-xl text-pt-text">Suggested edits</h1>
        </div>
        <div className="flex gap-2">
          {([[true, 'To check'], [false, 'Done']] as const).map(([v, label]) => (
            <button key={label} onClick={() => setOpen(v)}
              className={`px-3 py-1 rounded-full text-sm ${open === v ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface border border-pt-border text-pt-muted'}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="p-4 space-y-2">
        {list === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {list?.length === 0 && <p className="text-pt-muted text-sm text-center py-6">{open ? 'No suggestions to check.' : 'Nothing yet.'}</p>}
        {list?.map(s => <SuggestionCard key={s.id} s={s} item={byId.get(s.itemId)} showProp />)}
      </div>
    </div>
  )
}
