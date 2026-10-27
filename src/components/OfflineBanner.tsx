// A small amber strip under the clock while the phone has no signal (owner, Oct 27: nobody should wonder why a tap
// "does nothing"). Looking around still works from what's on the phone; booking and sending need a connection.
import { useEffect, useState } from 'react'

export default function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (!offline) return null
  return (
    <div role="status" className="fixed inset-x-0 z-[80] flex justify-center px-4 pointer-events-none" style={{ top: 'calc(env(safe-area-inset-top) + 6px)' }}>
      <p className="bg-amber-400 text-stone-900 text-sm font-semibold rounded-full px-4 py-1.5 shadow-float">
        No signal. Sending waits until you're back online.
      </p>
    </div>
  )
}
