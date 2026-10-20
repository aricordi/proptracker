import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeToActivity, type Activity } from '../services/activity'
import { subscribeToUsers } from '../services/users'
import { useCategories } from '../hooks/useCategories'
import { useBins } from '../hooks/useBins'
import { useLocations } from '../hooks/useLocations'
import { useTags } from '../hooks/useTags'
import { formatDay } from '../lib/dates'
import type { AppUser } from '../types'
import { Icon, type IconName } from './Icon'

const FIELD_NAMES: Record<string, string> = {
  name: 'Name', quantity: 'Quantity', condition: 'Condition', replacementCost: 'Replacement cost',
  categoryId: 'Category', locationId: 'Storage area', binId: 'Bin', missingQty: 'Missing', archived: 'Archived',
  status: 'Quick checkout', description: 'Description', notes: 'Notes for creators', tags: 'Tags',
  photos: 'Photos', whereToRebuy: 'Where to rebuy', collection: 'Belongs to',
}

const BOOKING_WORDS: Record<string, string> = {
  requested: 'booked', preparing: 'started picking', packed: 'packed', collected: 'picked up',
  return_pending: 'brought back', returned: 'checked in', declined: 'declined', cancelled: 'cancelled', edited: 'changed',
}

const ICONS: Record<string, IconName> = {
  added: 'plus', edited: 'pencil', archived: 'archive', unarchived: 'restore', requested: 'calendar', preparing: 'basket', packed: 'box',
  collected: 'handshake', return_pending: 'restore', returned: 'check', declined: 'stop', cancelled: 'x', unavailable: 'stop',
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })

// The activity log as a list. Used by the Activity screen and the history pages.
export default function ActivityList({ itemId, creatorEmail, kind, personal, pageSize = 50 }: {
  itemId?: string; creatorEmail?: string; kind?: 'prop' | 'booking'; personal?: boolean; pageSize?: number
}) {
  const navigate = useNavigate()
  const [max, setMax] = useState(pageSize)
  const [rows, setRows] = useState<Activity[] | null>(null)
  const [users, setUsers] = useState<AppUser[]>([])
  const categories = useCategories(), bins = useBins(), locations = useLocations(), tags = useTags()

  useEffect(() => subscribeToActivity({ itemId, creatorEmail, kind, personal }, max, setRows), [itemId, creatorEmail, kind, personal, max])
  useEffect(() => subscribeToUsers(setUsers), [])

  const nameOf = useMemo(() => {
    const m = new Map(users.map(u => [u.email, u.name || u.email]))
    return (email: string) => m.get(email) ?? email
  }, [users])

  // Show IDs as the names people know.
  const pretty = (field: string, v: string | number | boolean | null) => {
    if (v === null || v === '') return '—'
    if (field === 'categoryId') return categories.find(c => c.id === v)?.label ?? String(v)
    if (field === 'binId') return bins.find(b => b.id === v)?.label ?? String(v)
    if (field === 'locationId') return locations.find(l => l.id === v)?.name ?? String(v)
    if (field === 'tags') return String(v).split(', ').map(id => tags.find(t => t.id === id)?.label ?? id).join(', ')
    if (field === 'replacementCost') return `$${Number(v).toFixed(2)}`
    if (field === 'photos') return `${v} photo${v === 1 ? '' : 's'}`
    if (field === 'archived') return v ? 'yes' : 'no'
    if (field === 'status') return v === 'checked-out' ? 'out' : 'in'
    if (field === 'collection') return v === 'company' ? 'Prime Capitol' : 'Personal'
    return String(v)
  }

  const shown = rows ?? []
  if (rows === null) return <p className="text-pt-muted text-sm text-center py-6">Loading…</p>
  if (shown.length === 0) return <p className="text-pt-muted text-sm text-center py-6">Nothing recorded yet.</p>

  let lastDay = ''
  return (
    <div className="space-y-2">
      {shown.map(a => {
        const day = a.at.slice(0, 10)
        const header = day !== lastDay ? (lastDay = day) : null
        const who = nameOf(a.by)
        const what = a.kind === 'bin'
          ? <>{who} merged look-alike bins into <b className="font-medium">{a.itemName}</b></>
          : a.kind === 'prop'
          ? <>{who} {a.action === 'added' ? 'added' : a.action === 'archived' ? 'archived' : a.action === 'unarchived' ? 'brought back' : 'changed'} <b className="font-medium">{a.itemName}</b></>
          : a.action === 'unavailable'
            ? <>{who} marked <b className="font-medium">{a.itemName}</b> not available for <b className="font-medium">{a.title}</b></>
            : <>{who} {BOOKING_WORDS[a.action] ?? a.action} <b className="font-medium">{a.title}</b>{a.creatorEmail && a.creatorEmail !== a.by ? <> ({nameOf(a.creatorEmail)})</> : null}</>
        const go = a.kind === 'booking' && a.reservationId ? `/reservations/${a.reservationId}` : a.itemIds[0] ? `/item/${a.itemIds[0]}` : null
        return (
          <div key={a.id}>
            {header && <p className="text-pt-muted text-xs pt-3 pb-1">{formatDay(day)}</p>}
            <button onClick={() => go && navigate(go)} className="w-full text-left bg-pt-surface shadow-hairline rounded-xl px-3 py-2 active:opacity-75">
              <div className="flex gap-2">
                <span className="shrink-0">{ICONS[a.action] ? <Icon name={ICONS[a.action]} className="w-4 h-4 text-pt-muted mt-0.5" /> : '•'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-pt-text text-sm">{what}</p>
                  {a.changes?.filter(c => c.field !== 'archived').map(c => (
                    <p key={c.field} className="text-pt-muted text-xs">
                      {FIELD_NAMES[c.field] ?? c.field}: {pretty(c.field, c.from)} → <span className="text-pt-text">{pretty(c.field, c.to)}</span>
                    </p>
                  ))}
                  {a.reason && <p className="text-pt-muted text-xs">{a.reason}</p>}
                </div>
                <span className="text-pt-muted text-xs shrink-0">{time(a.at)}</span>
              </div>
            </button>
          </div>
        )
      })}
      {shown.length >= max && (
        <button onClick={() => setMax(m => m + pageSize)} className="w-full py-3 text-pt-accent text-sm">Show more</button>
      )}
    </div>
  )
}
