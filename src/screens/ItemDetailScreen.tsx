import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { updateItem, deleteItem } from '../services/items'
import { decrementTagUsage } from '../services/tags'
import { useTags } from '../hooks/useTags'
import { useCharacters } from '../hooks/useCharacters'
import { useLocations } from '../hooks/useLocations'
import { useBins } from '../hooks/useBins'
import ImageLightbox from '../components/ImageLightbox'
import type { Item, ItemStatus } from '../types'

const STATUS_STYLES: Record<string, string> = {
  available:      'bg-green-500/20 text-green-400',
  'checked-out':  'bg-amber-500/20 text-amber-400',
  damaged:        'bg-red-500/20 text-red-400',
}

const STATUS_LABELS: Record<string, string> = {
  available:     'Available',
  'checked-out': 'Checked Out',
  damaged:       'Damaged',
}

const TYPE_LABELS: Record<string, string> = {
  prop:          'Prop',
  costume:       'Costume',
  'set-dressing':'Set Dressing',
  gear:          'Gear',
}

export default function ItemDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const tags       = useTags()
  const characters = useCharacters()
  const locations  = useLocations()
  const bins       = useBins()

  const [item, setItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [statusChanging, setStatusChanging] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    if (!id) return
    getDoc(doc(db, 'items', id)).then(d => {
      if (d.exists()) setItem({ id: d.id, ...d.data() } as Item)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [id])

  const tagById       = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags])
  const characterById = useMemo(() => Object.fromEntries(characters.map(c => [c.id, c])), [characters])
  const locationById  = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations])
  const binById       = useMemo(() => Object.fromEntries(bins.map(b => [b.id, b])), [bins])

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

  async function handleStatusChange(status: ItemStatus) {
    if (statusChanging || status === item!.status) return
    setStatusChanging(true)
    try {
      await updateItem(item!.id, { status })
      setItem(prev => prev ? { ...prev, status } : prev)
    } finally {
      setStatusChanging(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await Promise.all(item!.tags.map(tagId => decrementTagUsage(tagId)))
      await deleteItem(item!.id)
      navigate('/', { replace: true })
    } catch {
      setDeleting(false)
    }
  }

  return (
    <>
    <div className="min-h-screen bg-pt-bg pb-10">
      {/* Header */}
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between border-b border-pt-border">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-pt-text text-base font-medium active:text-pt-muted py-1"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 19-7-7 7-7" />
          </svg>
          Back
        </button>
        <button
          onClick={() => navigate(`/item/${item.id}/edit`)}
          className="text-pt-accent text-sm font-medium active:opacity-70 py-1"
        >
          Edit
        </button>
      </div>

      {/* Photo */}
      <div className="w-full h-64 bg-pt-surface flex items-center justify-center overflow-hidden">
        {item.photoUrl
          ? <button onClick={() => setLightboxOpen(true)} className="w-full h-full active:opacity-90">
              <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover" />
            </button>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-16 h-16 text-pt-muted">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
            </svg>
        }
      </div>

      <div className="p-4 space-y-5">
        {/* Name + type + status */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-pt-text leading-tight">{item.name}</h1>
            <p className="text-pt-muted text-sm mt-0.5">{TYPE_LABELS[item.itemType] ?? item.itemType}</p>
          </div>
          <span className={`text-sm px-3 py-1 rounded-full shrink-0 whitespace-nowrap mt-1 ${STATUS_STYLES[item.status] ?? STATUS_STYLES.available}`}>
            {STATUS_LABELS[item.status] ?? item.status}
          </span>
        </div>

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

        {/* Location */}
        {locationPath && (
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-1">Location</p>
            <p className="text-pt-text">{locationPath}</p>
          </div>
        )}

        {/* Tags */}
        {item.tags.length > 0 && (
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map(tagId => tagById[tagId] && (
                <span key={tagId} className="text-sm bg-violet-500/20 text-violet-300 px-3 py-1 rounded-full">
                  {tagById[tagId].label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Characters */}
        {((item.characters && item.characters.length > 0) || item.character) && (
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Character</p>
            <div className="flex flex-wrap gap-1.5">
              {item.characters && item.characters.length > 0
                ? item.characters.map(id => (
                    <span key={id} className="text-sm bg-sky-500/20 text-sky-300 px-3 py-1 rounded-full">
                      {characterById[id]?.label ?? id}
                    </span>
                  ))
                : <span className="text-sm bg-sky-500/20 text-sky-300 px-3 py-1 rounded-full">{item.character}</span>
              }
            </div>
          </div>
        )}

        {/* Description / Notes */}
        {item.description && (
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-1">Notes</p>
            <p className="text-pt-text text-sm leading-relaxed whitespace-pre-wrap">{item.description}</p>
          </div>
        )}

        {/* Cost */}
        {item.cost != null && (
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-1">Cost</p>
            <p className="text-pt-text">${item.cost.toFixed(2)}</p>
          </div>
        )}

        {/* Where to rebuy */}
        {item.whereToRebuy && (
          <div>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-1">Where to rebuy</p>
            <p className="text-pt-text text-sm">{item.whereToRebuy}</p>
          </div>
        )}

        {/* Status toggle — not shown if checked out (managed via checkout screen) */}
        {item.status !== 'checked-out' && (
          <div className="flex gap-2">
            <button
              onClick={() => handleStatusChange(item.status === 'damaged' ? 'available' : 'damaged')}
              disabled={statusChanging}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-colors active:opacity-80 disabled:opacity-50 ${
                item.status === 'damaged'
                  ? 'bg-red-500/20 border-red-500/40 text-red-400'
                  : 'bg-pt-surface border-pt-border text-pt-muted'
              }`}
            >
              {item.status === 'damaged' ? 'Mark as available' : 'Mark as damaged'}
            </button>
          </div>
        )}

        <div className="h-px bg-pt-border" />

        {/* Delete */}
        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full text-red-400 text-sm py-2 active:opacity-70"
          >
            Delete Item
          </button>
        ) : (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 space-y-3">
            <p className="text-pt-text text-sm font-medium">Delete "{item.name}"?</p>
            <p className="text-pt-muted text-xs">This can't be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-pt-border text-pt-muted text-sm active:opacity-70"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500/20 text-red-400 text-sm font-medium active:opacity-70 disabled:opacity-40"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}

        <p className="text-pt-muted text-xs text-center">
          Updated {new Date(item.updatedAt).toLocaleDateString('en-CA', {
            month: 'short', day: 'numeric', year: 'numeric',
          })}
        </p>
      </div>
    </div>

    {lightboxOpen && item.photoUrl && (
      <ImageLightbox
        src={item.photoUrl}
        alt={item.name}
        onClose={() => setLightboxOpen(false)}
      />
    )}
    </>
  )
}
