import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { getBinBySlug } from '../services/bins'
import type { Bin, Location } from '../types'

export default function BinQrScreen() {
  const { qrSlug } = useParams<{ qrSlug: string }>()
  const navigate = useNavigate()
  const [bin, setBin] = useState<Bin | null>(null)
  const [location, setLocation] = useState<Location | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!qrSlug) { setLoading(false); return }
    getBinBySlug(qrSlug).then(async found => {
      if (!found) { setLoading(false); return }
      setBin(found)
      if (found.locationId) {
        const locDoc = await getDoc(doc(db, 'locations', found.locationId))
        if (locDoc.exists()) {
          setLocation({ id: locDoc.id, ...locDoc.data() } as Location)
        }
      }
      setLoading(false)
    })
  }, [qrSlug])

  if (loading) {
    return <div className="p-6 pt-safe text-pt-muted text-sm">Loading…</div>
  }

  if (!bin) {
    return (
      <div className="p-6 pt-safe text-center">
        <p className="text-pt-muted text-sm mb-4">Bin not found. It may have been deleted.</p>
        <button onClick={() => navigate('/')} className="text-pt-accent text-sm underline">
          Go home
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 pt-safe">
      <p className="text-pt-muted text-sm mb-1">{location?.name ?? 'No location'}</p>
      <h1 className="font-display text-4xl text-pt-accent mb-8">{bin.label}</h1>

      <button
        onClick={() => navigate(`/add?binId=${bin.id}&locationId=${bin.locationId ?? ''}`)}
        className="w-full bg-pt-accent text-stone-900 py-4 rounded-2xl font-semibold text-lg active:opacity-80 mb-3"
      >
        Add item to this bin
      </button>

      <button
        onClick={() => navigate('/')}
        className="w-full text-pt-muted py-3 rounded-2xl text-sm active:text-pt-text"
      >
        Search inventory
      </button>
    </div>
  )
}
