// The practice copy of the studio for OpenAI's app reviewers (owner, Nov 24: "we would have to build that in the thing for
// reviewers"). The demo account sees the REAL props closet (company props only) and the real house hours and rules, but:
//   • other people's bookings show as "Another creator" (no real names),
//   • its own shoots, props requests, invites, swaps and waitlist live in ONE document per connection, mcp_sandbox/{clientId},
//   • every change is checked with the same rules as the app (times, 2 h per person, free time, props notice and stock)
//     and then saved only there: nothing reaches the studio team, the schedule, notifications or Google Calendar.
// Each new reviewer connection resets it to the same sample data (resetSandbox).
import { db } from '../auth.js'
import { Timestamp } from 'firebase-admin/firestore'
import { todayInStudio, addDays, isDay, weekday, shootStartStamp, propsDeadline, lastDayToBook } from '../booking.js'
import { nowStamp } from '../gearBooking.js'
import {
  HOUSES, SCHEDULE_MESSAGES, freeGaps, checkTimes, conflictAt, maxMinutesFor, hardBlocks, priorityLocked, needsGuideline, TIME_STEP,
  type House, type ScheduleDay, type SlotEntry,
} from '../schedule.js'
import { loadScheduleSettings } from '../scheduling.js'
import { loadSettings } from '../reservations.js'
import { s, objs, clampInt, hm, houseNight, parseClock, loadCloset, freeOn, personId, askWho, REVIEWER_EMAIL, type Json, type McpUser, type ToolResult } from './common.js'
import { resolvePerson, resolveWhen } from './understand.js'
import { suggestNext } from './casual.js'
import { CUSTOM_NOTE } from './custom.js'

const demoMatch = (said: string) => resolvePerson(DEMO_PEOPLE, said, REVIEWER_EMAIL, (p, id) => personId(p.email) === id)

// One practice copy per reviewer connection (two reviewers testing at once don't overwrite each other).
const sandboxRef = (key: string) => db.doc(`mcp_sandbox/${String(key || 'default').replace(/[^\w-]/g, '').slice(0, 60) || 'default'}`)
const APP_URL = 'https://proptracker.arbcreative.co'
const NOTE = ' (Demo account: this is a practice copy, so nothing is sent to the studio team.)'
const PLACE: Record<string, string> = { cliff1: 'Cliff 1', cliff2: 'Cliff 2', offsite: 'Offsite' }
export const DEMO_PEOPLE = [
  { name: 'Jordan Lee', email: 'jordan@demo.primecapitol.app' }, { name: 'Sam Rivera', email: 'sam@demo.primecapitol.app' },
  { name: 'Kai Morgan', email: 'kai@demo.primecapitol.app' }, { name: 'Riley Chen', email: 'riley@demo.primecapitol.app' },
]
interface SShoot { id: string; place: string; date: string; start: number; end: number; status: string; with: string[]; where?: string }
interface SReq { id: string; shootId: string; title: string; status: string; date: string; lines: { itemId: string; itemName: string; qty: number }[]; builds: { description: string; qty: number }[] }
interface Sandbox { shoots: SShoot[]; requests: SReq[]; invites: Json[]; swaps: Json[]; waitlist: Json[]; n: number }

const plainDay = (from: number) => { let d = addDays(todayInStudio(), from); while ([0, 4, 6].includes(weekday(d))) d = addDays(d, 1); return d }

export async function resetSandbox(key = 'default') {
  const props = (await loadCloset()).filter(p => !p.damaged && p.quantity - p.missing > 0).slice(0, 2)
  const d1 = plainDay(3), d2 = plainDay(5), d3 = plainDay(7)
  const sb: Sandbox = {
    n: 10,
    shoots: [{ id: 'demo-shoot-1', place: 'cliff2', date: d1, start: 14 * 60, end: 16 * 60, status: 'booked', with: [] }],
    requests: props.length ? [{ id: 'demo-props-1', shootId: 'demo-shoot-1', title: 'Haunted diner sketch', status: 'requested', date: d1,
      lines: props.map(p => ({ itemId: p.id, itemName: p.name, qty: 1 })), builds: [] },
      // A second one packed & ready, so reviewers can try signing for props and returning them with a photo.
      { id: 'demo-props-2', shootId: 'demo-shoot-1', title: 'Ring Ring', status: 'packed', date: d1, lines: props.slice(0, 1).map(p => ({ itemId: p.id, itemName: p.name, qty: 1 })), builds: [] }] : [],
    invites: [{ id: 'demo-invite-1', host: 'Jordan', date: d2, start: 13 * 60, end: 15 * 60, place: 'Cliff 1', status: 'pending' }],
    swaps: [{ id: 'demo-swap-1', from: 'Sam', mine: 'demo-shoot-1', theirs: { date: d3, place: 'cliff2', start: 10 * 60, end: 12 * 60 }, status: 'pending' }],
    waitlist: [],
  }
  await sandboxRef(key).set({ ...sb, resetAt: new Date().toISOString(), ttl: Timestamp.fromMillis(Date.now() + 14 * 86400_000) })
}
async function load(key: string): Promise<Sandbox> {
  const d = (await sandboxRef(key).get()).data() as Sandbox | undefined
  if (d?.shoots) return d
  await resetSandbox(key)
  return (await sandboxRef(key).get()).data() as Sandbox
}
/** The practice copy as the understanding layer needs it (lenient.ts: "my saturday shoot", "Jordan's invite"…). */
export async function sandboxContext(key: string) {
  const sb = await load(key)
  return {
    shoots: sb.shoots.filter(x => ['booked', 'requested'].includes(x.status)).map(x => ({ id: x.id, place: x.place, date: x.date, start: x.start, end: x.end, status: x.status, with: x.with,
      titles: sb.requests.filter(r => r.shootId === x.id).map(r => r.title) })),
    requests: sb.requests.map(r => ({ id: r.id, date: r.date, title: r.title, status: r.status, items: r.lines.map(l => `${l.itemName} x${l.qty}`) })),
    invites: sb.invites.filter(i => i.status === 'pending').map(i => ({ id: String(i.id), who: String(i.host ?? ''), date: String(i.date ?? '') })),
    swaps: sb.swaps.filter(x => x.status === 'pending').map(x => ({ id: String(x.id), who: String(x.from ?? ''), date: String((x.theirs as Json | undefined)?.date ?? '') })),
    waitlist: sb.waitlist.map(w => ({ id: String(w.id), who: String(w.place ?? ''), date: String(w.day ?? w.date ?? '') })),
    out: [] as { id: string; who: string; date: string; kind: 'props' | 'gear' }[],
  }
}
const nextId = (sb: Sandbox, kind: string) => `demo-${kind}-${++sb.n}`

// Real day + the demo account's own shoots on top, every real name hidden.
function maskDay(day: ScheduleDay | undefined, date: string, sb: Sandbox): ScheduleDay {
  const out: Record<string, unknown> = { date, blocks: day?.blocks ?? [], offsite: (day?.offsite ?? []).map(o => ({ ...o, name: 'Another creator', email: '' })) }
  for (const h of HOUSES) {
    const m: Record<string, SlotEntry> = {}
    for (const [k, e] of Object.entries((day?.[h] ?? {}) as Record<string, SlotEntry>)) if (e) m[k] = { ...e, name: 'Another creator', email: '', withNames: [], people: [] }
    for (const x of sb.shoots.filter(y => y.date === date && y.place === h && ['booked', 'requested'].includes(y.status))) {
      m[String(x.start)] = { shootId: x.id, name: 'You', kind: 'extra', email: REVIEWER_EMAIL, time: { start: x.start, end: x.end }, ...(x.status === 'requested' ? { pending: true } : {}) }
    }
    out[h] = m
  }
  return out as unknown as ScheduleDay
}
async function days(dates: string[], sb: Sandbox) {
  const snaps = dates.length ? await db.getAll(...dates.map(d => db.doc(`schedule_days/${d}`))) : []
  return Object.fromEntries(dates.map((d, i) => [d, maskDay(snaps[i]?.data() as ScheduleDay | undefined, d, sb)]))
}
const shootRow = (x: SShoot, sb: Sandbox) => ({ id: x.id, place: x.place, day: x.date, start: hm(x.start), end: hm(x.end), with: x.with,
  status: x.status === 'booked' ? 'approved' : x.status === 'requested' ? 'waiting for approval' : x.status,
  props_requests: sb.requests.filter(r => r.shootId === x.id && r.status !== 'cancelled').map(r => ({ id: r.id, title: r.title, status: r.status })) })

const REVIEWER_TOOLS = new Set(['whoami', 'get_schedule', 'find_free_times', 'plan_shoot', 'list_people', 'my_shoots', 'my_props_requests', 'my_status', 'get_shoot',
  'book_shoot', 'move_shoot', 'cancel_shoot', 'request_props', 'change_props_request', 'cancel_props_request', 'join_waitlist', 'leave_waitlist',
  'invite_to_video', 'answer_video_invite', 'request_swap', 'answer_swap', 'report_problem', 'pick_up_props', 'return_props'])

/** null = not a sandbox tool (the closet tools, rules and app links run as normal: they only read company props and rules). */
export async function runReviewerTool(name: string, a: Json, u: McpUser): Promise<ToolResult | null> {
  if (!REVIEWER_TOOLS.has(name)) return null
  const key = u.sandboxKey ?? 'default'
  const sb = await load(key)
  const save = (x: Sandbox) => sandboxRef(key).set(x, { merge: true })
  const sch = await loadScheduleSettings()
  const now = nowStamp(), today = todayInStudio()
  switch (name) {
    case 'whoami': return { text: `${u.name}: the demo account for app review (a creator in a practice copy of the studio). Real props; made-up people and bookings.`, structured: { name: u.name, role: 'creator', can_book: true, demo_account: true } }
    case 'list_people': {
      const q = s(a.search, 60).toLowerCase()
      const people = DEMO_PEOPLE.filter(p => !q || p.name.toLowerCase().includes(q))
      return { text: people.map(p => `${p.name} (${personId(p.email)})`).join('\n') || 'Nobody by that name.', structured: { people: people.map(p => ({ name: p.name, person_id: personId(p.email), on_app: true })) } }
    }
    case 'get_schedule': {
      const from = isDay(a.from) && String(a.from) >= today ? String(a.from) : today
      const n = clampInt(a.days, 1, 21, 7)
      const dates = Array.from({ length: n }, (_, i) => addDays(from, i))
      const ds = await days(dates, sb)
      const out = dates.map(date => ({ date, houses: Object.fromEntries(HOUSES.map(h => [h, {
        bookings: Object.values((ds[date][h] ?? {}) as Record<string, SlotEntry>).map(e => ({ start: hm(e.time?.start ?? 0), end: hm(e.time?.end ?? 0), who: e.name === 'You' ? 'you' : 'another creator', status: e.pending ? 'waiting for approval' : 'booked' })),
        blocked: hardBlocks(ds[date]).filter(b => b.house === h).map(b => ({ start: hm(b.start), end: hm(b.end) })),
        free: priorityLocked(date, h, sch, REVIEWER_EMAIL, now) ? [] : freeGaps(ds[date], date, h, sch, now).map(g => ({ start: hm(g.start), end: hm(g.end) })),
      }])) }))
      return { text: out.map(d => `${d.date}: ` + HOUSES.map(h => `${PLACE[h]} free ${(d.houses[h] as { free: Json[] }).free.map(f => `${f.start}-${f.end}`).join(', ') || 'none'}`).join(' · ')).join('\n'), structured: { days: out, demo_account: true } }
    }
    case 'find_free_times': {
      const from = isDay(a.from) && String(a.from) >= today ? String(a.from) : today
      const n = clampInt(a.days, 1, 21, 7)
      const people = Math.min(5, Math.max(1, Number.isInteger(a.people) ? Number(a.people) : 1))
      const need = Math.round(Math.min(12, Math.max(0.5, Number(a.hours) || 2)) * 60 / TIME_STEP) * TIME_STEP
      if (need > maxMinutesFor(people, sch)) return { text: `${need / 60} hours needs ${Math.ceil(need / sch.slotMinutes) - people} more people on the booking (2 hours each).` }
      const dates = Array.from({ length: n }, (_, i) => addDays(from, i))
      const ds = await days(dates, sb)
      const houses = (Array.isArray(a.houses) && a.houses.length ? a.houses : HOUSES).filter((h): h is House => HOUSES.includes(h as House))
      const tod = s(a.time_of_day, 10) || 'any', around = parseClock(a.around)
      const inTod = (m: number) => tod === 'any' || (tod === 'morning' ? m < 720 : tod === 'afternoon' ? m >= 720 && m < 1020 : tod === 'evening' ? m >= 1020 && m < 1260 : m >= 1260)
      const options: (Json & { _s: number })[] = []
      for (const date of dates) {
        if (sb.shoots.some(x => x.date === date && x.place !== 'offsite' && ['booked', 'requested'].includes(x.status))) continue   // one a day
        for (const h of houses) {
          if (priorityLocked(date, h, sch, REVIEWER_EMAIL, now)) continue
          for (const g of freeGaps(ds[date], date, h, sch, now, need)) {
            const starts = new Set<number>([g.start, g.end - need])
            if (around != null) starts.add(Math.min(Math.max(around, g.start), g.end - need))
            for (const at of [720, 1020, 1260]) if (at > g.start && at + need <= g.end) starts.add(at)
            if (needsGuideline(date, h, REVIEWER_EMAIL, sch)) continue   // booked in the app (PDF), like the real tool
            for (const st of starts) if (st % TIME_STEP === 0 && st >= g.start && st + need <= g.end && inTod(st))
              options.push({ day: date, place: h, house: PLACE[h], start: hm(st), end: hm(st + need), free_stretch: `${hm(g.start)}–${hm(g.end)}`, _s: st })
          }
        }
      }
      options.sort((x, y) => around != null ? Math.abs(x._s - around) - Math.abs(y._s - around) || String(x.day).localeCompare(String(y.day)) : String(x.day).localeCompare(String(y.day)) || x._s - y._s)
      const top = options.slice(0, clampInt(a.limit, 1, 30, 12)).map(({ _s, ...o }) => o)   // eslint-disable-line @typescript-eslint/no-unused-vars
      return { text: top.map(o => `${o.day} ${o.house} ${o.start}–${o.end}`).join('\n') || 'Nothing free that fits.', structured: { length_hours: need / 60, people, options: top } }
    }
    case 'plan_shoot': {
      // Same reading as the real plan_shoot (names, nicknames, typos asked about; 2 h per person; "tomorrow" etc.), demo people.
      const said = (Array.isArray(a.with) ? a.with : []).map(v => s(v, 80)).filter(Boolean).slice(0, 4)
      const resolved: Json[] = [], questions: string[] = []
      for (const n of said) {
        const m = demoMatch(n)
        if (m.status === 'one') resolved.push({ said: n, status: 'found', name: m.hits[0].name, person_id: personId(m.hits[0].email) })
        else {
          resolved.push({ said: n, status: m.status === 'none' ? 'not_found' : m.status === 'many' ? 'which_one' : 'did_you_mean', candidates: m.hits.map(h => ({ name: h.name, person_id: personId(h.email) })) })
          questions.push(m.status === 'none' ? `Is "${n}" someone who isn't on the app yet? (Then book_shoot can add them by name with not_on_app.)` : askWho(n, m)!)
        }
      }
      const total = 1 + said.length
      const hrs = Number(a.hours) > 0 ? Math.min(Number(a.hours), maxMinutesFor(total, sch) / 60) : Math.min(maxMinutesFor(total, sch), 5 * sch.slotMinutes) / 60
      let from = today, n = 7, label = 'the next 7 days'
      if (isDay(a.day) && String(a.day) >= today) { from = String(a.day); n = 1; label = from }
      else { const w = resolveWhen(s(a.when, 80), today); if (w) { from = w.days[0] < today ? today : w.days[0]; n = w.days.length; label = w.label } }
      const at = parseClock(a.at)
      const free = await runReviewerTool('find_free_times', { from, days: n, hours: hrs, people: total, houses: a.houses, time_of_day: at != null ? 'any' : a.time_of_day, ...(at != null ? { around: hm(at) } : {}), limit: clampInt(a.limit, 1, 12, 6) }, u)
      const options = ((free?.structured?.options ?? []) as Json[])
      const found = resolved.filter(r => r.status === 'found').map(r => r.name)
      return { text: [`Plan: you${found.length ? ` + ${found.join(' + ')}` : ''}, ${hrs} h, ${label}.`, ...(questions.length ? ['Ask first:', ...questions.map(q => `- ${q}`)] : []),
        options.length ? `Times that fit everyone:\n${options.map(o => `${o.day} ${o.house} ${o.start}–${o.end}`).join('\n')}` : `Nothing free ${label}.`].join('\n'),
        structured: { people: resolved, everyone: total, length_hours: hrs, when: label, questions, options, demo_account: true } }
    }
    case 'my_shoots': {
      const rows = sb.shoots.filter(x => x.status !== 'cancelled' && x.date >= addDays(today, -14)).sort((x, y) => `${x.date}${x.start}`.localeCompare(`${y.date}${y.start}`)).map(x => shootRow(x, sb))
      return { text: rows.map(r => `${r.id} | ${r.day} ${r.start}-${r.end} | ${r.place} | ${r.status}`).join('\n') || 'No shoots booked.', structured: { shoots: rows } }
    }
    case 'my_props_requests': {
      const rows = sb.requests.map(r => ({ id: r.id, video: r.title, day: r.date, status: r.status, items: r.lines.map(l => `${l.itemName} x${l.qty}`) }))
      return { text: rows.map(r => `${r.id} | ${r.day} | "${r.video}" | ${r.status} | ${r.items.join(', ')}`).join('\n') || 'No props requests.', structured: { requests: rows } }
    }
    case 'my_status': {
      const next = sb.shoots.filter(x => ['booked', 'requested'].includes(x.status) && x.date >= today).sort((x, y) => `${x.date}${x.start}`.localeCompare(`${y.date}${y.start}`))[0]
      const data = { today, next_shoot: next ? { ...shootRow(next, sb), props_deadline: propsDeadline(shootStartStamp(next.date, next.start), 48).replace('T', ' ') } : null,
        props_requests_open: sb.requests.filter(r => r.status === 'requested').map(r => ({ id: r.id, video: r.title, day: r.date, status: r.status })),
        video_invites_waiting: sb.invites.filter(i => i.status === 'pending'), swap_requests_for_you: sb.swaps.filter(x => x.status === 'pending'),
        waitlist: sb.waitlist, props_to_bring_back: [], gear_to_bring_back: [], strikes: 0, paused_until: null, demo_account: true }
      const dl = next ? propsDeadline(shootStartStamp(next.date, next.start), 48) : ''
      const suggestions = suggestNext({ today, upcoming: sb.shoots.filter(x => ['booked', 'requested'].includes(x.status) && x.date >= today).length, pausedUntil: null,
        next: next ? { day: next.date, label: `${next.date} ${PLACE[next.place]}`, status: next.status, hasProps: sb.requests.some(r => r.shootId === next.id && r.status !== 'cancelled'),
          propsOpen: now <= dl, propsDeadline: dl.replace('T', ' '), withPeople: next.with.length } : null,
        invites: data.video_invites_waiting.map(i => String(i.host)), swaps: data.swap_requests_for_you.map(x => String(x.from)), toReturn: [], gearOut: [], waitlistOffered: 0 })
      return { text: `${next ? `Next shoot: ${next.date} ${hm(next.start)}–${hm(next.end)} ${PLACE[next.place]} (${data.next_shoot!.status}).` : 'No shoots coming up.'} ${data.video_invites_waiting.length} video invite(s) and ${data.swap_requests_for_you.length} swap request(s) waiting.${suggestions.length ? `\nWorth doing next:\n${suggestions.map(x => `- ${x.do} (${x.why})`).join('\n')}` : ''}`, structured: { ...data, suggestions } }
    }
    case 'get_shoot': {
      const x = sb.shoots.find(y => y.id === s(a.shoot_id, 100))
      if (!x) return { text: 'That isn\'t one of your shoots (my_shoots has the ids).' }
      const b = await loadSettings()
      const start = shootStartStamp(x.date, x.start)
      const data = { ...shootRow(x, sb), place: PLACE[x.place] ?? x.place, collaborators: x.with.map(n => ({ name: n, on_app: true })), in_the_video: [],
        props_requests: sb.requests.filter(r => r.shootId === x.id && r.status !== 'cancelled').map(r => ({ id: r.id, video: r.title, status: r.status, items: r.lines.map(l => `${l.itemName} x${l.qty}`), custom: r.builds.map(b2 => b2.description) })),
        props_deadline: propsDeadline(start, b.leadTimeHours ?? 48).replace('T', ' '), props_still_open: now <= propsDeadline(start, b.leadTimeHours ?? 48),
        custom_props_deadline: lastDayToBook(x.date, b.buildLeadDays ?? 4, b), app_link: `${APP_URL}/schedule`, demo_account: true }
      return { text: `${data.place} ${x.date} ${hm(x.start)}–${hm(x.end)}, ${data.status}. Props: ${data.props_requests.map(r => `"${r.video}" ${r.items.join(', ')}`).join(' | ') || 'none yet'}.`, structured: data }
    }
    case 'book_shoot': {
      const place = s(a.place, 10), date = s(a.day, 10)
      const s0 = parseClock(a.start), end0 = parseClock(a.end)
      const start = s0 == null ? null : s(a.place, 10) === 'offsite' ? s0 : houseNight(s0)
      if (start == null || end0 == null) return { text: 'Give the place, day (YYYY-MM-DD) and start/end (HH:MM).' }
      const end = end0 <= start ? end0 + 1440 : end0
      const said = (Array.isArray(a.with) ? a.with : []).map(x => s(x, 80)).filter(Boolean).slice(0, 4)
      const offApp = new Set((Array.isArray(a.not_on_app) ? a.not_on_app : []).map(x => s(x, 80).toLowerCase()))
      const withNames: string[] = []
      for (const n of said) {
        const m = demoMatch(n)
        if (m.status === 'one') withNames.push(m.hits[0].name)
        else if (m.status === 'none' && offApp.has(n.toLowerCase()) && !n.includes('@')) withNames.push(n)
        else return { text: `${askWho(n, m)}${m.status === 'none' ? ` If ${n} isn't on the app yet, confirm that and pass the name in \`not_on_app\` too.` : ''}` }
      }
      const bad = checkTimes(place, date, start, end, sch, today, now)
      if (bad) return { text: SCHEDULE_MESSAGES[bad] }
      if (place !== 'offsite') {
        if (end - start > maxMinutesFor(1 + withNames.length, sch)) return { text: `Each person on a booking gets up to ${sch.slotMinutes / 60} hours: add ${Math.ceil((end - start) / sch.slotMinutes) - 1 - withNames.length} more collaborator(s) in \`with\`, or shorten it.` }
        if (priorityLocked(date, place as House, sch, REVIEWER_EMAIL, now)) return { text: 'That\'s a priority day at Cliff 1, locked until the Sunday release. Try Cliff 2 or another day.' }
        if (needsGuideline(date, place as House, REVIEWER_EMAIL, sch)) return { text: `Cliff 1 on ${date} is a priority day: booking it needs the filming guideline PDF, which is attached in the app. Book this one in the app (${APP_URL}/schedule), or pick Cliff 2 or another day here.${NOTE}`, structured: { needs_guideline_in_app: true, app_link: `${APP_URL}/schedule` } }
        if (sb.shoots.some(x => x.date === date && x.place !== 'offsite' && ['booked', 'requested'].includes(x.status))) return { text: 'You already have a house booking that day (one a day each).' }
        const ds = await days([date], sb)
        const c = conflictAt(ds[date], place as House, start, end, sch, now)
        if (c) return { text: c.t === 'block' ? 'That time is blocked at the house.' : 'Another creator has part of that time. Try find_free_times.' }
      } else if (!s(a.where, 200)) return { text: 'Where is the offsite shoot? Pass `where`.' }
      const x: SShoot = { id: nextId(sb, 'shoot'), place, date, start, end, status: 'requested', with: withNames, ...(place === 'offsite' ? { where: s(a.where, 200) } : {}) }
      sb.shoots.push(x); await save(sb)
      return { text: `Requested: ${PLACE[place]}, ${date} ${hm(start)}–${hm(end)}${withNames.length ? ` with ${withNames.join(', ')}` : ''}. The schedule team approves it; the time is held meanwhile.${NOTE}`, structured: { result: shootRow(x, sb) } }
    }
    case 'move_shoot': case 'cancel_shoot': {
      const x = sb.shoots.find(y => y.id === s(a.shoot_id, 100))
      if (!x) return { text: 'That isn\'t one of your shoots. Check my_shoots for the id.' }
      if (name === 'cancel_shoot') {
        x.status = 'cancelled'; sb.requests.filter(r => r.shootId === x.id).forEach(r => { r.status = 'cancelled' }); await save(sb)
        return { text: `Cancelled your ${x.date} shoot (and its props requests).${NOTE}` }
      }
      const s1 = parseClock(a.start), date = s(a.day, 10)
      const start = s1 == null ? null : (s(a.place, 10) || x.place) === 'offsite' ? s1 : houseNight(s1)
      if (start == null || !isDay(date)) return { text: 'Give the new day (YYYY-MM-DD) and start time (HH:MM).' }
      const len = x.end - x.start
      const end0 = a.end != null ? parseClock(a.end) : null
      const end = end0 == null ? start + len : end0 <= start ? end0 + 1440 : end0
      const place = s(a.place, 10) || x.place
      if ((place === 'offsite') !== (x.place === 'offsite')) return { text: 'A house shoot can\'t become offsite (or the other way): cancel it and book again.' }
      if (place !== 'offsite' && date !== x.date && sb.shoots.some(y => y.id !== x.id && y.date === date && y.place !== 'offsite' && ['booked', 'requested'].includes(y.status))) return { text: 'You already have a house booking that day (one a day each).' }
      if (place !== 'offsite' && end - start > maxMinutesFor(1 + x.with.length, sch)) return { text: `That's longer than ${sch.slotMinutes / 60} hours per person on the booking.` }
      const bad = checkTimes(place, date, start, end, sch, today, now)
      if (bad) return { text: SCHEDULE_MESSAGES[bad] }
      if (place !== 'offsite') {
        const ds = await days([date], sb)
        if (conflictAt(ds[date], place as House, start, end, sch, now, { except: [x.id] })) return { text: 'That time isn\'t free. Try find_free_times.' }
      }
      Object.assign(x, { date, start, end, place, status: 'requested' }); await save(sb)
      return { text: `Moved to ${PLACE[place]} ${date} ${hm(start)}–${hm(end)}; the schedule team approves the new time.${NOTE}` }
    }
    case 'pick_up_props': case 'return_props': {
      const r = sb.requests.find(y => y.id === s(a.request_id, 100)) ?? sb.requests.find(y => y.status === (name === 'pick_up_props' ? 'packed' : 'collected'))
      if (!r) return { text: name === 'pick_up_props' ? 'Nothing is packed and ready to pick up.' : 'No props are out to bring back.' }
      if (name === 'pick_up_props') {
        if (r.status !== 'packed') return { text: `"${r.title}" is ${r.status}, so there's nothing to sign.` }
        if (a.all_received !== true && !objs(a.missing).length && !s(a.issue, 300)) return { text: `Check the bag against the list first: ${r.lines.map(l => `${l.itemName} x${l.qty}`).join(', ')}. Then everything is there (all_received) or say what's missing.` }
        r.status = 'collected'; await save(sb)
        return { text: `Signed for "${r.title}" ✓ Bring everything back by ${addDays(r.date, 1)} 10:00; return it here with one photo (return_props).${NOTE}` }
      }
      if (r.status !== 'collected') return { text: r.status === 'packed' ? `"${r.title}" hasn't been picked up yet: sign for it first (pick_up_props).` : `"${r.title}" is ${r.status}, so there's nothing to return.` }
      if (!a.photo) return { text: `A return needs one photo of everything being dropped off (${r.lines.map(l => l.itemName).join(', ')}). Ask them to attach it here.` }
      r.status = 'return_pending'; await save(sb)
      return { text: `Returned "${r.title}" ✓ The arts department checks each prop in next.${NOTE}` }
    }
    case 'request_props': case 'change_props_request': case 'cancel_props_request': {
      if (name === 'cancel_props_request') {
        const r = sb.requests.find(y => y.id === s(a.request_id, 100))
        if (!r) return { text: 'That isn\'t one of your props requests.' }
        r.status = 'cancelled'; await save(sb); return { text: `Cancelled the props request "${r.title}".${NOTE}` }
      }
      const closet = new Map((await loadCloset()).map(p => [p.id, p]))
      const ask = (objs(a.items)).map(x => ({ itemId: s(x.id, 128), qty: Math.max(0, Math.floor(Number(x.qty) || 0)) })).filter(l => l.itemId)
      for (const l of ask) if (!closet.has(l.itemId)) return { text: `${l.itemId} isn't in the closet. Use ids from search_props.` }
      let r: SReq | undefined, x: SShoot | undefined
      if (name === 'change_props_request') {
        r = sb.requests.find(y => y.id === s(a.request_id, 100))
        if (!r) return { text: 'That isn\'t one of your props requests.' }
        if (r.status !== 'requested') return { text: `That request is already ${r.status}.` }
        x = sb.shoots.find(y => y.id === r!.shootId)
      } else {
        x = sb.shoots.find(y => y.id === s(a.shoot_id, 100) && ['booked', 'requested'].includes(y.status))
        if (!x) return { text: 'Pick one of your upcoming shoots (my_shoots) to add props to.' }
      }
      if (x && now > propsDeadline(shootStartStamp(x.date, x.start), 48) && ask.some(l => l.qty > 0)) return { text: 'Too late to add props from the closet for that shoot (they close about 48 hours before it starts).' }
      const free = x ? await freeOn(x.date, ask.map(l => l.itemId)) : {}
      for (const l of ask) if (l.qty > (free[l.itemId] ?? 0)) return { text: `Only ${free[l.itemId] ?? 0} ${closet.get(l.itemId)!.name} free that day.` }
      const builds = ((Array.isArray(a.custom ?? a.add_custom) ? (a.custom ?? a.add_custom) : []) as Json[]).map(b => ({ description: s(b.description, 200), qty: Number(b.qty) || 1 })).filter(b => b.description)
      if (!r) r = sb.requests.find(y => y.shootId === x!.id && y.status === 'requested')
      if (!r) { r = { id: nextId(sb, 'props'), shootId: x!.id, title: s(a.video_name, 120) || 'Video', status: 'requested', date: x!.date, lines: [], builds: [] }; sb.requests.push(r) }
      const lines = new Map(r.lines.map(l => [l.itemId, l.qty]))
      for (const l of ask) { const q = name === 'request_props' ? (lines.get(l.itemId) ?? 0) + l.qty : l.qty; if (q === 0) lines.delete(l.itemId); else lines.set(l.itemId, q) }
      r.lines = [...lines].map(([itemId, qty]) => ({ itemId, itemName: closet.get(itemId)?.name ?? itemId, qty }))
      r.builds = [...r.builds, ...builds]
      await save(sb)
      if (a.reference_image && !builds.length) return { text: 'A reference picture goes with a custom prop: add the custom prop (what it is, how many) too.' }
      const pic = a.reference_image && builds.length ? ', with the reference picture' : ''
      return { text: `${name === 'request_props' ? 'Sent' : 'Changed'}: props request "${r.title}" for ${r.date}: ${r.lines.map(l => `${l.itemName} x${l.qty}`).join(', ')}${r.builds.length ? ` + ${r.builds.length} custom` : ''}${pic}.${builds.length ? ` ${CUSTOM_NOTE}` : ''}${NOTE}`, structured: { result: r } }
    }
    case 'join_waitlist': case 'leave_waitlist': {
      if (name === 'leave_waitlist') { sb.waitlist = sb.waitlist.filter(w => w.id !== s(a.waitlist_id, 300)); await save(sb); return { text: `Taken off that waitlist.${NOTE}` } }
      const start = parseClock(a.start), place = s(a.place, 10)
      if (start == null || !isDay(a.day) || !HOUSES.includes(place as House)) return { text: 'Give the house, day and the start of the booking you want.' }
      const w = { id: nextId(sb, 'wait'), day: a.day, place: PLACE[place], start: hm(start), status: 'waiting', position: 1 }
      sb.waitlist.push(w); await save(sb)
      return { text: `You're on the waitlist for ${w.place} ${w.day} at ${w.start} (number 1 in line). If it opens up, it's held for you for 20 minutes.${NOTE}` }
    }
    case 'invite_to_video': {
      const x = sb.shoots.find(y => y.id === s(a.shoot_id, 100))
      if (!x) return { text: 'Pick one of your own shoots (my_shoots).' }
      const names = (Array.isArray(a.people) ? a.people : []).map(v => s(v, 80)).filter(Boolean)
      return { text: `Invited ${names.join(', ')} into your ${x.date} video. They'll say yes or no in the app.${NOTE}` }
    }
    case 'answer_video_invite': case 'answer_swap': {
      const list = name === 'answer_swap' ? sb.swaps : sb.invites
      const it = list.find(i => i.id === s(name === 'answer_swap' ? a.swap_id : a.invite_id, 100))
      if (!it) return { text: 'Nothing waiting with that id (my_status lists them).' }
      it.status = a.accept === true ? 'accepted' : 'declined'
      if (name === 'answer_swap' && a.accept === true) {
        const mine = sb.shoots.find(y => y.id === it.mine)
        const t = it.theirs as { date: string; place: string; start: number; end: number }
        if (mine) Object.assign(mine, { date: t.date, place: t.place, start: t.start, end: t.end })
      }
      await save(sb)
      return { text: `${a.accept === true ? (name === 'answer_swap' ? 'Swapped ✓ Both shoots changed.' : 'You\'re in ✓') : 'Declined.'}${NOTE}` }
    }
    case 'request_swap': return { text: `Swap request sent. They accept or decline in the app.${NOTE}` }
    case 'report_problem': return { text: `Reported ✓ The ${a.kind === 'props' ? 'arts department' : 'equipment team'} would be told.${NOTE}` }
  }
  return null
}
