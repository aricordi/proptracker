// "How the monthly draw works" (owner, Nov 2: "explained and clear… so we never forget how it works and can answer
// questions"). ONE explanation, used on the creator wishlist, the team's Monthly draw page, Schedule settings and the
// Rules sheet, so the wording never drifts. Numbers come from the live settings and the draw's own constants.
import { useState, type ReactNode } from 'react'
import { useScheduleSettings } from '../services/schedule'
import { WISHLIST_OPEN_DAY, DRAW_DAY, DRAW_MINUTE, MAX_WISHES } from '../services/draw'
import { fmtTime } from '../../functions/src/gearBooking'

const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
export const nth = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
const list = (a: string[]) => a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`

export function useDrawFacts() {
  const s = useScheduleSettings()
  return {
    n: s.monthlySlots, c1: s.houses.cliff1.name,
    opens: nth(WISHLIST_OPEN_DAY), closes: nth(DRAW_DAY), time: fmtTime(DRAW_MINUTE), max: MAX_WISHES,
    prio: list(s.priorityWeekdays.map(d => DAY_NAMES[d])), notice: s.noticeHours,
  }
}

function Step({ n, title, children }: { n: number; title: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-7 h-7 rounded-full bg-pt-accent/15 text-pt-accent text-sm font-semibold flex items-center justify-center">{n}</span>
      <div className="min-w-0"><p className="text-pt-text font-medium">{title}</p><p className="text-pt-muted text-sm mt-0.5">{children}</p></div>
    </li>
  )
}

// The 6 steps everyone should know. `team` adds who's in + the owner's buttons.
export function DrawSteps({ team = false }: { team?: boolean }) {
  const f = useDrawFacts()
  return (
    <ol className="space-y-4">
      <Step n={1} title={`Wishlist opens on the ${f.opens}`}>Everyone gets a notification. Pick up to {f.max} {f.c1} slots for next month and put your favourite first. Change it as often as you like until the {f.closes} at {f.time}. <b className="text-pt-text">It's not a race</b>: wishing on the {f.opens} or the {f.closes} makes no difference.</Step>
      <Step n={2} title="Filming with a friend? Both wish for it">Pick the friend on a wish, and they pick you on the slot right before or after (same day). You're placed back to back only when <b className="text-pt-text">both</b> of you asked for it.</Step>
      <Step n={3} title={`The draw runs by itself on the ${f.closes} at ${f.time}`}>A reminder goes out at noon. Nobody has to press anything.</Step>
      <Step n={4} title={`${f.n} rounds, one slot each per round`}>Everyone gets one slot per round. The turn order is random, and it <b className="text-pt-text">flips every round</b> (last becomes first), so nobody is always first. On your turn you get your best wish that's still free.</Step>
      <Step n={5} title="Always spread out">Never two of your slots on the same day or on days next to each other. Wishes left over, or no wishes at all? The app picks for you: about one a week, on the days and times you usually film.</Step>
      <Step n={6} title="Your slots arrive">A notification, then they're on the schedule and in My shoots like any other shoot. Move, swap or cancel them the normal way (free with {f.notice} hours' notice). Free slots left over can be booked by anyone.</Step>
      {team && <>
        <Step n={7} title="Who's in the draw">Every active creator (Props only ones too) and the owner. Admins, arts and the equipment team aren't. {f.prio ? <>{f.prio} at {f.c1} only go to people in the priority group.</> : null}</Step>
        <Step n={8} title="The owner's buttons">Run the draw now (before the {f.closes}, if needed) and Undo it until the month starts. Undo keeps any shoot that already has props or gear. Running it again with the same wishes gives the same result.</Step>
      </>}
    </ol>
  )
}

// Questions people ask, with the answers (shown folded).
export function DrawFaq({ team = false }: { team?: boolean }) {
  const f = useDrawFacts()
  const qs: [string, ReactNode][] = [
    ['Why didn\'t I get my first wish?', 'Someone whose turn came before yours that round wished for it too. Your result shows which wish each slot came from ("Wish #3"). Next month the order is different.'],
    ['Does saving my wishlist early help?', `No. Every wish saved before the ${f.closes} at ${f.time} counts the same.`],
    ['I forgot to make a wishlist', `You still get your ${f.n} slots. The app picks them from the days and times you usually film, spread through the month.`],
    ['Can I get two slots in a row, or on back-to-back days?', 'Not from the draw. It always leaves at least one day in between. You can book extra slots on the schedule any time they\'re free.'],
    ['Do Cliff 2 or offsite shoots count?', `No. The draw is only for ${f.c1}. Everything else is booked on the schedule as usual.`],
    ['I can\'t make one of my slots', `Move it, swap it with someone, or cancel it from the shoot. With less than ${f.notice} hours' notice only a swap avoids a no-show.`],
    ...(team ? [
      ['Someone got fewer slots than everyone else', `${f.c1} ran out of spread-out free slots for them (holidays, blocks, priority days). The result lists who's short; book their extras by hand.`],
      ['Someone joined after the draw', 'They aren\'t in this month\'s draw. Book their slots by hand with "Book for", or they book extras. They\'re in next month\'s draw automatically.'],
      ['The draw went wrong (wrong settings, blocks missing)', 'The owner taps Undo this draw (before the month starts), fixes things, then Run the draw now.'],
    ] as [string, ReactNode][] : []),
  ]
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="divide-y divide-white/[0.06]">
      {qs.map(([q, a], i) => (
        <div key={q}>
          <button onClick={() => setOpen(open === i ? null : i)} className="w-full text-left py-3 flex items-center gap-2">
            <span className="flex-1 text-pt-text text-sm font-medium">{q}</span><span className="text-pt-muted">{open === i ? '−' : '+'}</span>
          </button>
          {open === i && <p className="text-pt-muted text-sm pb-3">{a}</p>}
        </div>
      ))}
    </div>
  )
}

// Folded card: "How the draw works" (+ the questions). Starts open when `open`.
export function DrawExplainer({ team = false, open: startOpen = false }: { team?: boolean; open?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <section className="bg-pt-surface shadow-hairline rounded-2xl p-4">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left">
        <h2 className="text-pt-text font-semibold">How the draw works</h2>
        <span className="text-pt-accent text-sm">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <div className="mt-4 space-y-5">
        <DrawSteps team={team} />
        <div><h3 className="text-pt-text font-semibold mb-1">Questions people ask</h3><DrawFaq team={team} /></div>
      </div>}
    </section>
  )
}
