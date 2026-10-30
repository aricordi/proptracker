// Birthdays (owner, Oct 30): on your birthday the app throws you a little party (cake, candles, confetti); on a
// team member's birthday everyone else gets a short "It's X's birthday today" pop-up. Each shows once a day per phone.
import { useEffect, useState } from 'react'
import { useProfiles } from '../services/profiles'
import { useSession } from '../auth'
import { todayInStudio } from '../../functions/src/booking'
import { birthdaysOn, firstName } from '../lib/birthdays'
import { Confetti } from '../tour/Fun'
import Avatar from './Avatar'

const seenKey = (day: string, who: string) => `pc.bday.${day}.${who}`
const seen = (k: string) => { try { return localStorage.getItem(k) === '1' } catch { return false } }
const markSeen = (k: string) => { try { localStorage.setItem(k, '1') } catch { /* private mode: it may show again */ } }

function Cake() {
  return (
    <svg viewBox="0 0 120 120" className="w-32 h-32 cap-bob" aria-hidden>
      {[38, 60, 82].map((x, i) => (
        <g key={x}>
          <rect x={x - 3} y="34" width="6" height="20" rx="2" fill={['#BF9DFF', '#F5F5F7', '#EBD399'][i]} />
          <path d={`M${x} 22 C ${x + 6} 30, ${x + 4} 34, ${x} 34 C ${x - 4} 34, ${x - 6} 30, ${x} 22 Z`} fill="#F2A33A" className="bday-flame" style={{ animationDelay: `${i * 120}ms` }} />
        </g>
      ))}
      <rect x="20" y="54" width="80" height="24" rx="6" fill="#C9A961" />
      <path d="M20 62 q10 8 20 0 t20 0 t20 0 t20 0" fill="none" stroke="#F5F5F7" strokeWidth="4" strokeLinecap="round" />
      <rect x="12" y="78" width="96" height="28" rx="7" fill="#EBD399" />
      <path d="M12 88 q12 8 24 0 t24 0 t24 0 t24 0" fill="none" stroke="#C9A961" strokeWidth="4" strokeLinecap="round" />
      <rect x="6" y="104" width="108" height="6" rx="3" fill="#2C2C2E" />
    </svg>
  )
}

export default function BirthdayParty() {
  const session = useSession()
  const profiles = useProfiles()
  const me = session.profile.email
  const today = todayInStudio()
  const people = Object.entries(profiles).map(([email, p]) => ({ email, birthday: p.birthday, name: p.name ?? '' }))
  const party = birthdaysOn(today, people)
  const mine = party.find(p => p.email === me)
  const others = party.filter(p => p.email !== me && !seen(seenKey(today, p.email)))
  const [ready, setReady] = useState(false)
  const [closed, setClosed] = useState(false)
  const [burst, setBurst] = useState(0)
  // Wait for the splash to finish; then a couple more bursts of confetti for the birthday person.
  useEffect(() => { const t = setTimeout(() => setReady(true), 2400); return () => clearTimeout(t) }, [])
  const showMine = !!mine && !seen(seenKey(today, me))
  useEffect(() => {
    if (!ready || closed || !showMine) return
    const t = setInterval(() => setBurst(b => b < 3 ? b + 1 : b), 1400)
    return () => clearInterval(t)
  }, [ready, closed, showMine])
  if (!ready || closed || session.viewingAs || session.previewingDemo) return null

  if (showMine) {
    const close = () => { markSeen(seenKey(today, me)); setClosed(true) }
    return (
      <div className="fixed inset-0 z-[70] bg-black/95 backdrop-blur-sm grid place-items-center p-6 fade-in" role="dialog" aria-label="Happy birthday">
        <div className="relative w-full max-w-sm text-center">
          <Confetti key={burst} count={40} />
          <div className="flex justify-center"><Cake /></div>
          <h2 className="font-display text-[34px] text-pt-text mt-4 chapter-rise">Happy birthday, {firstName(session.profile.name ?? '', me)}!</h2>
          <p className="text-pt-muted mt-2 chapter-rise" style={{ animationDelay: '120ms' }}>The whole Prime Capitol team is celebrating you today. Go make something great.</p>
          <button onClick={close} className="mt-6 w-full bg-pt-accent text-stone-900 font-semibold rounded-2xl min-h-[52px] shadow-gold">Thank you!</button>
        </div>
      </div>
    )
  }
  if (!others.length) return null
  const names = others.map(p => firstName(p.name, p.email))
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const close = () => { others.forEach(p => markSeen(seenKey(today, p.email))); setClosed(true) }
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center p-4 fade-in" onClick={close} role="dialog" aria-label="Birthday today">
      <div onClick={e => e.stopPropagation()} className="relative w-full max-w-sm bg-pt-surface rounded-[28px] shadow-float p-6 text-center sheet-up" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <Confetti count={28} />
        <div className="flex justify-center -space-x-3">
          {others.slice(0, 3).map(p => <span key={p.email} className="rounded-full ring-4 ring-pt-surface"><Avatar email={p.email} name={p.name} size={64} /></span>)}
        </div>
        <h2 className="font-display text-[26px] text-pt-text mt-4">It's {list}'s birthday today!</h2>
        <p className="text-pt-muted text-sm mt-1">Wish {names.length === 1 ? 'them' : 'them all'} a happy birthday when you see them.</p>
        <button onClick={close} className="mt-5 w-full bg-pt-accent text-stone-900 font-semibold rounded-2xl min-h-[48px] shadow-gold">Will do</button>
      </div>
    </div>
  )
}
