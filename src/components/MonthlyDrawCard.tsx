// Book screen: the guaranteed Cliff 1 slots for next month (owner, Nov 1). One slim card: when the wishlist opens,
// how many wishes you have while it's open, then your slots once the draw has run.
import { useNavigate } from 'react-router-dom'
import { formatDay } from '../lib/dates'
import { todayInStudio } from '../../functions/src/booking'
import { nowStamp, fmtTime } from '../../functions/src/gearBooking'
import { useMyWishes, useDraw, wishWindow, drawMonthFor, monthShort } from '../services/draw'
import { Icon } from './Icon'

export default function MonthlyDrawCard({ email }: { email: string }) {
  const navigate = useNavigate()
  const month = drawMonthFor(todayInStudio())
  const win = wishWindow(month)
  const now = nowStamp()
  const wishes = useMyWishes(month, email)
  const draw = useDraw(month)
  const mine = (draw?.placements ?? []).filter(p => p.email === email)
  const when = (st: string) => `${formatDay(st.slice(0, 10), { month: 'short', day: 'numeric' })}, ${fmtTime(Number(st.slice(11, 13)) * 60 + Number(st.slice(14, 16)))}`
  const line = draw?.status === 'done'
    ? (mine.length ? `Your ${mine.length} ${monthShort(month)} slots are booked ✓` : `${monthShort(month)} draw done`)
    : now < win.opens ? `${monthShort(month)} wishlist opens ${formatDay(win.opens.slice(0, 10), { month: 'short', day: 'numeric' })}`
    : now < win.closes ? `${monthShort(month)} wishlist · ${wishes?.wishes.length ?? 0} wish${(wishes?.wishes.length ?? 0) === 1 ? '' : 'es'} · draw ${when(win.closes)}`
    : `${monthShort(month)} draw running…`
  const open = now >= win.opens && now < win.closes && draw?.status !== 'done'
  return (
    <button onClick={() => navigate('/schedule/wishlist')}
      className={`w-full flex items-center gap-3 rounded-2xl px-4 min-h-[52px] text-left ${open ? 'bg-pt-accent/10 shadow-[inset_0_0_0_1px_rgba(201,169,97,0.5)]' : 'bg-pt-surface shadow-hairline'}`}>
      <Icon name="star" className="w-5 h-5 text-pt-accent shrink-0" label="" />
      <span className="flex-1 min-w-0"><span className="block text-pt-text text-sm font-semibold truncate">{line}</span>
        <span className="block text-pt-muted text-xs">Guaranteed Cliff 1 slots, handed out fairly</span></span>
      <span className="text-pt-muted">›</span>
    </button>
  )
}
