import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVideoChecklists } from '../hooks/useVideoChecklists'
import { useItems } from '../hooks/useItems'
import { generateShoppingSuggestion } from '../services/ai'
import type { VideoChecklistProp } from '../types'

interface ShoppingItem {
  prop: VideoChecklistProp
  videoTitle: string
  checklistId: string
}

export default function ShoppingListScreen() {
  const navigate   = useNavigate()
  const checklists = useVideoChecklists()
  const items      = useItems()

  const [suggestions, setSuggestions]   = useState<Record<string, string>>({})
  const [loadingId, setLoadingId]       = useState<string | null>(null)

  const shoppingItems: ShoppingItem[] = useMemo(() => {
    const list: ShoppingItem[] = []
    for (const cl of checklists) {
      for (const prop of cl.props) {
        if (prop.decision === 'buy') {
          list.push({ prop, videoTitle: cl.videoTitle, checklistId: cl.id })
        }
      }
    }
    return list
  }, [checklists])

  async function getSuggestion(propName: string, key: string) {
    if (suggestions[key] || loadingId === key) return
    setLoadingId(key)
    try {
      const result = await generateShoppingSuggestion(propName)
      if (result) setSuggestions(prev => ({ ...prev, [key]: result }))
    } finally {
      setLoadingId(null)
    }
  }

  // Try to derive a suggestion from inventory's whereToRebuy for similar items
  function getRebuyHint(propName: string): string | null {
    const q = propName.toLowerCase()
    const match = items.find(i =>
      i.whereToRebuy &&
      (i.name.toLowerCase().includes(q.slice(0, 5)) || q.includes(i.name.toLowerCase().slice(0, 5)))
    )
    return match?.whereToRebuy ?? null
  }

  return (
    <div className="min-h-screen bg-pt-bg pb-10">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border flex items-center gap-3">
        <button onClick={() => navigate('/videos')} className="text-pt-muted active:opacity-70 shrink-0 py-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <h1 className="font-display text-2xl text-pt-accent py-2">Shopping List</h1>
      </div>

      <div className="p-4 space-y-3">
        {shoppingItems.length === 0 ? (
          <div className="text-center mt-16">
            <p className="text-pt-muted text-sm leading-relaxed">
              Nothing on your shopping list yet.<br />
              Mark props as "Buy it" in a video checklist.
            </p>
          </div>
        ) : (
          <>
            <p className="text-pt-muted text-xs px-1">
              {shoppingItems.length} item{shoppingItems.length !== 1 ? 's' : ''} to buy
            </p>
            {shoppingItems.map(({ prop, videoTitle, checklistId }) => {
              const key = `${checklistId}:${prop.id}`
              const hint = getRebuyHint(prop.name)
              const suggestion = suggestions[key] ?? hint

              return (
                <div key={key} className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-pt-text font-semibold leading-tight">{prop.name}</p>
                      {prop.qty > 1 && <p className="text-pt-muted text-xs">Qty: {prop.qty}</p>}
                      {prop.notes && <p className="text-pt-muted text-xs italic mt-0.5">{prop.notes}</p>}
                    </div>
                    <span className="text-xs bg-pt-border text-pt-muted px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap truncate max-w-[120px]">
                      {videoTitle}
                    </span>
                  </div>

                  {/* Where to get it */}
                  {suggestion ? (
                    <p className="text-pt-muted text-xs bg-pt-bg rounded-xl px-3 py-2 leading-relaxed">
                      {suggestion}
                    </p>
                  ) : (
                    <button
                      onClick={() => getSuggestion(prop.name, key)}
                      disabled={loadingId === key}
                      className="text-pt-accent text-xs font-medium active:opacity-70 disabled:opacity-40"
                    >
                      {loadingId === key ? 'Getting suggestion…' : 'Where to get it?'}
                    </button>
                  )}

                  {/* Add to inventory shortcut */}
                  <button
                    onClick={() => navigate('/add', { state: { prefillName: prop.name } })}
                    className="text-pt-muted text-xs active:opacity-70 flex items-center gap-1"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add to inventory once bought
                  </button>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
