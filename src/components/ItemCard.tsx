import { useNavigate } from 'react-router-dom'
import type { Item, Condition } from '../types'
import { thumbOf } from '../services/itemShape'

export const CONDITION_LABELS: Record<Condition, string> = {
  good:    'Good',
  fair:    'Fair',
  damaged: 'Damaged',
}

export const CONDITION_STYLES: Record<Condition, string> = {
  good:    'bg-green-500/20 text-green-400',
  fair:    'bg-yellow-500/20 text-yellow-300',
  damaged: 'bg-red-500/20 text-red-400',
}

export function formatMoney(n: number) {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

const CameraIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
  </svg>
)

function badge(item: Item) {
  if (item.archived)                 return { label: 'Archived',  style: 'bg-pt-border text-pt-muted' }
  if (item.status === 'checked-out') return { label: 'Out',       style: 'bg-amber-500/90 text-stone-900' }
  if (item.condition === 'damaged')  return { label: 'Damaged',   style: 'bg-red-500/90 text-white' }
  return { label: 'Available', style: 'bg-green-500/90 text-stone-900' }
}

export interface Badge { label: string; style: string }

interface Props {
  item: Item
  subtitle?: string     // e.g. category, or bin for staff
  badge?: Badge         // overrides the status badge (e.g. "3 free" for chosen dates)
  inCart?: number       // quantity already in the reservation being built
}

// One tile in the 2-across search grid: big photo, name, status.
export default function ItemCard({ item, subtitle, badge: override, inCart }: Props) {
  const navigate = useNavigate()
  const { label, style } = override ?? badge(item)

  return (
    <button
      onClick={() => navigate(`/item/${item.id}`)}
      className="w-full h-full flex flex-col text-left bg-pt-surface border border-pt-border rounded-2xl overflow-hidden active:opacity-75 transition-opacity"
    >
      <div className="relative aspect-square bg-pt-border flex items-center justify-center">
        {item.photos[0]
          ? <img src={thumbOf(item, item.photos[0])} alt={item.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          : <CameraIcon className="w-10 h-10 text-pt-muted" />
        }
        <span className={`absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full ${style}`}>{label}</span>
        {!!inCart && (
          <span className="absolute top-2 right-2 bg-pt-accent text-stone-900 text-[11px] font-bold px-2 py-0.5 rounded-full">
            ✓ {item.quantity > 1 ? inCart : 'Added'}
          </span>
        )}
        {item.quantity > 1 && (
          <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-semibold px-1.5 py-0.5 rounded-md">
            ×{item.quantity}
          </span>
        )}
      </div>
      <div className="px-2.5 py-2">
        <p className="text-pt-text text-sm font-semibold leading-tight line-clamp-2">{item.name}</p>
        {subtitle && <p className="text-pt-muted text-xs truncate mt-0.5">{subtitle}</p>}
      </div>
    </button>
  )
}
