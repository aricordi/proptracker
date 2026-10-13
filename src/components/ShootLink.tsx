import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore'
import { db } from '../firebase'

// A shoot booked props + gear together: link from one half to the other.
// (Shown to people who can see the other half: the creator, and the owner.)
export default function ShootLink({ shootId, creatorEmail, other }: { shootId?: string; creatorEmail: string; other: 'props' | 'gear' }) {
  const navigate = useNavigate()
  const [target, setTarget] = useState<{ id: string; count: number } | null>(null)
  useEffect(() => {
    if (!shootId) return
    const col = collection(db, other === 'props' ? 'reservations' : 'gear_bookings')
    return onSnapshot(query(col, where('shootId', '==', shootId), where('creatorEmail', '==', creatorEmail), limit(1)),
      snap => {
        const d = snap.docs[0]
        setTarget(d ? { id: d.id, count: ((d.get('lines') as unknown[] | undefined) ?? []).length + ((d.get('builds') as unknown[] | undefined) ?? []).length } : null)
      },
      () => setTarget(null))
  }, [shootId, creatorEmail, other])
  if (!target) return null
  return (
    <button onClick={() => navigate(other === 'props' ? `/reservations/${target.id}` : `/gear/bookings/${target.id}`)}
      className="w-full flex items-center justify-between bg-pt-surface rounded-2xl px-4 py-3 text-[15px] active:opacity-80">
      <span className="text-pt-text">Also in this shoot: {other === 'props' ? 'props' : 'gear'} ({target.count})</span>
      <span className="text-pt-accent">Open ›</span>
    </button>
  )
}
