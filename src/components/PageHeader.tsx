import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import { useDesk } from '../desk/desk'

// THE page header for every inner page (design pass, Nov 23: the app had six header styles). A gold "‹ Back" row (44px tap
// area), then a 34px title, an optional muted line under it, and an optional action on the right of the title (a small
// button or link). Sticky with a solid background so content scrolls under it cleanly. On the laptop, pages that are
// sidebar destinations hide Back (`noBackOnDesk`): the sidebar is the way out there.
export function PageHeader({ title, sub, action, back = true, onBack, noBackOnDesk, sticky = true, children }: {
  title: ReactNode; sub?: ReactNode; action?: ReactNode; back?: boolean; onBack?: () => void
  noBackOnDesk?: boolean; sticky?: boolean; children?: ReactNode
}) {
  const navigate = useNavigate()
  const desk = useDesk()
  const showBack = back && !(noBackOnDesk && desk.on)
  const goBack = onBack ?? (() => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/')))
  return (
    <div className={`${sticky ? 'sticky top-0 z-10' : ''} bg-pt-bg pt-safe px-4 pb-3`}>
      {showBack
        ? <button onClick={goBack} className="text-pt-accent text-[17px] min-h-[44px] pr-3 -ml-0.5 inline-flex items-center gap-1"><span aria-hidden className="text-[22px] leading-none -mt-0.5">‹</span>Back</button>
        : <div className="h-2" />}
      <div className="flex items-end gap-3">
        <h1 className="flex-1 min-w-0 font-display text-[34px] leading-tight text-pt-text text-balance">{title}</h1>
        {action && <div className="shrink-0 pb-1">{action}</div>}
      </div>
      {sub && <div className="text-pt-muted text-[15px] mt-1">{sub}</div>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}

// A small action for the header's right side ("+ Invite", "+ Add gear"…), sized to tap.
export function HeaderAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className="min-h-[40px] px-4 rounded-full bg-pt-surface shadow-hairline text-pt-accent text-[15px] font-semibold whitespace-nowrap">{children}</button>
}

// THE empty state (Nov 23: every empty screen looked different): an icon tile, a title, one muted line and an optional
// gold action.
export function EmptyState({ icon, title, line, action, onAction }: { icon: IconName; title: string; line?: ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 px-6 py-10">
      <div className="w-14 h-14 rounded-2xl bg-pt-surface shadow-hairline grid place-items-center text-pt-accent"><Icon name={icon} className="w-7 h-7" /></div>
      <p className="text-pt-text text-[18px] font-semibold">{title}</p>
      {line && <p className="text-pt-muted text-[15px] max-w-[300px]">{line}</p>}
      {action && onAction && <button onClick={onAction} className="mt-1 min-h-[48px] px-6 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">{action}</button>}
    </div>
  )
}
