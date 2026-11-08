// One card anatomy for everything in the chat (owner, Nov 3: "the text is too small… it doesn't guide the reader's eyes…
// use the visual design to guide the user subconsciously"). Same shape every time, so people learn it once:
//   1. a coloured ICON TILE (what kind of thing: seen before any word is read),
//   2. a small coloured LABEL (the category, e.g. "Needs your answer"),
//   3. a big TITLE with the one key fact (who / when / what),
//   4. optional visual content (time tiles, avatars, chips) instead of sentences,
//   5. ONE big primary button (+ a quieter secondary one).
// Colour = meaning, always the same: sky = needs your answer, gold = your move now, amber = heads up, red = didn't work,
// green = done / ready.
import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { primaryBtn, secondaryBtn } from './chatButtons'

export type Tone = 'ask' | 'act' | 'warn' | 'bad' | 'good' | 'plain'
const TONE: Record<Tone, { card: string; tile: string; label: string }> = {
  ask: { card: 'bg-sky-400/[0.12] ring-1 ring-sky-300/35', tile: 'bg-sky-400/20 text-sky-200', label: 'text-sky-200' },
  act: { card: 'bg-pt-accent/[0.12] ring-1 ring-pt-accent/35', tile: 'bg-pt-accent/25 text-pt-accent', label: 'text-pt-accent' },
  warn: { card: 'bg-amber-400/[0.09] ring-1 ring-amber-300/25', tile: 'bg-amber-400/20 text-amber-200', label: 'text-amber-200' },
  bad: { card: 'bg-red-400/[0.09] ring-1 ring-red-300/25', tile: 'bg-red-400/20 text-red-200', label: 'text-red-200' },
  good: { card: 'bg-green-400/[0.09] ring-1 ring-green-300/25', tile: 'bg-green-400/20 text-green-300', label: 'text-green-300' },
  plain: { card: 'bg-pt-surface', tile: 'bg-white/[0.08] text-pt-text', label: 'text-pt-muted' },
}

export function ChatCard({ tone = 'plain', icon, lead, label, title, sub, side, children, actions }: {
  tone?: Tone; icon?: IconName; lead?: ReactNode; label: string; title: ReactNode; sub?: ReactNode
  side?: ReactNode; children?: ReactNode; actions?: ReactNode
}) {
  const t = TONE[tone]
  return (
    <div className={`rise-in rounded-[22px] p-4 ${t.card}`}>
      <div className="flex items-center gap-3">
        {lead ?? (icon && <span className={`w-12 h-12 rounded-2xl grid place-items-center shrink-0 ${t.tile}`}><Icon name={icon} className="w-6 h-6" /></span>)}
        <div className="flex-1 min-w-0">
          <p className={`text-[14px] font-bold ${t.label}`}>{label}</p>
          <p className="text-[18px] font-semibold leading-snug text-pt-text">{title}</p>
          {sub && <p className="text-[16px] text-pt-muted leading-snug mt-0.5">{sub}</p>}
        </div>
        {side}
      </div>
      {children && <div className="mt-3">{children}</div>}
      {actions && <div className="mt-4 flex gap-2">{actions}</div>}
    </div>
  )
}

// The big button and the quiet one.
export { primaryBtn, secondaryBtn }

// A shoot as a "ticket": day number big, then time and place (read in one glance, like a boarding pass).
export function SlotTile({ tag, day, time, place, hot = false }: { tag: string; day: string; time: string; place: string; hot?: boolean }) {
  return (
    <div className={`flex-1 min-w-0 rounded-2xl px-3 py-3 ${hot ? 'bg-pt-accent/[0.16] ring-1 ring-pt-accent/45' : 'bg-black/30'}`}>
      <p className={`text-[12px] font-bold ${hot ? 'text-pt-accent' : 'text-pt-muted'}`}>{tag}</p>
      <p className="text-[18px] font-bold leading-tight mt-0.5">{day}</p>
      <p className="text-[16px] font-semibold text-pt-text">{time}</p>
      <p className="text-[14px] text-pt-text/75 truncate">{place}</p>
    </div>
  )
}

// ── Card FORMS (owner, Nov 3: "the missed check-in and the not-sent props look the same… I want to know what each one
// wants without reading"). Colour alone isn't enough: people sort things by SHAPE, SIZE, IMAGERY and MOTION before they
// read a word (pre-attentive attributes), and things that look alike are read as the same kind (Gestalt similarity).
// So every job has its own silhouette:
//   HeroCard   = "do it now": the ONLY solid-gold block in the app, tall, a live dot, one big round button.
//   AlertCard  = "a deadline / something went wrong": dark card, thick red edge, a countdown ring that empties.
//   DraftCard  = "you started something and didn't finish": dashed outline (= unfinished), the real prop photos fanned.
//   ReadyCard  = "it's ready / it's yours": photo stack with a green check badge.
//   NoticeRow  = "just so you know": a slim row, small icon, an ✕. No big button, so it never competes.
//   ChatCard (sky, avatar) stays "someone is waiting for your answer".

export function LiveDot({ className = 'bg-stone-900' }: { className?: string }) {
  return <span className="relative inline-flex w-2.5 h-2.5" aria-hidden><span className={`live-ping absolute inset-0 rounded-full ${className}`} /><span className={`relative w-2.5 h-2.5 rounded-full ${className}`} /></span>
}

export function HeroCard({ eyebrow, title, sub, action, children }: { eyebrow: ReactNode; title: ReactNode; sub?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rise-in rounded-[26px] p-5 bg-pt-accent text-stone-900 shadow-gold">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-2 text-[14px] font-extrabold">{eyebrow}</p>
          <p className="font-display text-[28px] leading-tight font-extrabold mt-1">{title}</p>
          {sub && <p className="text-[16px] font-medium text-stone-900/70 mt-0.5">{sub}</p>}
        </div>
        {action}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}

// A ring that empties as the time runs out (minutes left of a total).
export function CountdownRing({ left, total, label }: { left: number; total: number; label: string }) {
  const r = 24, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, total > 0 ? left / total : 0))
  return (
    <span className="relative w-16 h-16 shrink-0 grid place-items-center" aria-label={`${label} left`}>
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(248,113,113,.18)" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="#F87171" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - f)} />
      </svg>
      <span className="text-[16px] font-extrabold text-red-200 tabular-nums leading-none">{label}</span>
    </span>
  )
}

export function AlertCard({ label, title, sub, side, actions, children }: { label: string; title: ReactNode; sub?: ReactNode; side?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rise-in relative overflow-hidden rounded-[22px] bg-pt-surface pl-5 pr-4 py-4">
      <span className="absolute left-0 inset-y-0 w-1.5 bg-red-400" aria-hidden />
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-1.5 text-[14px] font-bold text-red-300"><Icon name="alert" className="w-4 h-4" />{label}</p>
          <p className="text-[18px] font-bold leading-snug text-pt-text mt-0.5">{title}</p>
          {sub && <p className="text-[16px] text-pt-muted leading-snug mt-0.5">{sub}</p>}
        </div>
        {side}
      </div>
      {children && <div className="mt-3">{children}</div>}
      {actions && <div className="mt-4 flex gap-2">{actions}</div>}
    </div>
  )
}
export const alertBtn = 'flex-1 rounded-2xl min-h-[52px] px-4 text-[16px] font-bold text-white bg-red-500/80 active:scale-[0.98] transition-transform disabled:opacity-40'

// Real photos, fanned like a little pile (imagery is recognised faster than any icon or word).
export function PhotoStack({ urls, icon = 'basket', size = 58, badge }: { urls: (string | undefined | null)[]; icon?: IconName; size?: number; badge?: ReactNode }) {
  const list = urls.filter(Boolean).slice(0, 3) as string[]
  const tilt = ['-rotate-6', 'rotate-3', 'rotate-[9deg]']
  return (
    <span className="relative shrink-0" style={{ width: size + (list.length > 1 ? (list.length - 1) * 14 : 0), height: size }}>
      {list.length === 0 && <span className="absolute inset-0 rounded-2xl bg-white/[0.08] grid place-items-center text-pt-text"><Icon name={icon} className="w-6 h-6" /></span>}
      {list.map((u, i) => (
        <img key={u + i} src={u} alt="" loading="lazy" decoding="async" style={{ width: size, height: size, left: i * 14, zIndex: 3 - i }}
          className={`absolute top-0 rounded-2xl object-cover bg-pt-border ring-2 ring-pt-bg ${tilt[i]}`} />
      ))}
      {badge && <span className="absolute -bottom-1.5 -right-1.5 z-10">{badge}</span>}
    </span>
  )
}

export function DraftCard({ photos, count, title, sub, action, late = false }: { photos: (string | undefined | null)[]; count: number; title: ReactNode; sub?: ReactNode; action: ReactNode; late?: boolean }) {
  return (
    <div className={`rise-in rounded-[22px] p-4 border-2 border-dashed ${late ? 'border-red-300/50' : 'border-pt-accent/45'}`}>
      <div className="flex items-center gap-4">
        <PhotoStack urls={photos} badge={<span className="min-w-[24px] h-6 px-1.5 rounded-full bg-pt-accent text-stone-900 text-[14px] font-extrabold grid place-items-center ring-2 ring-pt-bg">{count}</span>} />
        <div className="flex-1 min-w-0">
          <p className={`text-[14px] font-bold ${late ? 'text-red-300' : 'text-pt-accent'}`}>Not sent yet</p>
          <p className="text-[18px] font-semibold leading-snug">{title}</p>
          {sub && <p className="text-[14px] text-pt-muted leading-snug mt-0.5">{sub}</p>}
        </div>
      </div>
      <div className="mt-4 flex gap-2">{action}</div>
    </div>
  )
}

// back = "bring these back" (gold return badge); otherwise "ready / yours" (green check badge).
export function ReadyCard({ photos, label, title, sub, icon = 'basket', back = false, actions, children }: { photos: (string | undefined | null)[]; label: string; title: ReactNode; sub?: ReactNode; icon?: IconName; back?: boolean; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rise-in rounded-[22px] p-4 bg-pt-surface">
      <div className="flex items-center gap-4">
        <PhotoStack urls={photos} icon={icon} badge={<span className={`w-6 h-6 rounded-full text-stone-900 grid place-items-center ring-2 ring-pt-bg ${back ? 'bg-pt-accent' : 'bg-green-400'}`}><Icon name={back ? 'restore' : 'check'} className="w-3.5 h-3.5" /></span>} />
        <div className="flex-1 min-w-0">
          <p className={`text-[14px] font-bold ${back ? 'text-pt-accent' : 'text-green-300'}`}>{label}</p>
          <p className="text-[18px] font-semibold leading-snug">{title}</p>
          {sub && <p className="text-[14px] text-pt-muted leading-snug mt-0.5">{sub}</p>}
        </div>
      </div>
      {children && <div className="mt-3">{children}</div>}
      {actions && <div className="mt-4 flex gap-2">{actions}</div>}
    </div>
  )
}

export function NoticeRow({ tone = 'warn', icon, title, sub, action, onClose }: { tone?: 'warn' | 'bad' | 'info'; icon: IconName; title: ReactNode; sub?: ReactNode; action?: ReactNode; onClose?: () => void }) {
  const c = tone === 'bad' ? 'text-red-300 bg-red-400/15' : tone === 'info' ? 'text-sky-200 bg-sky-400/15' : 'text-amber-200 bg-amber-400/15'
  return (
    <div className="rise-in flex items-center gap-3 rounded-2xl bg-white/[0.04] pl-3 pr-1.5 py-2.5">
      <span className={`w-8 h-8 rounded-full grid place-items-center shrink-0 ${c}`}><Icon name={icon} className="w-4 h-4" /></span>
      <div className="flex-1 min-w-0">
        <p className="text-[16px] font-semibold leading-snug">{title}</p>
        {sub && <p className="text-[14px] text-pt-muted leading-snug">{sub}</p>}
        {action && <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">{action}</div>}
      </div>
      {onClose && <button onClick={onClose} aria-label="Dismiss" className="w-10 h-10 shrink-0 grid place-items-center text-pt-muted"><Icon name="x" className="w-4 h-4" /></button>}
    </div>
  )
}
export const noticeLink = 'text-[14px] font-semibold text-pt-accent tap'
