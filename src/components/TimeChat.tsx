// "Ask for a time": type or talk ("I'm filming with Kyle and Jana this week, evenings"). The AI
// reads it, the schedule finds real open slots, each with a Book button. Booking with friends
// books your slot and holds theirs for 20 minutes until they confirm.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { useActiveShoot } from '../activeShoot'
import { formatDay } from '../lib/dates'
import {
  askForTime, bookWithFriends, useMyInvites, useScheduleSettings, fmtSlot, errorText, INVITE_HOLD_MINUTES,
  type TimeAskResult,
} from '../services/schedule'
import { fmtTime } from '../../functions/src/gearBooking'

type Msg =
  | { who: 'me' | 'bot'; text: string }
  | { who: 'options'; options: TimeAskResult['options'] }
  | { who: 'booked'; inviteIds: string[]; shootId: string; label: string }

const STARTERS = ["I'm filming with a friend this week", '4 hours next week, evenings', 'Earliest free slot at Cliff 2']

// The phone's own speech recognition, when the browser has it (Safari and Chrome do).
const Speech = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null

export default function TimeChat({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { profile, user } = useSession()
  const s = useScheduleSettings()
  const { choose } = useActiveShoot()
  const invites = useMyInvites(profile.email)
  const first = (profile.name || user.displayName || '').split(' ')[0]
  const [msgs, setMsgs] = useState<Msg[]>([{ who: 'bot', text: `Hi${first ? ` ${first}` : ''}. When do you want to film, for how long, and with who? Type it, or tap the mic and just say it.` }])
  const [chips, setChips] = useState<string[]>(STARTERS)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [previous, setPrevious] = useState<Record<string, unknown> | undefined>()
  const end = useRef<HTMLDivElement>(null)
  const rec = useRef<any>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])
  const house = (p: string) => p === 'cliff2' ? s.houses.cliff2.name : s.houses.cliff1.name

  async function send(t = text) {
    const q = t.trim(); if (!q || busy) return
    setText(''); setChips([]); setMsgs(m => [...m, { who: 'me', text: q }]); setBusy(true)
    try {
      const r = (await askForTime({ text: q, ...(previous ? { previous } : {}) })).data
      setPrevious(r.ask)
      setMsgs(m => [...m, { who: 'bot', text: r.reply }, ...(r.options.length ? [{ who: 'options' as const, options: r.options }] : [])])
      setChips(r.friends.length ? ['Anything on the weekend?', `Only ${s.houses.cliff2.name}`, 'Just me, 2 hours'] : ['Anything earlier?', 'Evenings only', `Only ${s.houses.cliff1.name}`])
    } catch (e) { setMsgs(m => [...m, { who: 'bot', text: errorText(e) }]) } finally { setBusy(false) }
  }

  async function book(o: TimeAskResult['options'][number]) {
    setBusy(true)
    try {
      const friends = o.slots.filter(x => !x.me).map(x => x.email)
      const r = (await bookWithFriends({ place: o.place, date: o.date, start: o.start, friends, mySlots: o.slots.filter(x => x.me).length })).data
      const label = `${formatDay(o.date)} · ${house(o.place)} · ${fmtSlot(o.start, o.slots.length * s.slotMinutes)}`
      setMsgs(m => [...m,
        { who: 'bot', text: friends.length ? `Booked your slot. I've invited ${o.slots.filter(x => !x.me).map(x => x.name.split(' ')[0]).join(' and ')}: ${friends.length > 1 ? 'their slots are' : 'their slot is'} held for ${INVITE_HOLD_MINUTES} minutes for them to confirm.` : 'Booked. 🎬' },
        { who: 'booked', inviteIds: r.inviteIds, shootId: r.shootIds[0], label }])
      setChips([])
    } catch (e) { setMsgs(m => [...m, { who: 'bot', text: errorText(e) }]) } finally { setBusy(false) }
  }

  function talk() {
    if (!Speech) return
    if (listening) { rec.current?.stop(); return }
    const r = new Speech()
    r.lang = 'en-CA'; r.interimResults = true; r.maxAlternatives = 1
    r.onresult = (e: any) => {
      const said = Array.from(e.results as ArrayLike<any>).map((x: any) => x[0].transcript).join('')
      setText(said)
      if (e.results[e.results.length - 1].isFinal) { r.stop(); send(said) }
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    rec.current = r; setListening(true); r.start()
  }

  return (
    <div className="fixed inset-0 z-50 bg-pt-bg flex flex-col">
      <div className="pt-safe px-5 shrink-0">
        <div className="flex items-center justify-between py-3">
          <button onClick={onClose} className="text-pt-accent text-[17px]">‹ Back</button>
          <span className="rounded-full px-3 py-1 text-xs font-bold text-[#140f22] bg-gradient-to-r from-[#BF9DFF] to-[#8FB8FF]">✦ Finds real open slots</span>
        </div>
        <h1 className="font-display text-[28px] font-extrabold tracking-tight">Ask for a time</h1>
        <p className="text-pt-muted text-[13px]">Say when, how long and who with. Every time shown is actually free.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
        {msgs.map((m, i) => m.who === 'me' ? (
          <p key={i} className="ml-auto max-w-[86%] w-fit rounded-[20px] rounded-br-md px-3.5 py-2.5 text-[15px] text-stone-900 bg-gradient-to-b from-[#EBD399] to-pt-accent">{m.text}</p>
        ) : m.who === 'bot' ? (
          <p key={i} className="max-w-[86%] w-fit rounded-[20px] rounded-bl-md px-3.5 py-2.5 text-[15px] bg-[#BF9DFF]/10 border border-[#BF9DFF]/25">{m.text}</p>
        ) : m.who === 'options' ? (
          <div key={i} className="space-y-2">
            {m.options.map(o => (
              <div key={`${o.date}-${o.place}-${o.start}`} className="flex items-center gap-3 rounded-[18px] bg-pt-surface border border-pt-accent/40 px-3.5 py-3">
                <span className="w-12 text-center shrink-0"><span className="block text-[11px] uppercase text-pt-muted">{formatDay(o.date, { weekday: 'short' })}</span><b className="block font-display text-[22px] leading-none font-extrabold">{Number(o.date.slice(8))}</b></span>
                <span className="flex-1 min-w-0">
                  <b className="block">{house(o.place)} · {fmtSlot(o.start, o.slots.length * s.slotMinutes)}</b>
                  <span className="block text-pt-muted text-[13px]">{o.slots.map(x => `${x.me ? 'You' : x.name.split(' ')[0]} ${fmtTime(x.start)}`).join(' · ')}</span>
                </span>
                <button disabled={busy} onClick={() => book(o)} className="shrink-0 rounded-xl px-3.5 py-2 font-bold text-stone-900 bg-gradient-to-b from-[#EBD399] to-pt-accent disabled:opacity-40">Book</button>
              </div>
            ))}
          </div>
        ) : m.who === 'booked' ? (
          <div key={i} className="rounded-[18px] bg-pt-surface border border-pt-accent/40 p-3.5 space-y-2">
            <b className="block">{m.label}</b>
            <div className="flex items-center justify-between text-sm"><span>You</span><span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-green-500/15 text-green-400">Booked ✓</span></div>
            {m.inviteIds.map(id => {
              const inv = invites.outgoing.find(x => x.id === id)
              if (!inv) return null
              const expired = inv.status === 'pending' && inv.until <= new Date().toISOString().slice(0, 16)
              const [label, cls] = inv.status === 'accepted' ? ['Confirmed ✓', 'bg-green-500/15 text-green-400']
                : inv.status === 'pending' && !expired ? [`Held until ${fmtTime(Number(inv.until.slice(11, 13)) * 60 + Number(inv.until.slice(14, 16)))}`, 'bg-amber-400/15 text-amber-300']
                : ['Not confirmed', 'bg-pt-border text-pt-muted']
              return <div key={id} className="flex items-center justify-between text-sm"><span>{inv.toName} · {fmtTime(inv.start)}</span><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span></div>
            })}
            <button onClick={() => { choose(m.shootId); onClose(); navigate('/browse') }} className="w-full rounded-xl py-2.5 font-semibold bg-pt-border">Add props &amp; gear</button>
          </div>
        ) : null)}
        {busy && <p className="w-fit rounded-[20px] px-3.5 py-3 bg-pt-surface text-pt-muted text-sm animate-pulse">Looking at the schedule…</p>}
        <div ref={end} />
      </div>

      <div className="shrink-0 border-t border-pt-border px-5 pt-2.5 pb-safe bg-pt-bg">
        {chips.length > 0 && <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2.5">{chips.map(c => <button key={c} onClick={() => send(c)} className="shrink-0 rounded-full px-3 py-1.5 text-[13px] bg-pt-border">{c}</button>)}</div>}
        <div className="flex items-center gap-2 pb-2">
          <label htmlFor="timeAsk" className="sr-only">Message</label>
          <input id="timeAsk" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }}
            placeholder={listening ? 'Listening…' : Speech ? 'When do you want to film?' : 'Type, or use your keyboard\'s mic'}
            className="flex-1 min-w-0 bg-pt-surface border border-pt-border rounded-2xl px-4 py-3 text-base focus:outline-none focus:border-[#BF9DFF]" />
          {Speech && (
            <button onClick={talk} aria-label={listening ? 'Stop listening' : 'Talk'}
              className={`w-12 h-12 rounded-full grid place-items-center shrink-0 ${listening ? 'bg-red-500 text-white animate-pulse' : 'bg-[#BF9DFF]/20 text-[#BF9DFF]'}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
            </button>
          )}
          <button onClick={() => send()} disabled={!text.trim() || busy} aria-label="Send" className="w-12 h-12 rounded-full grid place-items-center shrink-0 bg-pt-accent text-stone-900 text-xl font-bold disabled:opacity-40">↑</button>
        </div>
      </div>
    </div>
  )
}
