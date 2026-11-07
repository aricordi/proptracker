import { Icon } from './Icon'

// "Cliff 1 · Sat, Nov 8 · 1–3 PM · Riley" with a clapperboard: which shoot a request is for. Nothing when there's no shoot.
// Cards allow up to two lines (a long name or an offsite place never hides the day, hours or creator; useShootLines also
// shortens offsite places for cards); a request's own page lets it wrap in full (`wrap`).
export default function ShootLine({ text, label, wrap, className = 'text-pt-text text-sm' }: { text: string; label?: string; wrap?: boolean; className?: string }) {
  if (!text) return null
  return (
    <p className={`flex items-start gap-1.5 min-w-0 ${className}`}>
      <Icon name="clapper" className="w-[1.05em] h-[1.05em] shrink-0 text-pt-accent mt-[0.2em]" />
      <span data-shoot-line className={`min-w-0 break-words ${wrap ? '' : 'line-clamp-2'}`}>{label && <span className="text-pt-muted">{label} </span>}{text}</span>
    </p>
  )
}
