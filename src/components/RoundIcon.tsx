// Small round icon buttons for the less-used things (help, team, settings), so screens
// don't fill up with words. Each has a label for screen readers and a tooltip.
import { useNavigate } from 'react-router-dom'

const ICONS = {
  help: <><circle cx="12" cy="12" r="9.5" /><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4.1" /><circle cx="12" cy="17.6" r=".6" fill="currentColor" /></>,
  team: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5a6 6 0 0 1 12 0" /><circle cx="17" cy="9.5" r="2.5" /><path d="M16 14.2a5 5 0 0 1 5.5 5.3" /></>,
  settings: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
}

export default function RoundIcon({ icon, label, to, onClick }: { icon: keyof typeof ICONS; label: string; to?: string; onClick?: () => void }) {
  const navigate = useNavigate()
  return (
    <button onClick={onClick ?? (() => to && navigate(to))} aria-label={label} title={label}
      className="w-11 h-11 rounded-full grid place-items-center bg-pt-surface shadow-hairline text-pt-text">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{ICONS[icon]}</svg>
    </button>
  )
}
