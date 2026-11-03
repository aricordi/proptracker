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
          <p className={`text-[13px] font-bold ${t.label}`}>{label}</p>
          <p className="text-[18px] font-semibold leading-snug text-pt-text">{title}</p>
          {sub && <p className="text-[15px] text-pt-muted leading-snug mt-0.5">{sub}</p>}
        </div>
        {side}
      </div>
      {children && <div className="mt-3">{children}</div>}
      {actions && <div className="mt-4 flex gap-2">{actions}</div>}
    </div>
  )
}

// The big button and the quiet one.
export const primaryBtn = 'flex-1 rounded-2xl min-h-[52px] px-4 text-[17px] font-bold text-stone-900 bg-pt-accent shadow-gold active:scale-[0.98] transition-transform disabled:opacity-40'
export const secondaryBtn = 'rounded-2xl min-h-[52px] px-4 text-[16px] font-semibold text-pt-text bg-white/[0.08] active:scale-[0.98] transition-transform disabled:opacity-40'

// A shoot as a "ticket": day number big, then time and place (read in one glance, like a boarding pass).
export function SlotTile({ tag, day, time, place, hot = false }: { tag: string; day: string; time: string; place: string; hot?: boolean }) {
  return (
    <div className={`flex-1 min-w-0 rounded-2xl px-3 py-3 ${hot ? 'bg-pt-accent/[0.16] ring-1 ring-pt-accent/45' : 'bg-black/30'}`}>
      <p className={`text-[12px] font-bold ${hot ? 'text-pt-accent' : 'text-pt-muted'}`}>{tag}</p>
      <p className="text-[20px] font-bold leading-tight mt-0.5">{day}</p>
      <p className="text-[15px] font-semibold text-pt-text">{time}</p>
      <p className="text-[13px] text-pt-muted truncate">{place}</p>
    </div>
  )
}
