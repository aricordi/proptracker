import { useNavigate } from 'react-router-dom'
import type { Item, Tag, Location, Bin } from '../types'

const STATUS_STYLES: Record<string, string> = {
  available:      'bg-green-500/20 text-green-400',
  'checked-out':  'bg-amber-500/20 text-amber-400',
  damaged:        'bg-red-500/20 text-red-400',
  used:           'bg-stone-500/20 text-stone-400',
}

const STATUS_LABELS: Record<string, string> = {
  available:     'Available',
  'checked-out': 'Out',
  damaged:       'Damaged',
  used:          'Used',
}

interface Props {
  item: Item
  tagById: Record<string, Tag>
  locationById: Record<string, Location>
  binById: Record<string, Bin>
}

export default function ItemCard({ item, tagById, locationById, binById }: Props) {
  const navigate = useNavigate()
  const location = item.locationId ? locationById[item.locationId] : null
  const bin = item.binId ? binById[item.binId] : null
  const locationPath = [location?.name, bin?.label].filter(Boolean).join(' › ')

  return (
    <button
      onClick={() => navigate(`/item/${item.id}`)}
      className="w-full flex gap-3 bg-pt-surface border border-pt-border rounded-2xl p-3 text-left active:opacity-75 transition-opacity"
    >
      {/* Thumbnail */}
      <div className="w-20 h-20 rounded-xl bg-pt-border overflow-hidden shrink-0 flex items-center justify-center">
        {item.photoUrl
          ? <img src={item.photoUrl} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-pt-muted">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
            </svg>
        }
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <p className="font-semibold text-pt-text leading-tight">{item.name}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap ${STATUS_STYLES[item.status] ?? STATUS_STYLES.available}`}>
            {STATUS_LABELS[item.status] ?? item.status}
          </span>
        </div>

        {locationPath && (
          <p className="text-pt-muted text-xs truncate mb-1">{locationPath}</p>
        )}

        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map(id => tagById[id] && (
              <span key={id} className="text-xs bg-stone-600/60 text-stone-300 px-2 py-0.5 rounded-full">
                {tagById[id].label}
              </span>
            ))}
            {item.tags.length > 3 && (
              <span className="text-xs text-stone-400">+{item.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}
