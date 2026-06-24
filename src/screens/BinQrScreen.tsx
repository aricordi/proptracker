import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { getBinBySlug } from '../services/bins'
import { useItems } from '../hooks/useItems'
import type { Bin, Location } from '../types'

export default function BinQrScreen() {
  const { qrSlug } = useParams<{ qrSlug: string }>()
  const navigate = useNavigate()
  const allItems = useItems()

  const [bin, setBin]           = useState<Bin | null>(null)
  const [location, setLocation] = useState<Location | null>(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!qrSlug) { setLoading(false); return }
    getBinBySlug(qrSlug).then(async found => {
      if (!found) { setLoading(false); return }
      setBin(found)
      if (found.locationId) {
        const locDoc = await getDoc(doc(db, 'locations', found.locationId))
        if (locDoc.exists()) setLocation({ id: locDoc.id, ...locDoc.data() } as Location)
      }
      setLoading(false)
    })
  }, [qrSlug])

  const binItems = useMemo(
    () => bin ? allItems.filter(i => i.binId === bin.id) : [],
    [allItems, bin],
  )

  if (loading) {
    return <div className="p-6 pt-safe text-pt-muted text-sm">Loading…</div>
  }

  if (!bin) {
    return (
      <div className="p-6 pt-safe text-center">
        <p className="text-pt-muted text-sm mb-4">Bin not found. It may have been deleted.</p>
        <button onClick={() => navigate('/')} className="text-pt-accent text-sm underline">Go home</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-pt-bg pb-8">
      {/* Header */}
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3 border-b border-pt-border flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-pt-text text-base font-medium active:text-pt-muted py-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="text-right">
          <p className="font-display text-xl text-pt-accent leading-tight">{bin.label}</p>
          {location && <p className="text-pt-muted text-xs">{location.name}</p>}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Add item button */}
        <button
          onClick={() => navigate(`/add?binId=${bin.id}&locationId=${bin.locationId ?? ''}`)}
          className="w-full bg-pt-accent text-stone-900 py-3.5 rounded-2xl font-semibold active:opacity-80"
        >
          + Add item to this bin
        </button>

        {/* Items in bin */}
        {binItems.length === 0 ? (
          <p className="text-pt-muted text-sm text-center py-8">No items in this bin yet.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-pt-muted text-xs uppercase tracking-wider px-1">
              {binItems.length} item{binItems.length !== 1 ? 's' : ''}
            </p>
            {binItems.map(item => (
              <button
                key={item.id}
                onClick={() => navigate(`/item/${item.id}`)}
                className="w-full flex items-center gap-3 bg-pt-surface border border-pt-border rounded-2xl p-3 text-left active:opacity-75"
              >
                <div className="w-12 h-12 rounded-xl bg-pt-border overflow-hidden shrink-0 flex items-center justify-center">
                  {item.photoUrl
                    ? <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover" />
                    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 text-pt-muted">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                      </svg>
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-pt-text font-medium text-sm leading-tight truncate">{item.name}</p>
                  <p className="text-pt-muted text-xs mt-0.5 capitalize">{item.itemType}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                  item.status === 'checked-out'
                    ? 'bg-amber-500/20 text-amber-400'
                    : item.status === 'damaged'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-green-500/20 text-green-400'
                }`}>
                  {item.status === 'checked-out' ? 'Out' : item.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
