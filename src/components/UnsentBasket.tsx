// "Not sent yet" (owner, Oct 27: lazy users add props, close the app and think they asked): anything in the basket
// that hasn't been sent shows as an amber card with one button. The teams can't see it until it's sent.
import { useNavigate } from 'react-router-dom'
import { useCart } from '../cart'
import { useGearCart } from '../gearCart'
import { useActiveShoot, useCutoffs } from '../activeShoot'
import { useScheduleSettings } from '../services/schedule'
import { todayInStudio } from '../../functions/src/booking'
import { formatDay } from '../lib/dates'
import { ChatCard, primaryBtn } from './ChatCard'

export default function UnsentBasket({ shootId }: { shootId?: string }) {
  const navigate = useNavigate()
  const cart = useCart(), gearCart = useGearCart()
  // Gear isn't booked ahead (owner, Nov 3): gear picked to take on the day isn't an unsent request.
  const gear = useScheduleSettings().gearReserve ? gearCart : { count: 0 }
  const { shoot } = useActiveShoot()
  const cutoffs = useCutoffs()
  if (cart.count + gear.count === 0) return null
  if (shootId && shoot?.id !== shootId) return null
  const what = [cart.count && `${cart.count} prop${cart.count !== 1 ? 's' : ''}`, gear.count && `${gear.count} gear`].filter(Boolean).join(' and ')
  const c = shoot ? cutoffs(shoot) : null
  const by = c ? (cart.count && gear.count ? (c.props < c.gear ? c.props : c.gear) : cart.count ? c.props : c.gear) : null
  const late = !!by && todayInStudio() > by
  const n = cart.count + gear.count
  return (
    <ChatCard tone="warn" icon="basket" label="Not sent yet" title={`${what} on your phone only`}
      sub={late ? "The cutoff passed: remove what's late, or ask the team." : by ? `The team can't see ${n === 1 ? 'it' : 'them'} yet · send by ${formatDay(by, { weekday: 'short', month: 'short', day: 'numeric' })}` : `The team can't see ${n === 1 ? 'it' : 'them'} yet`}
      actions={<button onClick={() => navigate('/reserve')} className={primaryBtn}>Review &amp; send</button>} />
  )
}
