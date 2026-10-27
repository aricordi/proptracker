// "Not sent yet" (owner, Oct 27: lazy users add props, close the app and think they asked): anything in the basket
// that hasn't been sent shows as an amber card with one button. The teams can't see it until it's sent.
import { useNavigate } from 'react-router-dom'
import { useCart } from '../cart'
import { useGearCart } from '../gearCart'
import { useActiveShoot, useShootLabel, useCutoffs } from '../activeShoot'
import { todayInStudio } from '../../functions/src/booking'
import { formatDay } from '../lib/dates'

export default function UnsentBasket({ shootId }: { shootId?: string }) {
  const navigate = useNavigate()
  const cart = useCart(), gear = useGearCart()
  const { shoot } = useActiveShoot()
  const label = useShootLabel(), cutoffs = useCutoffs()
  if (cart.count + gear.count === 0) return null
  if (shootId && shoot?.id !== shootId) return null
  const what = [cart.count && `${cart.count} prop${cart.count !== 1 ? 's' : ''}`, gear.count && `${gear.count} gear`].filter(Boolean).join(' and ')
  const c = shoot ? cutoffs(shoot) : null
  const by = c ? (cart.count && gear.count ? (c.props < c.gear ? c.props : c.gear) : cart.count ? c.props : c.gear) : null
  const late = !!by && todayInStudio() > by
  return (
    <div className="rounded-2xl p-4 bg-amber-400/10 shadow-[inset_0_0_0_0.5px_rgba(251,191,36,0.5)] space-y-3">
      <div>
        <p className="text-amber-200 font-semibold">Not sent yet</p>
        <p className="text-pt-text/90 text-sm mt-0.5">
          {what}{shoot && !shootId ? ` for ${label(shoot)}` : ''} {cart.count + gear.count === 1 ? 'is' : 'are'} only on your phone.
          {' '}The teams can't see {cart.count + gear.count === 1 ? 'it' : 'them'} until you send.
          {by && !late && <> Send by <b>{formatDay(by)}</b>.</>}
          {late && <> The cutoff has passed: remove what's late, or ask the team.</>}
        </p>
      </div>
      <button onClick={() => navigate('/reserve')} className="w-full bg-pt-accent text-stone-900 font-semibold rounded-xl py-3 shadow-gold">Review &amp; send</button>
    </div>
  )
}
