import { useEffect } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

export default function BottomSheet({ open, onClose, title, children }: Props) {
  // Prevent body scroll while sheet is open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/55 fade-in" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-pt-surface rounded-t-[28px] pb-safe max-h-[85vh] flex flex-col shadow-float sheet-up">
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-2 shrink-0">
          <div className="w-9 h-[5px] rounded-full bg-white/20" />
        </div>

        {title && (
          <div className="px-6 pb-2 pt-2 shrink-0">
            <h2 className="font-display text-[22px] text-pt-text">{title}</h2>
          </div>
        )}

        <div className="overflow-y-auto px-6 pt-3 pb-6">{children}</div>
      </div>
    </div>
  )
}
