import { useState, useMemo } from 'react'
import { useItems } from '../hooks/useItems'
import { useCheckouts } from '../hooks/useCheckouts'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import { createCheckout, returnCheckout } from '../services/checkout'
import BottomSheet from '../components/BottomSheet'
import type { ActiveCheckout } from '../types'

export default function CheckoutScreen() {
  const items     = useItems()
  const checkouts = useCheckouts()
  const locations = useLocations()
  const bins      = useBins()

  const [showNewSheet, setShowNewSheet]   = useState(false)
  const [label, setLabel]                 = useState('')
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set())
  const [saving, setSaving]               = useState(false)
  const [saveError, setSaveError]         = useState<string | null>(null)

  const [returningId, setReturningId]     = useState<string | null>(null)
  const [returning, setReturning]         = useState(false)

  const itemById      = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items])
  const locationById  = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations])
  const binById       = useMemo(() => Object.fromEntries(bins.map(b => [b.id, b])), [bins])

  const checkoutCandidates = useMemo(
    () => items.filter(i => i.status !== 'checked-out').sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  )

  function toggleItem(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function openNewSheet() {
    setLabel('')
    setSelectedIds(new Set())
    setSaveError(null)
    setShowNewSheet(true)
  }

  async function handleCreate() {
    if (!label.trim() || selectedIds.size === 0) return
    setSaving(true)
    setSaveError(null)
    try {
      await createCheckout(label.trim(), Array.from(selectedIds))
      setShowNewSheet(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleReturn(checkout: ActiveCheckout) {
    setReturning(true)
    try {
      await returnCheckout(checkout)
      setReturningId(null)
    } catch {
      // silent — items will stay checked-out on error
    } finally {
      setReturning(false)
    }
  }

  const canCreate = !!label.trim() && selectedIds.size > 0 && !saving

  return (
    <div className="min-h-full bg-pt-bg pb-28">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border">
        <h1 className="font-display text-2xl text-pt-accent py-2">Checkout</h1>
      </div>

      <div className="p-4 space-y-3">
        {checkouts.length === 0 && (
          <div className="text-center mt-16">
            <p className="text-pt-muted text-sm leading-relaxed">
              Nothing is checked out right now.<br />
              Tap <strong className="text-pt-text">New Checkout</strong> to log items leaving the storage.
            </p>
          </div>
        )}

        {checkouts.map(checkout => {
          const checkoutItems = checkout.itemIds.map(id => itemById[id]).filter(Boolean)
          const isConfirming  = returningId === checkout.id

          return (
            <div key={checkout.id} className="bg-pt-surface border border-pt-border rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-pt-text leading-tight">{checkout.label}</p>
                  <p className="text-pt-muted text-xs mt-0.5">
                    Since {new Date(checkout.startedAt).toLocaleDateString('en-CA', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </p>
                </div>
                <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap">
                  {checkoutItems.length} item{checkoutItems.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Item list */}
              {checkoutItems.length > 0 && (
                <div className="space-y-1.5">
                  {checkoutItems.map(item => {
                    const loc  = item.locationId ? locationById[item.locationId] : null
                    const bin  = item.binId ? binById[item.binId] : null
                    const path = [loc?.name, bin?.label].filter(Boolean).join(' › ')
                    return (
                      <div key={item.id} className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-pt-border overflow-hidden shrink-0 flex items-center justify-center">
                          {item.photoUrl
                            ? <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover" />
                            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-pt-muted">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                              </svg>
                          }
                        </div>
                        <div className="min-w-0">
                          <p className="text-pt-text text-sm leading-tight truncate">{item.name}</p>
                          {path && <p className="text-pt-muted text-xs truncate">{path}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Return button / confirm */}
              {!isConfirming ? (
                <button
                  onClick={() => setReturningId(checkout.id)}
                  className="w-full py-2.5 rounded-xl border border-pt-border text-pt-muted text-sm active:opacity-70"
                >
                  Return All
                </button>
              ) : (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 space-y-2.5">
                  <p className="text-pt-text text-sm font-medium">
                    Mark all {checkoutItems.length} item{checkoutItems.length !== 1 ? 's' : ''} as returned?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setReturningId(null)}
                      className="flex-1 py-2 rounded-xl border border-pt-border text-pt-muted text-sm active:opacity-70"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleReturn(checkout)}
                      disabled={returning}
                      className="flex-1 py-2 rounded-xl bg-green-500/20 text-green-400 text-sm font-medium active:opacity-70 disabled:opacity-40"
                    >
                      {returning ? 'Returning…' : 'Yes, Return'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* New Checkout button */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 pb-safe bg-pt-bg border-t border-pt-border">
        <button
          onClick={openNewSheet}
          className="w-full bg-pt-accent text-stone-900 py-4 rounded-2xl font-semibold text-lg active:opacity-80"
        >
          New Checkout
        </button>
      </div>

      {/* New Checkout sheet */}
      <BottomSheet open={showNewSheet} onClose={() => setShowNewSheet(false)} title="New Checkout">
        <div className="space-y-4">
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">What's this for?</p>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Ep 12 shoot, Keanu borrowed"
              autoFocus
              className="w-full bg-pt-bg border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent"
            />
          </div>

          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">
              Select items ({selectedIds.size} selected)
            </p>
            {checkoutCandidates.length === 0 ? (
              <p className="text-pt-muted text-sm text-center py-4">No available items.</p>
            ) : (
              <div className="space-y-1">
                {checkoutCandidates.map(item => {
                  const loc     = item.locationId ? locationById[item.locationId] : null
                  const bin     = item.binId ? binById[item.binId] : null
                  const path    = [loc?.name, bin?.label].filter(Boolean).join(' › ')
                  const checked = selectedIds.has(item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleItem(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                        checked ? 'bg-pt-accent/10 border border-pt-accent/30' : 'bg-pt-bg border border-transparent'
                      }`}
                    >
                      {/* Checkbox */}
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        checked ? 'bg-pt-accent border-pt-accent' : 'border-pt-border'
                      }`}>
                        {checked && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-3 h-3 text-stone-900">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                        )}
                      </div>

                      {/* Thumbnail */}
                      <div className="w-9 h-9 rounded-lg bg-pt-border overflow-hidden shrink-0 flex items-center justify-center">
                        {item.photoUrl
                          ? <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover" />
                          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-pt-muted">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                            </svg>
                        }
                      </div>

                      {/* Info */}
                      <div className="min-w-0">
                        <p className="text-pt-text text-sm leading-tight truncate">{item.name}</p>
                        {path && <p className="text-pt-muted text-xs truncate">{path}</p>}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {saveError && (
            <p className="text-red-400 text-sm bg-red-400/10 rounded-xl px-4 py-3">{saveError}</p>
          )}

          <button
            onClick={handleCreate}
            disabled={!canCreate}
            className="w-full bg-pt-accent text-stone-900 py-4 rounded-2xl font-semibold text-lg disabled:opacity-40 active:opacity-80"
          >
            {saving ? 'Saving…' : `Check Out ${selectedIds.size > 0 ? selectedIds.size + ' ' : ''}Item${selectedIds.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
