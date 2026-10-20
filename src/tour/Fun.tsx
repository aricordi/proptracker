// The tour's personality layer (owner, Oct 20: "fun and exciting… like Duolingo… really lean into the story"):
// Cap (the Prime Capitol eagle) is the guide; each chapter opens with a title card (progress ring + the badge you just
// earned + a small confetti burst); pop quizzes check you actually learned it; the end shows every badge.
// Motion only plays when something changes (no loops), and reduced-motion turns it off (index.css).
import { useState, type ReactNode } from 'react'
import BrandMark from '../components/BrandMark'
import { Icon, type IconName } from '../components/Icon'

export interface Chapter { name: string; badge: string; icon: IconName }
export const CHAPTERS: Chapter[] = [
  { name: 'Find your way around', badge: 'Explorer', icon: 'search' },
  { name: 'Book your first shoot', badge: 'Booked it', icon: 'calendar' },
  { name: 'Stock up for your shoot', badge: 'Shopper', icon: 'basket' },
  { name: 'Keep tabs on it', badge: 'On top of it', icon: 'check' },
  { name: 'Meet the AI', badge: 'AI whisperer', icon: 'sparkle' },
  { name: 'When a friend invites you', badge: 'Team player', icon: 'people' },
  { name: 'Pickup day', badge: 'Picked up', icon: 'box' },
  { name: 'Showtime', badge: 'Action!', icon: 'clapper' },
  { name: 'Bring it all back', badge: "That's a wrap", icon: 'restore' },
  { name: 'Stay in the loop', badge: 'In the loop', icon: 'bell' },
]

// Cap: the white eagle on a gold coin. `size` in px.
export function Cap({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`shrink-0 rounded-full grid place-items-center bg-pt-accent shadow-gold ${className}`} style={{ width: size, height: size }} aria-hidden>
      <span style={{ width: size * 0.68 }} className="block"><BrandMark className="w-full text-stone-900" title="" /></span>
    </span>
  )
}

// A one-off burst of gold/white bits from the middle of its box. Purely decorative.
export function Confetti({ count = 26 }: { count?: number }) {
  const [bits] = useState(() => Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4, d = 70 + Math.random() * 110
    return { x: Math.cos(a) * d, y: Math.sin(a) * d - 40, r: Math.random() * 540 - 270, c: ['#C9A961', '#EBD399', '#F5F5F7', '#BF9DFF'][i % 4], w: 5 + Math.random() * 5, delay: Math.random() * 80 }
  }))
  return (
    <span className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
      {bits.map((b, i) => (
        <i key={i} className="confetti-bit" style={{ background: b.c, width: b.w, height: b.w * 0.45, animationDelay: `${b.delay}ms`, ['--x' as string]: `${b.x}px`, ['--y' as string]: `${b.y}px`, ['--r' as string]: `${b.r}deg` }} />
      ))}
    </span>
  )
}

function Ring({ n, of }: { n: number; of: number }) {
  const C = 2 * Math.PI * 30
  return (
    <svg viewBox="0 0 72 72" className="w-[72px] h-[72px]" aria-hidden>
      <circle cx="36" cy="36" r="30" fill="none" stroke="#2C2C2E" strokeWidth="6" />
      <circle cx="36" cy="36" r="30" fill="none" stroke="#C9A961" strokeWidth="6" strokeLinecap="round" transform="rotate(-90 36 36)"
        strokeDasharray={C} className="ring-fill" style={{ ['--from' as string]: C * (1 - (n - 1) / of), ['--to' as string]: C * (1 - n / of) }} />
      <text x="36" y="41" textAnchor="middle" fill="#F5F5F7" fontSize="16" fontWeight="700">{n}/{of}</text>
    </svg>
  )
}

// Full-screen chapter opener. Shows the badge earned in the chapter before (with confetti), then this chapter.
export function ChapterCard({ n, body, onGo, onBack, chapters = CHAPTERS }: { n: number; body: ReactNode; onGo: () => void; onBack?: () => void; chapters?: Chapter[] }) {
  const ch = chapters[n - 1], prev = chapters[n - 2]
  return (
    <div className="fixed inset-0 z-[72] flex flex-col px-6 pt-safe pb-safe" style={{ background: 'radial-gradient(120% 70% at 50% 0%, #2b2416 0%, #000 62%)' }} role="dialog" aria-label={`Chapter ${n}: ${ch.name}`}>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 pt-6">
        {prev && (
          <div className="relative chapter-rise flex flex-col items-center gap-2">
            <Confetti />
            <span className="badge-pop w-20 h-20 rounded-full grid place-items-center bg-pt-accent text-stone-900 shadow-gold"><Icon name={prev.icon} className="w-9 h-9" /></span>
            <p className="text-pt-text font-semibold text-[17px]">Badge unlocked: {prev.badge}</p>
            <p className="text-pt-muted text-[14px]">Chapter {n - 1} done</p>
          </div>
        )}
      </div>
      <div className="pb-6 space-y-3">
        <div className="chapter-rise" style={{ animationDelay: '120ms' }}><Ring n={n} of={chapters.length} /></div>
        <p className="chapter-rise text-pt-accent font-semibold text-[16px]" style={{ animationDelay: '180ms' }}>Chapter {n}</p>
        <h1 className="chapter-rise font-display text-[38px] leading-[1.05] font-extrabold tracking-tight text-pt-text" style={{ animationDelay: '230ms' }}>{ch.name}</h1>
        <div className="chapter-rise flex gap-3 items-start" style={{ animationDelay: '290ms' }}>
          <Cap size={36} className="mt-0.5" />
          <div className="text-[17px] leading-relaxed text-pt-text/85">{body}</div>
        </div>
        <div className="chapter-rise pt-3 space-y-2" style={{ animationDelay: '350ms' }}>
          <button onClick={onGo} className="w-full rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">Let's go</button>
          {onBack && <button onClick={onBack} className="w-full py-2 text-pt-muted text-[15px]">Back</button>}
        </div>
      </div>
    </div>
  )
}

// Pop quiz: tap an answer. Wrong = a gentle shake and Cap explains; right = confetti, then Continue.
export function QuizCard({ part, q, options, correct, explain, onDone, onBack }: { part: number; q: ReactNode; options: string[]; correct: number; explain: ReactNode; onDone: () => void; onBack?: () => void }) {
  const [picked, setPicked] = useState<number | null>(null)
  const [shake, setShake] = useState(0)
  const right = picked === correct
  const choose = (i: number) => { if (right) return; setPicked(i); if (i !== correct) setShake(s => s + 1) }
  return (
    <div className="fixed inset-0 z-[72] bg-black/75 flex items-end sm:items-center justify-center px-3 pb-safe pt-safe" role="dialog" aria-label="Pop quiz">
      <div key={shake} className={`relative w-full max-w-md rounded-[28px] bg-[#F6F1E6] text-stone-900 p-5 mb-3 space-y-4 shadow-float ${shake ? 'coach-nudge' : 'coach-in'}`}>
        {right && <Confetti />}
        <div className="flex items-center gap-2.5"><Cap size={34} /><span className="font-semibold text-[15px]">Cap</span><span className="ml-auto text-[13px] text-stone-500">Pop quiz · Chapter {part}</span></div>
        <p className="text-[20px] font-bold leading-snug">{q}</p>
        <div className="space-y-2">
          {options.map((o, i) => {
            const state = picked === i ? (i === correct ? 'bg-green-600 text-white' : 'bg-red-100 text-red-800 shadow-[inset_0_0_0_1.5px_#dc2626]') : right && i === correct ? 'bg-green-600 text-white' : 'bg-white text-stone-900 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]'
            return <button key={o} onClick={() => choose(i)} className={`w-full text-left rounded-2xl px-4 py-3.5 text-[16px] font-medium transition-colors duration-200 ${state}`}>{o}</button>
          })}
        </div>
        {picked !== null && (
          <div className="coach-in text-[15px] leading-relaxed">
            <p className="font-bold">{right ? 'Nailed it!' : 'Not quite. Try again!'}</p>
            {right && <p className="text-stone-700">{explain}</p>}
          </div>
        )}
        <div className="flex items-center gap-3">
          {onBack && <button onClick={onBack} className="shrink-0 rounded-xl px-3 py-3 text-[15px] text-stone-600">Back</button>}
          <button onClick={onDone} disabled={!right} className="flex-1 rounded-2xl py-3.5 font-bold text-[16px] bg-stone-900 text-[#F6F1E6] disabled:opacity-30">Continue</button>
        </div>
      </div>
    </div>
  )
}

// The finish line: every badge.
export function BadgeWall({ chapters = CHAPTERS }: { chapters?: Chapter[] }) {
  return (
    <div className={`grid gap-3 ${chapters.length % 4 === 0 ? 'grid-cols-4' : 'grid-cols-5'}`}>
      {chapters.map((c, i) => (
        <div key={c.badge} className="flex flex-col items-center gap-1.5 badge-pop" style={{ animationDelay: `${120 + i * 70}ms` }}>
          <span className="w-12 h-12 rounded-full grid place-items-center bg-pt-accent text-stone-900 shadow-gold"><Icon name={c.icon} className="w-6 h-6" /></span>
          <span className="text-xs leading-tight text-pt-muted text-center">{c.badge}</span>
        </div>
      ))}
    </div>
  )
}
