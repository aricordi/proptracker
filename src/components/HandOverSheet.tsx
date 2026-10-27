// Hand gear over on the spot (owner, Oct 20): someone else needs it before it goes back to the cage.
// Pick who and until when; they open the app, tick every piece and sign (anything missing goes on your record).
import { useEffect, useMemo, useState } from 'react'
import BottomSheet from './BottomSheet'
import Avatar from './Avatar'
import UsedByPicker, { usedByOf } from './UsedByPicker'
import { handOverGear, nowStamp, fmtTime, GEAR_STEP, GEAR_DAY_END, type GearBooking } from '../services/gear'
import { listFilmingFriends } from '../services/schedule'
import { useSession } from '../auth'
import { friendlyError } from '../lib/errors'

const errText = (e: unknown) => friendlyError(e)

export default function HandOverSheet({ b, open, onClose }: { b: GearBooking; open: boolean; onClose: () => void }) {
  const { profile } = useSession()
  const [people, setPeople] = useState<{ email: string; name: string }[] | null>(null)
  const [q, setQ] = useState('')
  const [to, setTo] = useState<{ email: string; name: string } | null>(null)
  const [notUsing, setNotUsing] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => {
    if (!open || people) return
    listFilmingFriends({}).then(r => setPeople(r.data.people)).catch(() => setPeople([]))
  }, [open, people])

  // Until when: from the next half hour (at least 30 min away) to midnight.
  const times = useMemo(() => {
    const n = nowStamp(), mins = Number(n.slice(11, 13)) * 60 + Number(n.slice(14, 16))
    const out: number[] = []
    for (let t = Math.ceil((mins + GEAR_STEP) / GEAR_STEP) * GEAR_STEP; t <= GEAR_DAY_END; t += GEAR_STEP) out.push(t)
    return out
  }, [open])   // eslint-disable-line react-hooks/exhaustive-deps
  const [end, setEnd] = useState<number | null>(null)
  const until = end ?? times[Math.min(4, times.length - 1)] ?? null

  const onIt = new Set([b.creatorEmail, ...(b.crewEmails ?? []), profile.email])
  const matches = q.trim().length < 1 ? [] : (people ?? []).filter(p => !onIt.has(p.email) && p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
  const usedBy = usedByOf(b, notUsing)

  async function send() {
    if (!to || until === null) return
    setBusy(true); setErr('')
    try { await handOverGear({ id: b.id, toEmail: to.email, end: until, usedBy }); setDone(to.name) }
    catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const close = () => { setDone(null); setTo(null); setQ(''); setErr(''); onClose() }
  const field = 'w-full bg-pt-bg rounded-xl px-3 py-3 text-pt-text shadow-hairline focus:outline-none focus:ring-1 focus:ring-pt-accent'

  return (
    <BottomSheet open={open} onClose={close} title="Hand it over">
      {done ? (
        <div className="space-y-4 text-center py-2">
          <span className="mx-auto w-14 h-14 rounded-full bg-green-600 text-white grid place-items-center text-2xl">✓</span>
          <p className="text-pt-text text-lg font-semibold">Handed to {done.split(' ')[0]}</p>
          <p className="text-pt-muted text-[15px]">They got a notification. They open the gear in the app, tick every piece and sign. It's off your hands once you give it to them.</p>
          <button onClick={close} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Done</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-pt-muted text-[15px]">Someone needs it before it goes back to the cage? Give it to them here. No return photo: they tick every piece when they take it, so check the case together.</p>
          <div className="space-y-2">
            <p className="text-pt-text font-semibold">Who's taking it?</p>
            {to ? (
              <div className="flex items-center gap-3 bg-pt-bg rounded-xl px-3 py-2 shadow-hairline">
                <Avatar email={to.email} name={to.name} /><span className="flex-1 text-pt-text">{to.name}</span>
                <button onClick={() => setTo(null)} className="text-pt-muted text-sm tap">Change</button>
              </div>
            ) : (
              <>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Type their name" className={field} aria-label="Who's taking it" />
                {people === null && q && <p className="text-pt-muted text-sm">Loading…</p>}
                {matches.map(p => (
                  <button key={p.email} onClick={() => { setTo(p); setQ('') }} className="w-full flex items-center gap-3 bg-pt-bg rounded-xl px-3 py-2 text-left">
                    <Avatar email={p.email} name={p.name} /><span className="text-pt-text">{p.name}</span>
                  </button>
                ))}
                {people && q.trim() && matches.length === 0 && <p className="text-pt-muted text-sm">Nobody by that name.</p>}
              </>
            )}
          </div>
          <label className="block space-y-2">
            <span className="block text-pt-text font-semibold">Until when?</span>
            {times.length ? (
              <select value={until ?? ''} onChange={e => setEnd(Number(e.target.value))} className={field}>
                {times.map(t => <option key={t} value={t}>{t === GEAR_DAY_END ? 'Midnight' : fmtTime(t)}</option>)}
              </select>
            ) : <p className="text-pt-muted text-sm">It's too late today to hand it over. Return it instead.</p>}
            <span className="block text-pt-muted text-xs">Only if nobody else has it booked before then. They bring it back to the cage by that time.</span>
          </label>
          <UsedByPicker b={b} off={notUsing} onChange={setNotUsing} />
          {(b.crew?.length ?? 0) > 0 && <p className="text-amber-200 text-sm">Everyone on this shared gear stops having it once it's handed over.</p>}
          {err && <p className="text-red-300 text-sm bg-red-500/10 rounded-xl px-4 py-3">{err}</p>}
          <button disabled={!to || until === null || busy || usedBy?.length === 0} onClick={send}
            className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">
            {busy ? 'Handing over…' : to ? `Hand it to ${to.name.split(' ')[0]}` : 'Hand it over'}
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
