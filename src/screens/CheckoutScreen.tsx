import { useState, useMemo } from 'react'
import { useItems } from '../hooks/useItems'
import { useCheckouts } from '../hooks/useCheckouts'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import { createCheckout, returnItems } from '../services/checkout'
import BottomSheet from '../components/BottomSheet'
import type { ActiveCheckout } from '../types'

type ReturnConfirm = { checkout: ActiveCheckout; mode: 'all' | 'selected' }

export default function CheckoutScreen() {
  const items     = useItems()
  const checkouts = useCheckouts()
  const locations = useLocations()
  const bins      = useBins()

  // New checkout sheet
  const [showNewSheet, setShowNewSheet] = useState(false)
  const [label, setLabel]               = useState('')
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [saving, setSaving]             = useState(false)
  const [saveError, setSaveError]       = useState<string | null>(null)

  // Per-checkout item selection for partial returns
  const [checkedByCheckout, setCheckedByCheckout] = useState<Record<string, Set<string>>>({})

  // Return confirmation
  const [returnConfirm, setReturnConfirm] = useState<ReturnConfirm | null>(null)
  const [returning, setReturning]         = useState(false)

  const itemById     = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items])
  const locationById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations])
  const binById      = useMemo(() => Object.fromEntries(bins.map(b => [b.id, b])), [bins])

  const checkoutCandidates = useMemo(
    () => items.filter(i => i.status !== 'checked-out').sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  )

  function toggleNewItem(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleCheckedItem(checkoutId: string, itemId: string) {
    setCheckedByCheckout(prev => {
      const set = new Set(prev[checkoutId] ?? [])
      set.has(itemId) ? set.delete(itemId) : set.add(itemId)
      return { ...prev, [checkoutId]: set }
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

  async function handleReturn() {
    if (!returnConfirm) return
    const { checkout, mode } = returnConfirm
    const idsToReturn = mode === 'all'
      ? checkout.itemIds
      : Array.from(checkedByCheckout[checkout.id] ?? [])
    if (idsToReturn.length === 0) return
    setReturning(true)
    try {
      await returnItems(checkout, idsToReturn)
      setCheckedByCheckout(prev => {
        const next = { ...prev }
        delete next[checkout.id]
        return next
      })
      setReturnConfirm(null)
    } catch {
      // silent — items stay checked-out on error
    } finally {
      setReturning(false)
    }
  }

  const canCreate = !!label.trim() && selectedIds.size > 0 && !saving

  return (
    <div className="min-h-full bg-pt-bg pb-6">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border flex items-center justify-between">
        <h1 className="font-display text-2xl text-pt-accent py-2">Checkout</h1>
        <button
          onClick={openNewSheet}
          className="flex items-center gap-1.5 bg-pt-accent text-stone-900 text-sm font-semibold px-3 py-1.5 rounded-full active:opacity-80"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New
        </button>
      </div>

      <div className="p-4 space-y-3">
        {checkouts.length === 0 && (
          <div className="text-center mt-16">
            <p className="text-pt-muted text-sm leading-relaxed">
              Nothing is checked out right now.<br />
              Tap <strong className="text-pt-text">New</strong> to log items leaving storage.
            </p>
          </div>
        )}

        {checkouts.map(checkout => {
          const checkoutItems = checkout.itemIds.map(id => itemById[id]).filter(Boolean)
          const checked       = checkedByCheckout[checkout.id] ?? new Set<string>()
          const checkedCount  = checked.size

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

              {/* Item list — tap to select for partial return */}
              {checkoutItems.length > 0 && (
                <div className="space-y-1">
                  {checkoutItems.map(item => {
                    const loc       = item.locationId ? locationById[item.locationId] : null
                    const bin       = item.binId ? binById[item.binId] : null
                    const path      = [loc?.name, bin?.label].filter(Boolean).join(' › ')
                    const isChecked = checked.has(item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleCheckedItem(checkout.id, item.id)}
                        className={`w-full flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors active:opacity-70 ${
                          isChecked ? 'bg-green-500/10' : ''
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                          isChecked ? 'bg-green-500 border-green-500' : 'border-pt-border'
                        }`}>
                          {isChecked && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-3 h-3 text-white">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                          )}
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-pt-border overflow-hidden shrink-0 flex items-center justify-center">
                          {item.photoUrl
                            ? <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover" />
                            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-pt-muted">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                              </svg>
                          }
                        </div>
                        <div className="min-w-0">
                          <p className={`text-sm leading-tight truncate ${isChecked ? 'text-green-400' : 'text-pt-text'}`}>
                            {item.name}
                          </p>
                          {path && <p className="text-pt-muted text-xs truncate">{path}</p>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Return buttons */}
              <div className="space-y-2">
                {checkedCount > 0 && (
                  <button
                    onClick={() => setReturnConfirm({ checkout, mode: 'selected' })}
                    className="w-full py-2.5 rounded-xl bg-green-500/20 border border-green-500/30 text-green-400 text-sm font-medium active:opacity-70"
                  >
                    Return {checkedCount} selected item{checkedCount !== 1 ? 's' : ''}
                  </button>
                )}
                <button
                  onClick={() => setReturnConfirm({ checkout, mode: 'all' })}
                  className="w-full py-2.5 rounded-xl border border-pt-border text-pt-muted text-sm active:opacity-70"
                >
                  Return All
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Return confirmation overlay */}
      {returnConfirm && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => !returning && setReturnConfirm(null)} />
          <div className="relative w-full bg-pt-surface rounded-t-2xl p-6 space-y-4">
            <p className="text-pt-text font-semibold">
              {returnConfirm.mode === 'all'
                ? `Return all ${returnConfirm.checkout.itemIds.length} item${returnConfirm.checkout.itemIds.length !== 1 ? 's' : ''}?`
                : `Return ${(checkedByCheckout[returnConfirm.checkout.id]?.size ?? 0)} selected item${(checkedByCheckout[returnConfirm.checkout.id]?.size ?? 0) !== 1 ? 's' : ''}?`
              }
            </p>
            <p className="text-pt-muted text-sm">
              {returnConfirm.mode === 'all'
                ? 'All items will be marked as available.'
                : 'Selected items will be marked as available. The rest stay checked out.'
              }
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setReturnConfirm(null)}
                disabled={returning}
                className="flex-1 py-3.5 rounded-2xl border border-pt-border text-pt-muted font-medium active:opacity-70 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleReturn}
                disabled={returning}
                className="flex-1 py-3.5 rounded-2xl bg-green-500/20 text-green-400 font-semibold active:opacity-70 disabled:opacity-40"
              >
                {returning ? 'Returning…' : 'Yes, Return'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  const chk     = selectedIds.has(item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleNewItem(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                        chk ? 'bg-pt-accent/10 border border-pt-accent/30' : 'bg-pt-bg border border-transparent'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        chk ? 'bg-pt-accent border-pt-accent' : 'border-pt-border'
                      }`}>
                        {chk && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-3 h-3 text-stone-900">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                        )}
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-pt-border overflow-hidden shrink-0 flex items-center justify-center">
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
