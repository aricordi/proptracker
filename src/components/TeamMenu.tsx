// The Team / Admin menu (owner, Oct 23: "way too busy… too many things… organize it better").
// One list of tools per role, sorted into a few named groups instead of one long list. The owner's page also gets
// big "every day" tiles on top and folding groups (open/closed is remembered on the phone). Shared by AdminScreen
// and the tours, so the practice screens always match the real menu.
import { useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type MenuWho = 'owner' | 'admin' | 'equipment' | 'arts'
export interface MenuItem { id: string; to: string; title: string; detail: string; icon: IconName }
export interface MenuGroup { key: string; title: string; icon: IconName; items: MenuItem[] }

const I = (id: string, to: string, title: string, detail: string, icon: IconName): MenuItem => ({ id, to, title, detail, icon })

// Big tiles at the top of the owner's page: the things used every day.
export const OWNER_DAILY: MenuItem[] = [
  I('propsqueue', '/reservations', 'Props queue', 'Pick, pack, check in', 'box'),
  I('gearqueue', '/gear/bookings', 'Gear queue', 'Pickups and returns', 'camera'),
  I('scheduleteam', '/schedule/team', 'Schedule team', 'Check-ins and reports', 'calendar'),
  I('addprop', '/add', 'Add a prop', 'Snap it, AI fills it in', 'plus'),
]

export function teamMenu(who: MenuWho): MenuGroup[] {
  const account = I('myaccount', '/account', who === 'owner' ? 'My account & View as' : 'My account',
    who === 'owner' ? 'Your profile, preview another role, sign out' : 'Your profile, notifications, sign out', 'people')
  const help = I('help', '/help', 'Help', 'How do I…?', 'help')
  if (who === 'owner') return [
    { key: 'people', title: 'Creators & people', icon: 'people', items: [
      I('analytics', '/analytics', 'Analytics', 'Who films more or less, every flag, the teams', 'chart'),
      I('creators', '/creators', 'Creators', 'Each creator’s record, strikes and pauses', 'star'),
      I('users', '/users', 'People & access', 'Invite people, change roles, turn access off', 'people'),
      I('suggestions', '/suggestions', 'Suggested edits', 'Creators’ corrections to props', 'pencil'),
    ] },
    { key: 'props', title: 'Props & storage', icon: 'box', items: [
      I('bins', '/bins', 'Bins & storage', 'Storage areas, bins, QR codes', 'archive'),
      I('categories', '/categories', 'Categories', 'Add, rename or hide categories', 'filter'),
      I('duplicates', '/duplicates', 'Find duplicates', 'Look-alike props to merge', 'search'),
      I('health', '/health', 'Health', 'Fix-it list, counts, export', 'check'),
      I('import', '/import', 'Import props', 'Bring photos in from Google Drive', 'download'),
    ] },
    { key: 'gear', title: 'Gear', icon: 'camera', items: [
      I('bundles', '/gear/bundles', 'Bundles & single items', 'What creators can book', 'box'),
      I('allgear', '/gear/items', 'All gear', 'Every piece you own', 'tools'),
      I('bookgear', '/gear', 'Book gear', 'Hold gear for one of your shoots', 'basket'),
    ] },
    { key: 'rules', title: 'Rules & settings', icon: 'filter', items: [
      I('rulessheet', '/rules-sheet', 'Settings sheet', 'Every rule at a glance', 'table'),
      I('rules', '/booking-rules', 'Booking rules', 'Notice for props, closed days, turnaround', 'clock'),
      I('schedulesettings', '/schedule/settings', 'Schedule settings', 'Houses, slots, priority days, strikes', 'calendar'),
    ] },
    { key: 'money', title: 'Money & connections', icon: 'lock', items: [
      I('costs', '/costs', 'Running costs', 'What the app costs this month', 'chart'),
      I('ai', '/ai', 'AI helpers', 'Monthly AI budget and daily limit', 'sparkle'),
      I('connections', '/connections', 'Calendar & email', 'One Google account for the shared calendar and emails', 'calendar'),
    ] },
    { key: 'more', title: 'Help & records', icon: 'help', items: [
      I('activity', '/activity', 'Activity', 'Everything that happened, who and when', 'note'),
      help,
      I('geartour', '/tour/gear', 'Gear team tour', 'The equipment team’s practice tour', 'flask'),
      I('admintour', '/tour/admin', 'Admin tour', 'The admins’ practice tour', 'flask'),
      account,
    ] },
  ]
  if (who === 'admin') return [
    { key: 'daily', title: 'Every day', icon: 'calendar', items: [
      I('calendar', '/calendar', 'Requests calendar', 'Every props request by shoot day', 'calendar'),
      I('scheduleteam', '/schedule/team', 'Schedule team', 'Missed check-ins and reports to decide', 'clock'),
    ] },
    { key: 'people', title: 'Creators', icon: 'people', items: [
      I('analytics', '/analytics', 'Analytics', 'Who films more or less, every flag, the teams', 'chart'),
      I('creators', '/creators', 'Creators', 'Each creator’s record, strikes and pauses', 'star'),
      I('users', '/users', 'Invite creators', 'Add creators or turn their access off', 'people'),
    ] },
    { key: 'rules', title: 'Rules', icon: 'filter', items: [
      I('rulessheet', '/rules-sheet', 'Settings sheet', 'Every rule at a glance', 'table'),
      I('rules', '/booking-rules', 'Booking rules', 'Notice for props, closed days, turnaround', 'clock'),
    ] },
    { key: 'more', title: 'Help & records', icon: 'help', items: [
      I('activity', '/activity', 'Activity', 'Everything that happened, who and when', 'note'),
      I('admintour', '/tour/admin', 'Admin tour', 'Practise all of this again', 'flask'),
      help, account,
    ] },
  ]
  if (who === 'equipment') return [
    { key: 'gear', title: 'Gear', icon: 'camera', items: [
      I('gearqueue', '/gear/bookings', 'Gear queue', 'Pickups, returns, what’s out', 'camera'),
      I('bundles', '/gear/bundles', 'Bundles & single items', 'What creators can book; build a kit', 'box'),
      I('allgear', '/gear/items', 'All gear', 'Every piece you own', 'tools'),
    ] },
    { key: 'schedule', title: 'Schedule', icon: 'calendar', items: [
      I('scheduleteam', '/schedule/team', 'Schedule team', 'Check-ins, reports, creators, pauses', 'clock'),
    ] },
    { key: 'more', title: 'Help & account', icon: 'help', items: [
      I('geartour', '/tour/gear', 'Gear team tour', 'Practise the gear room again', 'flask'),
      help, account,
    ] },
  ]
  return [   // arts department
    { key: 'daily', title: 'Every day', icon: 'box', items: [
      I('calendar', '/calendar', 'Requests calendar', 'Every props request by shoot day', 'calendar'),
      I('suggestions', '/suggestions', 'Suggested edits', 'Creators’ corrections to props', 'pencil'),
    ] },
    { key: 'props', title: 'Props & storage', icon: 'archive', items: [
      I('bins', '/bins', 'Bins & storage', 'Storage areas, bins, QR codes', 'archive'),
      I('duplicates', '/duplicates', 'Find duplicates', 'Look-alike props to merge', 'search'),
      I('health', '/health', 'Health', 'Fix-it list, counts, export', 'check'),
    ] },
    { key: 'more', title: 'Records & account', icon: 'note', items: [
      I('activity', '/activity', 'Activity', 'Everything that happened, who and when', 'note'),
      help, account,
    ] },
  ]
}

const KEY = 'pc.teamMenuOpen'
const readOpen = (): string[] | null => { try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null } catch { return null } }
const saveOpen = (v: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private mode */ } }

// rowProps lets the tours add their highlight targets and tap handlers to a row.
type RowProps = (item: MenuItem) => Record<string, unknown> | undefined

function Row({ item, onOpen, extra }: { item: MenuItem; onOpen: (to: string) => void; extra?: Record<string, unknown> }) {
  return (
    <button onClick={() => onOpen(item.to)} {...extra} className="w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-left active:bg-pt-bg">
      <span className="w-8 h-8 rounded-full bg-pt-raised grid place-items-center text-pt-accent shrink-0"><Icon name={item.icon} className="w-4 h-4" /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-pt-text font-medium leading-tight">{item.title}</span>
        <span className="block text-pt-muted text-xs mt-0.5 truncate">{item.detail}</span>
      </span>
      <span className="text-pt-muted">›</span>
    </button>
  )
}

export function DailyTiles({ items, onOpen, rowProps }: { items: MenuItem[]; onOpen: (to: string) => void; rowProps?: RowProps }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(t => (
        <button key={t.id} onClick={() => onOpen(t.to)} {...rowProps?.(t)}
          className="text-left bg-pt-surface shadow-hairline rounded-2xl p-3.5 min-h-[96px] flex flex-col justify-between active:opacity-80">
          <span className="w-9 h-9 rounded-full bg-pt-accent/15 grid place-items-center text-pt-accent"><Icon name={t.icon} /></span>
          <span>
            <span className="block text-pt-text font-semibold leading-tight">{t.title}</span>
            <span className="block text-pt-muted text-xs mt-0.5">{t.detail}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

// A titled group that can fold (owner) or always stays open (everyone else, whose lists are short).
export function MenuSection({ title, icon, count, open, onToggle, children, foldable }: {
  title: string; icon: IconName; count?: number; open: boolean; onToggle?: () => void; children: ReactNode; foldable: boolean
}) {
  const head = (
    <span className="flex items-center gap-2 px-1">
      <Icon name={icon} className="w-4 h-4 text-pt-muted" />
      <span className="flex-1 text-pt-text text-[17px] font-semibold tracking-tight">{title}</span>
      {foldable && <span className="text-pt-muted text-sm">{count}</span>}
      {foldable && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-pt-muted transition-transform ${open ? 'rotate-90' : ''}`}><path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" /></svg>}
    </span>
  )
  return (
    <section className="space-y-2">
      {foldable ? <button onClick={onToggle} aria-expanded={open} className="w-full text-left py-1 tap">{head}</button> : <div className="py-1">{head}</div>}
      {open && <div className="bg-pt-surface shadow-hairline rounded-2xl divide-y divide-white/[0.06] overflow-hidden">{children}</div>}
    </section>
  )
}

export function TeamMenu({ groups, onOpen, foldable = false, allOpen = false, rowProps, listProps }: {
  groups: MenuGroup[]; onOpen: (to: string) => void; foldable?: boolean; allOpen?: boolean
  rowProps?: RowProps; listProps?: Record<string, unknown>
}) {
  const [open, setOpen] = useState<string[]>(() => readOpen() ?? [])
  const toggle = (k: string) => setOpen(o => { const n = o.includes(k) ? o.filter(x => x !== k) : [...o, k]; saveOpen(n); return n })
  return (
    <div className="space-y-4" {...listProps}>
      {groups.map(g => (
        <MenuSection key={g.key} title={g.title} icon={g.icon} count={g.items.length} foldable={foldable}
          open={!foldable || allOpen || open.includes(g.key)} onToggle={() => toggle(g.key)}>
          {g.items.map(it => <Row key={it.id} item={it} onOpen={onOpen} extra={rowProps?.(it)} />)}
        </MenuSection>
      ))}
    </div>
  )
}

// The owner's creator scoreboard, folded away under one header (open state remembered like the groups).
export function FoldableBlock({ id, title, icon, children }: { id: string; title: string; icon: IconName; children: ReactNode }) {
  const [open, setOpen] = useState(() => (readOpen() ?? []).includes(id))
  const toggle = () => setOpen(v => { const o = (readOpen() ?? []).filter(x => x !== id); saveOpen(v ? o : [...o, id]); return !v })
  return (
    <section className="space-y-2">
      <button onClick={toggle} aria-expanded={open} className="w-full text-left py-1 tap">
        <span className="flex items-center gap-2 px-1">
          <Icon name={icon} className="w-4 h-4 text-pt-muted" />
          <span className="flex-1 text-pt-text text-[17px] font-semibold tracking-tight">{title}</span>
          <span className="text-pt-muted text-sm">{open ? 'Hide' : 'Show'}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-pt-muted transition-transform ${open ? 'rotate-90' : ''}`}><path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" /></svg>
        </span>
      </button>
      {open && children}
    </section>
  )
}
