import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getItem, updateItem, setItemArchived } from '../services/items'
import { FirebaseError } from 'firebase/app'
import { deleteImportedProp } from '../services/importer'
import { getItemPrivate } from '../services/itemPrivate'
import { useSession } from '../auth'
import { HIGH_VALUE_THRESHOLD } from '../config'
import { useTags } from '../hooks/useTags'
import { useCharacters } from '../hooks/useCharacters'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import { useCategories } from '../hooks/useCategories'
import ImageLightbox from '../components/ImageLightbox'
import ReservePanel from '../components/ReservePanel'
import PropHistory from '../components/PropHistory'
import PropSuggestions, { WrongNameLink } from '../components/Suggestions'
import { useBookings } from '../hooks/useBookings'
import { photoMorphName, CONDITION_LABELS, CONDITION_STYLES, formatMoney } from '../components/ItemCard'
import type { Item, Condition } from '../types'

export default function ItemDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { isStaff, canSeeStaff } = useSession()   // admins see staff details; only arts/owner change things
  const [deleteState, setDeleteState] = useState<'idle' | 'confirm' | 'busy'>('idle')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const tags       = useTags()
  const characters = useCharacters()
  const locations  = useLocations()
  const bins       = useBins()
  const categories = useCategories()
  const bookings   = useBookings()

  const [item, setItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [internalNotes, setInternalNotes] = useState('')

  useEffect(() => {
    if (!id) return
    getItem(id)
      .then(setItem)
      .catch(() => setItem(null))   // e.g. someone else's personal prop: treated as not found
      .finally(() => setLoading(false))
    if (canSeeStaff) getItemPrivate(id).then(p => setInternalNotes(p.internalNotes ?? '')).catch(() => {})
  }, [id, canSeeStaff])

  const tagById       = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags])
  const characterById = useMemo(() => Object.fromEntries(characters.map(c => [c.id, c])), [characters])
  const locationById  = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations])
  const binById       = useMemo(() => Object.fromEntries(bins.map(b => [b.id, b])), [bins])
  const categoryById  = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories])

  if (loading) {
    return (
      <div className="min-h-screen bg-pt-bg flex items-center justify-center">
        <p className="text-pt-muted text-sm">Loading…</p>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-pt-bg flex items-center justify-center">
        <p className="text-pt-muted text-sm">Item not found.</p>
      </div>
    )
  }

  const location = item.locationId ? locationById[item.locationId] : null
  const bin      = item.binId ? binById[item.binId] : null
  const locationPath = [location?.name, bin?.label].filter(Boolean).join(' › ')
  const categoryLabel = categoryById[item.categoryId]?.label ?? item.categoryId
  const highValue = (item.replacementCost ?? 0) >= HIGH_VALUE_THRESHOLD

  async function run(change: Partial<Item>, write: () => Promise<unknown>) {
    setBusy(true)
    setActionError(null)
    try {
      await write()
      setItem(prev => prev ? { ...prev, ...change } : prev)
    } catch {
      setActionError("Couldn't save that change. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  // Also rewrite status: older records stored "damaged" as a status, which
  // would otherwise linger after the condition is set back to good.
  const setCondition = (condition: Condition) =>
    run({ condition }, () => updateItem(item.id, { condition, status: item.status }))

  const setArchived = (archived: boolean) =>
    run({ archived }, async () => { await setItemArchived(item.id, archived); setShowArchiveConfirm(false) })

  const characterIds = item.characters ?? []

  return (
    <>
    <div className="min-h-screen bg-pt-bg pb-10">
      {/* Header */}
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-pt-text text-base font-medium active:text-pt-muted py-1"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 19-7-7 7-7" />
          </svg>
          Back
        </button>
        {isStaff && (
          <button
            onClick={() => navigate(`/item/${item.id}/edit`)}
            className="text-pt-accent text-sm font-medium active:opacity-70 py-1 tap"
          >
            Edit
          </button>
        )}
      </div>

      {/* Photos — swipe sideways when there's more than one */}
      <div className="relative w-full h-72 bg-pt-surface">
        {item.photos.length > 0 ? (
          <div
            className="flex h-full overflow-x-auto snap-x snap-mandatory no-scrollbar"
            onScroll={e => {
              const el = e.currentTarget
              setPhotoIndex(Math.round(el.scrollLeft / el.clientWidth))
            }}
          >
            {item.photos.map((url, i) => (
              <button key={url} onClick={() => setLightboxIndex(i)} className="w-full h-full shrink-0 snap-center active:opacity-90">
                <img src={url} alt={`${item.name} photo ${i + 1}`} className="w-full h-full object-cover" style={i === 0 ? { viewTransitionName: photoMorphName(item.id) } : undefined} />
              </button>
            ))}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-16 h-16 text-pt-muted">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
            </svg>
          </div>
        )}
        {item.photos.length > 1 && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-2 pointer-events-none">
            {item.photos.map((url, i) => (
              <span key={url} className={`w-2 h-2 rounded-full ${i === photoIndex ? 'bg-white' : 'bg-white/40'}`} />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pt-4 pb-8 space-y-6">
        {item.collection === 'personal' && (
          <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl px-4 py-3">
            <p className="text-violet-200 text-sm font-medium">Personal</p>
            <p className="text-pt-muted text-xs mt-0.5">Your own prop. Only you can see it; Prime Capitol staff and creators can't find or book it.</p>
          </div>
        )}
        {item.archived && (
          <div className="bg-pt-surface shadow-hairline rounded-xl px-4 py-3">
            <p className="text-pt-text text-sm font-medium">Archived</p>
            <p className="text-pt-muted text-xs mt-0.5">Hidden from search. Its history is kept.</p>
          </div>
        )}

        {/* Name + category + condition */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-[28px] text-pt-text leading-tight">{item.name}</h1>
            {!isStaff && !item.archived && <WrongNameLink item={item} />}
            <p className="text-pt-muted text-sm mt-0.5">
              {categoryLabel}
              {item.quantity > 1 && <> · <span className="text-pt-text">{item.quantity} in stock</span></>}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0 mt-1">
            {item.status === 'checked-out' && (
              <span className="text-sm px-3 py-1 rounded-full whitespace-nowrap bg-amber-500/20 text-amber-400">Checked Out</span>
            )}
            <span className={`text-sm px-3 py-1 rounded-full whitespace-nowrap ${CONDITION_STYLES[item.condition]}`}>
              {CONDITION_LABELS[item.condition]}
            </span>
          </div>
        </div>

        {/* Replacement cost — big and obvious on valuable props */}
        {item.replacementCost != null && (
          <div className={highValue
            ? 'bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3'
            : ''}>
            <p className="text-pt-muted text-xs mb-1">
              Replacement cost{item.quantity > 1 ? ' (each)' : ''}
            </p>
            <p className={highValue ? 'text-red-300 text-2xl font-bold' : 'text-pt-text'}>
              {formatMoney(item.replacementCost)}
            </p>
            {highValue && <p className="text-red-300/80 text-xs mt-1">High-value prop. Please handle with care.</p>}
          </div>
        )}

        {/* Checked-out info */}
        {item.status === 'checked-out' && item.checkedOutInfo && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
            <p className="text-amber-400 text-sm font-medium">Checked out: {item.checkedOutInfo.label}</p>
            <p className="text-pt-muted text-xs mt-0.5">
              Since {new Date(item.checkedOutInfo.checkedOutAt).toLocaleDateString('en-CA', {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </p>
          </div>
        )}

        {!item.archived && <ReservePanel item={item} entries={bookings[item.id] ?? []} />}

        {/* Location */}
        {canSeeStaff && locationPath && (
          <div>
            <p className="text-pt-muted text-xs mb-1">Bin / storage</p>
            <p className="text-pt-text">{locationPath}</p>
          </div>
        )}

        {item.description && (
          <div>
            <p className="text-pt-muted text-xs mb-1">Description</p>
            <p className="text-pt-text text-sm leading-relaxed whitespace-pre-wrap">{item.description}</p>
          </div>
        )}

        {item.notes && (
          <div>
            <p className="text-pt-muted text-xs mb-1">Notes</p>
            <p className="text-pt-text text-sm leading-relaxed whitespace-pre-wrap">{item.notes}</p>
          </div>
        )}

        {isStaff && !!item.missingQty && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 space-y-2">
            <p className="text-red-300 text-sm font-medium">
              {item.quantity > 1 ? `${item.missingQty} of ${item.quantity} reported missing` : 'Reported missing'} at a return check-in.
              Not bookable until found.
            </p>
            <button onClick={() => run({ missingQty: 0 }, () => updateItem(item.id, { missingQty: 0 }))} disabled={busy}
              className="w-full py-2 rounded-lg bg-green-500/20 text-green-400 text-sm font-medium disabled:opacity-40">
              Found it: make bookable again
            </button>
          </div>
        )}

        {canSeeStaff && internalNotes && (
          <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl px-4 py-3">
            <p className="text-sky-300 text-xs mb-1">Internal notes · arts dept only</p>
            <p className="text-pt-text text-sm leading-relaxed whitespace-pre-wrap">{internalNotes}</p>
          </div>
        )}

        {/* Tags */}
        {item.tags.length > 0 && (
          <div>
            <p className="text-pt-muted text-xs mb-2">Tags</p>
            <div className="flex flex-wrap gap-2">
              {item.tags.map(tagId => tagById[tagId] && (
                <span key={tagId} className="text-sm bg-violet-500/20 text-violet-300 px-3 py-1 rounded-full">
                  {tagById[tagId].label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Characters — arts department only */}
        {canSeeStaff && (characterIds.length > 0 || item.character) && (
          <div>
            <p className="text-pt-muted text-xs mb-2">Character</p>
            <div className="flex flex-wrap gap-2">
              {characterIds.length > 0
                ? characterIds.map(cid => (
                    <span key={cid} className="text-sm bg-sky-500/20 text-sky-300 px-3 py-1 rounded-full">
                      {characterById[cid]?.label ?? cid}
                    </span>
                  ))
                : <span className="text-sm bg-sky-500/20 text-sky-300 px-3 py-1 rounded-full">{item.character}</span>
              }
            </div>
          </div>
        )}

        {canSeeStaff && item.whereToRebuy && (
          <div>
            <p className="text-pt-muted text-xs mb-1">Where to rebuy</p>
            <p className="text-pt-text text-sm">{item.whereToRebuy}</p>
          </div>
        )}

        {!item.archived && <PropSuggestions item={item} />}

        {canSeeStaff && <PropHistory item={item} />}

        {/* The old quick checkout was removed (owner, Oct 20). A prop still marked out there can be put back here. */}
        {isStaff && item.status === 'checked-out' && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 space-y-2">
            <p className="text-amber-200 text-sm">Marked out on the old quick checkout{item.checkedOutInfo?.label ? ` (${item.checkedOutInfo.label})` : ''}. It can't be booked until it's back.</p>
            <button onClick={() => run({ status: 'available' }, () => updateItem(item.id, { status: 'available' }))} disabled={busy}
              className="w-full py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">It's back: mark it in</button>
          </div>
        )}

        {/* Staff controls */}
        {isStaff && (
          <>
            <div>
              <p className="text-pt-muted text-xs mb-2">Condition</p>
              <div className="flex gap-2">
                {(['good', 'fair', 'damaged'] as Condition[]).map(c => (
                  <button
                    key={c}
                    onClick={() => c !== item.condition && setCondition(c)}
                    disabled={busy}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors active:opacity-80 disabled:opacity-50 ${
                      item.condition === c ? `${CONDITION_STYLES[c]} border-transparent` : 'bg-pt-surface border-pt-border text-pt-muted'
                    }`}
                  >
                    {CONDITION_LABELS[c]}
                  </button>
                ))}
              </div>
            </div>

            {actionError && <p className="text-red-400 text-sm">{actionError}</p>}

            <div className="h-px bg-pt-border" />

            {/* Owner + arts: imported props (never booked) can be deleted for good. */}
            {isStaff && item.importedFrom && item.collection === 'company' && (
              deleteState === 'idle' ? (
                <button onClick={() => { setDeleteState('confirm'); setDeleteError(null) }} className="w-full text-red-400 text-sm py-2 active:opacity-70">
                  Delete this imported prop
                </button>
              ) : (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-3">
                  <p className="text-pt-text text-sm font-medium">Delete "{item.name}" for good?</p>
                  <p className="text-pt-muted text-xs">This can't be undone. Its photo can be imported again later. (Props that were ever booked can't be deleted.)</p>
                  {deleteError && <p className="text-red-300 text-xs">{deleteError}</p>}
                  <div className="flex gap-3">
                    <button onClick={() => setDeleteState('idle')} className="flex-1 py-2 rounded-lg shadow-hairline text-pt-text text-sm">Keep it</button>
                    <button disabled={deleteState === 'busy'} onClick={async () => {
                      setDeleteState('busy'); setDeleteError(null)
                      try { await deleteImportedProp({ itemId: item.id }); navigate('/', { replace: true }) }
                      catch (err) { setDeleteError(err instanceof FirebaseError ? err.message.replace(/^.*?:\s*/, '') : "Couldn't reach the server."); setDeleteState('confirm') }
                    }} className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold disabled:opacity-50">
                      {deleteState === 'busy' ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              )
            )}

            {item.archived ? (
              <button onClick={() => setArchived(false)} disabled={busy}
                className="w-full text-pt-accent text-sm py-2 active:opacity-70 disabled:opacity-40">
                Restore to inventory
              </button>
            ) : !showArchiveConfirm ? (
              <button onClick={() => setShowArchiveConfirm(true)}
                className="w-full text-red-400 text-sm py-2 active:opacity-70">
                Archive this prop
              </button>
            ) : (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 space-y-3">
                <p className="text-pt-text text-sm font-medium">Archive "{item.name}"?</p>
                <p className="text-pt-muted text-xs">It disappears from search but nothing is deleted. You can restore it any time.</p>
                <div className="flex gap-3">
                  <button onClick={() => setShowArchiveConfirm(false)}
                    className="flex-1 py-3 rounded-xl shadow-hairline text-pt-muted text-sm active:opacity-70">
                    Cancel
                  </button>
                  <button onClick={() => setArchived(true)} disabled={busy}
                    className="flex-1 py-3 rounded-xl bg-red-500/20 text-red-400 text-sm font-medium active:opacity-70 disabled:opacity-40">
                    {busy ? 'Archiving…' : 'Archive'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-pt-muted text-xs text-center">
          Updated {new Date(item.updatedAt).toLocaleDateString('en-CA', {
            month: 'short', day: 'numeric', year: 'numeric',
          })}
        </p>
      </div>
    </div>

    {lightboxIndex !== null && item.photos[lightboxIndex] && (
      <ImageLightbox
        src={item.photos[lightboxIndex]}
        alt={item.name}
        onClose={() => setLightboxIndex(null)}
      />
    )}
    </>
  )
}
