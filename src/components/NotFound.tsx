// A page whose prop / request / gear booking is gone (removed, deleted, or no longer yours). These pages have no
// tab bar, so always give a way out (audit, Nov 7: home-screen app users were stuck on a bare line of text).
import { useNavigate } from 'react-router-dom'

export function NotFound({ title, sub }: { title: string; sub?: string }) {
  const navigate = useNavigate()
  const canGoBack = (window.history.state?.idx ?? 0) > 0
  return (
    <div className="min-h-screen bg-pt-bg pt-safe px-4 flex flex-col">
      <div className="py-2">
        <button onClick={() => (canGoBack ? navigate(-1) : navigate('/'))} className="tap min-h-[44px] -ml-1 text-pt-accent text-[17px]" aria-label="Back">‹ Back</button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 pb-24">
        <p className="text-pt-text text-[20px] font-semibold">{title}</p>
        <p className="text-pt-muted text-[15px] max-w-xs">{sub ?? 'It may have been removed, or it isn\'t shared with you any more.'}</p>
        <button onClick={() => navigate('/')} className="mt-2 rounded-full min-h-[48px] px-6 bg-pt-accent text-black font-semibold text-[16px]">Go home</button>
      </div>
    </div>
  )
}
