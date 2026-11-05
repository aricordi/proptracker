// "✦ Ask AI" on Analytics (owner + admins; owner, Nov 5: "allow the admins to have AI to query the analytics"). A small chat:
// type a question ("Who filmed the most this month?", "Who has the most no-shows?"), the AI answers from the same numbers
// Analytics shows (src/lib/analyticsPack.ts) and can offer "Open it" = the Analytics page with the details. It can't change
// anything. When the AI is off or the budget is spent, the answer is the plain numbers.
import { useMemo, useRef, useState, useEffect } from 'react'
import BottomSheet from '../BottomSheet'
import RichText from '../RichText'
import { askAnalytics, type AnalyticsAnswer } from '../../services/ai'
import { buildPack, drillUrl, type PackInput, type Drill } from '../../lib/analyticsPack'
import { friendlyError } from '../../lib/errors'

const STARTERS = ['Who filmed the most this month?', 'Who is posting less than usual?', 'Who has the most no-shows lately?',
  'Which creators keep returning things late?', 'How fast is the arts team packing?', 'Who should I check in with this week?']

interface Turn { q: string; a?: AnalyticsAnswer; error?: string }

export default function AskAnalytics({ open, onClose, input, onOpenPage }: {
  open: boolean; onClose: () => void; input: PackInput; onOpenPage: (url: string) => void
}) {
  const { pack, idToEmail } = useMemo(() => buildPack(input), [input])
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [turns, busy])

  const ask = async (q: string) => {
    q = q.trim()
    if (q.length < 3 || busy) return
    setText(''); setBusy(true)
    const history = turns.filter(t => t.a).slice(-3).map(t => ({ q: t.q, a: t.a!.answer }))
    setTurns(ts => [...ts, { q }])
    try {
      const r = await askAnalytics({ question: q, pack, history })
      setTurns(ts => ts.map((t, i) => i === ts.length - 1 ? { ...t, a: r.data } : t))
    } catch (e) {
      setTurns(ts => ts.map((t, i) => i === ts.length - 1 ? { ...t, error: friendlyError(e) } : t))
    } finally { setBusy(false) }
  }
  const last = turns[turns.length - 1]

  return (
    <BottomSheet open={open} onClose={onClose} title="Ask AI about your creators">
      <div className="flex flex-col gap-3 pb-2 min-h-[50vh]">
        {turns.length === 0 && <>
          <p className="text-pt-muted text-sm">Ask anything about who's filming, flags, late returns or the teams. Answers come from the
            same numbers as Analytics (the last 6 months), and you can open the page with the details.</p>
          <div className="flex flex-col gap-2">
            {STARTERS.map(s => (
              <button key={s} onClick={() => ask(s)} className="text-left min-h-[44px] px-4 py-2.5 rounded-2xl bg-[#BF9DFF]/10 text-pt-text text-[15px] active:opacity-80">
                <span className="text-[#BF9DFF] mr-2">✦</span>{s}</button>
            ))}
          </div>
        </>}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-auto max-w-[85%] w-fit rounded-2xl rounded-br-md bg-pt-accent text-stone-900 px-4 py-2.5 text-[15px]">{t.q}</p>
            {t.a && (
              <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-white/[0.07] px-4 py-3 text-pt-text text-[15px] leading-relaxed space-y-3">
                <RichText text={t.a.answer} />
                {drillUrl(t.a.open as Drill, idToEmail) && (
                  <button onClick={() => onOpenPage(drillUrl(t.a!.open as Drill, idToEmail)!)}
                    className="min-h-[44px] px-4 rounded-full bg-pt-accent/15 text-pt-accent text-sm font-semibold">See the details ›</button>
                )}
              </div>
            )}
            {t.error && <p className="max-w-[92%] rounded-2xl bg-red-500/10 text-red-200 px-4 py-3 text-sm">{t.error}</p>}
          </div>
        ))}
        {busy && <p className="text-pt-muted text-sm flex items-center gap-2"><span className="text-[#BF9DFF]">✦</span>Looking at the numbers…</p>}
        {!busy && last?.a && last.a.chips.length > 0 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {last.a.chips.map(c => <button key={c} onClick={() => ask(c)} className="shrink-0 min-h-[40px] inline-flex items-center px-3 rounded-full bg-pt-surface shadow-hairline text-pt-text text-sm">{c}</button>)}
          </div>
        )}
        <div ref={end} />
        <form onSubmit={e => { e.preventDefault(); void ask(text) }} className="sticky bottom-0 bg-pt-raised pt-2 flex items-center gap-2">
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Ask about creators, flags, teams…" maxLength={400}
            aria-label="Your question" className="flex-1 min-h-[48px] rounded-full bg-pt-surface shadow-hairline px-4 text-pt-text text-[16px] outline-none" />
          <button type="submit" disabled={busy || text.trim().length < 3} aria-label="Ask"
            className="w-12 h-12 rounded-full bg-[#BF9DFF] text-[#140f22] font-bold text-lg disabled:opacity-40">↑</button>
        </form>
        {turns.length > 0 && <button onClick={() => setTurns([])} className="self-center text-pt-muted text-sm tap">New question</button>}
      </div>
    </BottomSheet>
  )
}
