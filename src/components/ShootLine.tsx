import { Icon } from './Icon'

// "Cliff 1 · Sat, Nov 8 · 1–3 PM · Riley" with a clapperboard: which shoot a request is for. Nothing when there's no shoot.
// Cards keep it to one line (cut with …); a request's own page lets it wrap (`wrap`).
export default function ShootLine({ text, label, wrap, className = 'text-pt-text text-sm' }: { text: string; label?: string; wrap?: boolean; className?: string }) {
  if (!text) return null
  return (
    <p className={`flex gap-1.5 min-w-0 ${wrap ? 'items-start' : 'items-center'} ${className}`}>
      <Icon name="clapper" className={`w-[1.05em] h-[1.05em] shrink-0 text-pt-accent ${wrap ? 'mt-[0.2em]' : ''}`} />
      <span className={wrap ? '' : 'truncate'}>{label && <span className="text-pt-muted">{label} </span>}{text}</span>
    </p>
  )
}
