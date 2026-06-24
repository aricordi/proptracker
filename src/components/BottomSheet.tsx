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
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-pt-surface rounded-t-2xl pb-safe max-h-[85vh] flex flex-col">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-pt-border" />
        </div>

        {title && (
          <div className="px-5 pb-3 pt-1 border-b border-pt-border shrink-0">
            <h2 className="font-display text-xl text-pt-text">{title}</h2>
          </div>
        )}

        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}
