import { useEffect, useMemo, useState } from 'react'
import { subscribeToSuggestions, type Suggestion } from '../services/suggestions'
import { SuggestionCard } from '../components/Suggestions'
import { useItems } from '../hooks/useItems'
import { PageHeader, EmptyState } from '../components/PageHeader'

// Admin → Suggested edits: creators' corrections to props, to apply or dismiss.
export default function SuggestionsScreen() {
  const [open, setOpen] = useState(true)
  const [list, setList] = useState<Suggestion[] | null>(null)
  const items = useItems()
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  useEffect(() => { setList(null); return subscribeToSuggestions(open, setList) }, [open])

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <PageHeader title="Suggested edits" sub="Creators' corrections to props">
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
          {([[true, 'To check'], [false, 'Done']] as const).map(([v, label]) => (
            <button key={label} onClick={() => setOpen(v)}
              className={`shrink-0 whitespace-nowrap min-h-[40px] inline-flex items-center gap-1 rounded-full px-4 text-[15px] ${open === v ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>{label}</button>
          ))}
        </div>
      </PageHeader>
      <div className="px-4 pb-4 space-y-2">
        {list === null && <p className="text-pt-muted text-sm text-center">Loading…</p>}
        {list?.length === 0 && (open
          ? <EmptyState icon="check" title="All caught up" line="When a creator suggests a fix to a prop, it lands here." />
          : <EmptyState icon="pencil" title="Nothing done yet" line="Suggestions you apply or dismiss show up here." />)}
        {list?.map(s => <SuggestionCard key={s.id} s={s} item={byId.get(s.itemId)} showProp />)}
      </div>
    </div>
  )
}
