import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCategories } from '../hooks/useCategories'
import { useItems } from '../hooks/useItems'
import { addCategory, updateCategory } from '../services/categories'
import BottomSheet from '../components/BottomSheet'
import type { Category } from '../types'

const inputClass = 'w-full bg-pt-bg border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent'

export default function CategoriesScreen() {
  const navigate = useNavigate()
  const categories = useCategories()
  const items = useItems()
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const i of items) if (!i.archived) c[i.categoryId] = (c[i.categoryId] ?? 0) + 1
    return c
  }, [items])

  function open(target: Category | 'new') {
    setEditing(target)
    setLabel(target === 'new' ? '' : target.label)
    setError(null)
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null)
    try { await fn(); setEditing(null) }
    catch { setError("Couldn't save. Check your connection and try again.") }
    finally { setBusy(false) }
  }

  const duplicate = categories.some(c =>
    c.label.trim().toLowerCase() === label.trim().toLowerCase() && (editing === 'new' || c.id !== editing?.id))

  async function move(index: number, dir: -1 | 1) {
    const a = categories[index], b = categories[index + dir]
    if (!a || !b) return
    // Swap positions; fall back to list index if two categories share an order value.
    const ao = a.order === b.order ? index : a.order
    const bo = a.order === b.order ? index + dir : b.order
    await Promise.all([updateCategory(a.id, { order: bo }), updateCategory(b.id, { order: ao })])
  }

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-pt-text text-base font-medium active:text-pt-muted py-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 19-7-7 7-7" />
          </svg>
          Back
        </button>
        <h1 className="font-display text-xl text-pt-text">Categories</h1>
        <button onClick={() => open('new')} className="text-pt-accent text-sm font-medium active:opacity-70 py-1 tap">Add</button>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-pt-muted text-sm">
          Every prop belongs to one category. Hidden categories stay on existing props but can't be picked for new ones.
        </p>
        <div className="bg-pt-surface shadow-hairline rounded-2xl divide-y divide-white/[0.06] overflow-hidden">
          {categories.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 px-3 py-3">
              <div className="flex flex-col">
                <button aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="text-pt-muted disabled:opacity-20 px-1 leading-none">▲</button>
                <button aria-label="Move down" disabled={i === categories.length - 1} onClick={() => move(i, 1)} className="text-pt-muted disabled:opacity-20 px-1 leading-none">▼</button>
              </div>
              <button onClick={() => open(c)} className="flex-1 flex items-center gap-2 text-left min-w-0 py-1">
                <span className={`text-sm truncate ${c.active ? 'text-pt-text' : 'text-pt-muted line-through'}`}>{c.label}</span>
                <span className="text-pt-muted text-xs">{counts[c.id] ?? 0}</span>
                {!c.active && <span className="text-xs bg-pt-border text-pt-muted px-2 py-0.5 rounded-full">Hidden</span>}
              </button>
            </div>
          ))}
        </div>
      </div>

      <BottomSheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New category' : 'Edit category'}>
        <div className="space-y-4">
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Category name" className={inputClass} autoFocus />
          {duplicate && <p className="text-amber-400 text-sm">A category with that name already exists.</p>}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            disabled={!label.trim() || duplicate || busy}
            onClick={() => run(() => editing === 'new'
              ? addCategory(label, (categories[categories.length - 1]?.order ?? -1) + 1)
              : updateCategory((editing as Category).id, { label: label.trim() }))}
            className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 active:opacity-80 shadow-gold"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {editing && editing !== 'new' && (
            <button disabled={busy}
              onClick={() => run(() => updateCategory(editing.id, { active: !editing.active }))}
              className="w-full py-3 rounded-xl bg-pt-bg shadow-hairline text-pt-text text-sm font-medium active:opacity-70">
              {editing.active ? 'Hide this category' : 'Show this category again'}
            </button>
          )}
        </div>
      </BottomSheet>
    </div>
  )
}
