// Line icons in the same style as the tab bar (24-grid, 2px stroke, round ends, currentColor).
// Used instead of emoji so every icon in the app looks like it belongs to one family.
const PATHS = {
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  tools: <><path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5" /><path d="M14.5 6.5 17 4l3 3-2.5 2.5" /></>,
  clapper: <><path d="M4 10h16v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" /><path d="m4 10-.6-3.4a1.5 1.5 0 0 1 1.2-1.7l12.8-2.3a1.5 1.5 0 0 1 1.7 1.2L19.6 7 4 10zM8.5 4.6l2.4 3.6M13.5 3.7l2.4 3.6" /></>,
  video: <><rect x="3" y="6.5" width="12.5" height="11" rx="2" /><path d="m15.5 10.5 5.5-3v9l-5.5-3" /></>,
  camera: <><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.6-2.5h5.4L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" /><circle cx="12" cy="13" r="3.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  flame: <path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-3.5-2.5-5.5-3.5-8.5-1.5 2-2 3.5-2 5-1-1-2-2.5-2-4.5C8 9 5.5 11.5 5.5 14.5A6.5 6.5 0 0 0 12 21z" />,
  battery: <><rect x="3" y="7.5" width="16" height="9" rx="2" /><path d="M21 10.5v3M6.5 10.5v3M10 10.5v3" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  note: <><path d="M6 3.5h8.5L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5A1.5 1.5 0 0 1 6.5 3.5z" /><path d="M14 3.5V8h5M8.5 12.5h7M8.5 16h5" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  box: <><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  pencil: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />,
  archive: <><rect x="3.5" y="4.5" width="17" height="4.5" rx="1" /><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4" /></>,
  restore: <><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" /><path d="M4 4v4.5h4.5" /></>,
  basket: <><path d="M4 9.5h16l-1.6 9a1.5 1.5 0 0 1-1.5 1.2H7.1a1.5 1.5 0 0 1-1.5-1.2z" /><path d="m8.5 9.5 3.5-6 3.5 6" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  stop: <><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></>,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  handshake: <><path d="m3 11 4-4 5 1.5L17 7l4 4-5 5.5a1.6 1.6 0 0 1-2.3 0L9.5 12" /><path d="m3 11 5.5 6a1.6 1.6 0 0 0 2.3 0l.7-.7" /></>,
  swap: <><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" /></>,
  chat: <path d="M4.5 5.5h15A1.5 1.5 0 0 1 21 7v9a1.5 1.5 0 0 1-1.5 1.5H10L5.5 21v-3.5h-1A1.5 1.5 0 0 1 3 16V7a1.5 1.5 0 0 1 1.5-1.5z" />,
  mask: <path d="M4 6c5 2 11 2 16 0 0 7.5-2.5 13-8 13S4 13.5 4 6zM8.5 10.5h2M13.5 10.5h2M9.5 15c1.5 1 3.5 1 5 0" />,
  sparkle: <path d="M12 3c.8 4.6 2.6 6.9 7 8-4.4 1.1-6.2 3.4-7 8-.8-4.6-2.6-6.9-7-8 4.4-1.1 6.2-3.4 7-8z" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  hand: <path d="M9 11V5a1.5 1.5 0 0 1 3 0v5V4a1.5 1.5 0 0 1 3 0v6.5V6a1.5 1.5 0 0 1 3 0v8.5a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.7-2.3L4 15.5a1.6 1.6 0 0 1 2.4-2L9 15.5z" />,
  pause: <><circle cx="12" cy="12" r="8.5" /><path d="M10 9v6M14 9v6" /></>,
  flask: <path d="M9.5 3.5h5M10.5 3.5v6L4.8 18.3A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.2-2.2L13.5 9.5v-6M7.5 15h9" />,
  people: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19.5a6 6 0 0 1 12 0M16 4.8a3.2 3.2 0 0 1 0 6.4M17.5 13.6a6 6 0 0 1 3.5 5.9" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.6M12 17h.01" /></>,
  party: <path d="M4 20 8.5 8.5l7 7zM14 4.5l.5 2M18.5 9.5l2 .5M16.5 6.5 19 4M11 7c1-1 1.5-2.5 1-4M17 13c1-1 2.5-1.5 4-1" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  file: <><path d="M6.5 3.5H14L19 8.5v10.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z" /><path d="M14 3.5v5h5" /></>,
  filter: <path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 1.8v-7.2z" />,
  table: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" /></>,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  chart: <path d="M4 19.5h16M7 16v-5M12 16V7M17 16v-3" />,
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
}
export type IconName = keyof typeof PATHS

export function Icon({ name, className = 'w-5 h-5', label }: { name: IconName; className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {PATHS[name]}
    </svg>
  )
}

// Icon + text on one line (replaces "📅 Sat, Oct 24" style prefixes).
export function IconText({ name, children, className = '' }: { name: IconName; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 ${className}`}><Icon name={name} className="w-[1.05em] h-[1.05em] opacity-80" />{children}</span>
}
