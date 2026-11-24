// More connector tools (owner, Nov 24: "full functionality… leverage all of ChatGPT's intelligence"). Same two kinds as
// tools.ts: LOOK tools give raw facts the assistant reasons over; DO tools run the app's own server functions AS the person,
// so every rule, limit and approval applies exactly as in the app. Things that need the phone's camera (return photos,
// taking gear) come back as a link that opens the right screen in the app.
import { HttpsError } from 'firebase-functions/v2/https'
import { db } from '../auth.js'
import { todayInStudio, addDays, isDay, shootStartStamp, propsDeadline, lastDayToBook, returnDueDay, freeForRange, type BookingEntry } from '../booking.js'
import { nowStamp } from '../gearBooking.js'
import {
  HOUSES, freeGaps, priorityLocked, needsGuideline, houseSlotsOn, slotsPerDayFor, maxMinutesFor, isLongBooker,
  TIME_STEP, type House, type ScheduleDay,
} from '../schedule.js'
import { loadScheduleSettings, filmingPeople, requestSwap, answerSwap } from '../scheduling.js'
import { loadSettings, editReservation, cancelReservation } from '../reservations.js'
import { joinWaitlist, leaveWaitlist } from '../waitlist.js'
import { inviteToVideo, answerVideoInvite } from '../castInvites.js'
import { reportProblem } from '../problemReports.js'
import {
  asUser, callerOf, docById, s, clampInt, firstName, shortName, hm, matchPerson, askWho, personId, parseClock, loadCloset, short, READ, WRITE, DESTRUCTIVE, WRITE_OUT, DESTRUCTIVE_OUT, obj, objs,
  type Json, type McpUser, type ToolResult,
} from './common.js'
import { resolveWhen } from './understand.js'

export const APP_URL = 'https://proptracker.arbcreative.co'
const PLACE: Record<string, string> = { cliff1: 'Cliff 1', cliff2: 'Cliff 2', offsite: 'Offsite' }
const STATUS: Record<string, string> = { booked: 'approved', requested: 'waiting for approval', denied: 'not approved', expired: 'ran out (not approved in time)', cancelled: 'cancelled' }
const PROPS_STATUS: Record<string, string> = { requested: 'requested (can still be changed)', preparing: 'being prepared', packed: 'packed & ready to pick up', collected: 'picked up', return_pending: 'returned, being checked', returned: 'returned', cancelled: 'cancelled', declined: 'declined' }
const GUIDELINE_TEXT = (where: string[]) => `Also free but not bookable from here: ${where.slice(0, 4).join(', ')} (Cliff 1 on a priority day needs a filming guideline PDF, attached in the app: ${APP_URL}/schedule).`
const clock = (stamp: string) => stamp ? `${stamp.slice(0, 10)} ${stamp.slice(11, 16)}` : ''
const toMin = (v: unknown) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s(v, 6)); return m ? Number(m[1]) * 60 + Number(m[2]) : null }

async function ownShoot(id: string, u: McpUser, allowCrew = true) {
  const sh = await docById('shoots', id)
  if (!sh) return null
  const mine = sh.creatorEmail === u.email, crew = allowCrew && (sh.people ?? []).includes(u.email)
  return mine || crew ? { sh, mine } : null
}

export const MORE_TOOLS = [
  { name: 'my_status', title: 'What needs my attention', annotations: READ,
    description: 'A quick personal dashboard: the next shoot (and the deadline to add props), props or gear to bring back (and when they are due), props requests that still need something, video invites and swap requests waiting for an answer, waitlist spots, strikes and any pause. Use it when the person asks "what do I have going on?" or before planning.',
    inputSchema: obj({}) },
  { name: 'get_shoot', title: 'One shoot in detail', annotations: READ,
    description: 'Everything about one of the person\'s shoots (or one they are a collaborator on): place, day, hours, status, collaborators, who is in the video, its props requests with items and status, the exact deadline to add props from the closet and custom props, and an app link.',
    inputSchema: obj({ shoot_id: { type: 'string' } }, ['shoot_id']) },
  { name: 'plan_shoot', title: 'Plan a shoot from a casual request', annotations: READ,
    description: 'Turns a casual request to film with people (e.g. "film with Justin and Rolly tomorrow", "shoot with Ari this weekend, evenings") into a plan: who each name matches (names, nicknames, short forms and typos as said), questions to confirm (shared names, likely matches, people not on the app), the length (2 hours per person unless hours is given), the days, and times free for everyone on the booking (days a collaborator already films are skipped). Read only: books nothing. Book a chosen time with book_shoot.',
    inputSchema: obj({ with: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'People filming with them, as they said the names' },
      when: { type: 'string', description: 'Their words: "tomorrow", "sat", "next friday", "this weekend", "next week", "nov 28"' },
      day: { type: 'string', description: 'Or an exact day YYYY-MM-DD' }, hours: { type: 'number', minimum: 0.5, maximum: 12, description: 'Only if they said a length' },
      at: { type: 'string', description: 'A start they asked for, e.g. "17:00" or "5pm"' }, time_of_day: { type: 'string', enum: ['any', 'morning', 'afternoon', 'evening', 'night'] },
      houses: { type: 'array', items: { type: 'string', enum: ['cliff1', 'cliff2'] } }, limit: { type: 'integer', minimum: 1, maximum: 12, description: 'Default 6' } }) },
  { name: 'find_free_times', title: 'Find free filming times', annotations: READ,
    description: 'Search the schedule for times that fit: how long, how many people (2 h per person; longer needs collaborators), which houses, time of day or a preferred start. Returns ready-to-book options that respect this person\'s priority-day locks and one-booking-a-day limit, with notes like "needs a guideline PDF". Use your own judgement to pick or suggest between them; get_schedule has the full raw picture.',
    inputSchema: obj({ from: { type: 'string', description: 'YYYY-MM-DD, default today' }, days: { type: 'integer', minimum: 1, maximum: 21, description: 'Default 7' },
      hours: { type: 'number', minimum: 0.5, maximum: 12, description: 'Length, default 2' }, people: { type: 'integer', minimum: 1, maximum: 5, description: 'How many on the booking incl. the person, default 1' },
      houses: { type: 'array', items: { type: 'string', enum: ['cliff1', 'cliff2'] } }, time_of_day: { type: 'string', enum: ['any', 'morning', 'afternoon', 'evening', 'night'] },
      around: { type: 'string', description: 'Preferred start HH:MM (closest first)' }, limit: { type: 'integer', minimum: 1, maximum: 30, description: 'Default 12' } }) },
  { name: 'prop_calendar', title: 'When a prop is free', annotations: READ,
    description: 'How many units of one prop are free on each day over a range (up to 28 days). Use it to pick a shoot day around a key prop.',
    inputSchema: obj({ id: { type: 'string' }, from: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: 28 } }, ['id']) },
  { name: 'change_props_request', title: 'Change a props request', annotations: DESTRUCTIVE_OUT,
    description: 'Change one of the person\'s props requests while it is still "requested": set the quantity of props (0 removes one; new ids add them) and/or add custom props. Additions must still be within the props notice. Confirm the new list with the person first.',
    inputSchema: obj({ request_id: { type: 'string' }, items: { type: 'array', maxItems: 60, items: obj({ id: { type: 'string' }, qty: { type: 'integer', minimum: 0 } }, ['id', 'qty']) },
      add_custom: { type: 'array', maxItems: 10, items: obj({ description: { type: 'string' }, qty: { type: 'integer', minimum: 1 } }, ['description']) } }, ['request_id']) },
  { name: 'cancel_props_request', title: 'Cancel a props request', annotations: DESTRUCTIVE_OUT,
    description: 'Cancel one of the person\'s props requests (only before pick-up). Confirm first.',
    inputSchema: obj({ request_id: { type: 'string' } }, ['request_id']) },
  { name: 'join_waitlist', title: 'Wait for a taken time', annotations: WRITE,
    description: 'Put the person on the waitlist for a booking someone else has (give the house, day and that booking\'s start time). If it opens up they get it held for 20 minutes and a notification. Up to 5 at once.',
    inputSchema: obj({ place: { type: 'string', enum: ['cliff1', 'cliff2'] }, day: { type: 'string' }, start: { type: 'string', description: 'HH:MM, the start of the taken booking' } }, ['place', 'day', 'start']) },
  { name: 'leave_waitlist', title: 'Leave a waitlist', annotations: DESTRUCTIVE,
    description: 'Take the person off a waitlist (ids from my_status).', inputSchema: obj({ waitlist_id: { type: 'string' } }, ['waitlist_id']) },
  { name: 'invite_to_video', title: 'Invite people into my video', annotations: WRITE_OUT,
    description: 'Tell people they are on camera in one of the person\'s shoots (names or person ids from list_people, people on the app). Each gets a notification to say yes or no; once they accept, the shoot shows in their app with reminders. Different from collaborators on the booking. Confirm first.',
    inputSchema: obj({ shoot_id: { type: 'string' }, people: { type: 'array', items: { type: 'string' }, maxItems: 12 } }, ['shoot_id', 'people']) },
  { name: 'answer_video_invite', title: 'Answer a video invite', annotations: WRITE_OUT,
    description: 'Say yes or no to being in someone\'s video (invite ids from my_status).', inputSchema: obj({ invite_id: { type: 'string' }, accept: { type: 'boolean' } }, ['invite_id', 'accept']) },
  { name: 'request_swap', title: 'Ask someone to swap times', annotations: WRITE_OUT,
    description: 'Ask another creator to trade times: one of the person\'s approved house shoots for theirs (same length). They accept or decline in the app. The only no-penalty way to change inside the notice period. Confirm first.',
    inputSchema: obj({ my_shoot_id: { type: 'string' }, their_day: { type: 'string' }, their_place: { type: 'string', enum: ['cliff1', 'cliff2'] }, their_start: { type: 'string', description: 'HH:MM of their booking' } }, ['my_shoot_id', 'their_day', 'their_place', 'their_start']) },
  { name: 'answer_swap', title: 'Answer a swap request', annotations: DESTRUCTIVE_OUT,
    description: 'Accept or decline a swap someone asked for (ids from my_status). Accepting trades both shoots at once. Confirm first.',
    inputSchema: obj({ swap_id: { type: 'string' }, accept: { type: 'boolean' } }, ['swap_id', 'accept']) },
  { name: 'report_problem', title: 'Report something broken or missing', annotations: WRITE_OUT,
    description: 'Tell the arts department (props) or the equipment team (gear) that something the person has out is broken or missing. Ids from my_status.',
    inputSchema: obj({ kind: { type: 'string', enum: ['props', 'gear'] }, id: { type: 'string', description: 'Props request id or gear booking id' }, what: { type: 'string', description: 'Which item' }, note: { type: 'string', description: 'What happened' } }, ['kind', 'id', 'note']) },
  { name: 'app_link', title: 'Open the right screen in the app', annotations: READ,
    description: 'A link that opens the Prime Capitol app on the right screen for things that need the phone: picking up or returning props and gear (photos), taking gear on the shoot day, or the calendar. Give it to the person to tap.',
    inputSchema: obj({ what: { type: 'string', enum: ['return', 'pickup', 'take_gear', 'shoot', 'calendar', 'props', 'requests', 'notifications'] }, shoot_id: { type: 'string' } }, ['what']) },
]
export const MORE_BOOKING = new Set(MORE_TOOLS.map(t => t.name).filter(n => n !== 'prop_calendar' && n !== 'app_link'))

export async function runMoreTool(name: string, args: Json, u: McpUser): Promise<ToolResult | null> {
  switch (name) {
    case 'my_status': return myStatus(u)
    case 'get_shoot': return getShoot(args, u)
    case 'find_free_times': return findFreeTimes(args, u)
    case 'plan_shoot': return planShoot(args, u)
    case 'prop_calendar': return propCalendar(args)
    case 'change_props_request': {
      const id = s(args.request_id, 100)
      const r = await docById('reservations', id)
      if (!r || r.creatorEmail !== u.email) return { text: 'That isn\'t one of your props requests (my_status or my_props_requests has the ids).' }
      if (r.status !== 'requested') return { text: `That request is already ${PROPS_STATUS[r.status] ?? r.status}, so it can't be changed here. The arts department can help.` }
      const lines = new Map<string, number>(((r.lines ?? []) as { itemId: string; qty: number }[]).map(l => [l.itemId, l.qty]))
      for (const x of objs(args.items)) {
        const pid = s(x.id, 128), q = Math.max(0, Math.floor(Number(x.qty) || 0))
        if (!pid) continue
        if (q === 0) lines.delete(pid); else lines.set(pid, q)
      }
      const builds = [...((r.builds ?? []) as Json[]), ...(objs(args.add_custom)).map(b => ({ description: s(b.description, 200), qty: Number(b.qty) || 1 })).filter(b => b.description)]
      if (!lines.size && !builds.length) return { text: 'That would leave the request empty: cancel it instead (cancel_props_request).' }
      await editReservation.run(asUser(u, { id, lines: [...lines].map(([itemId, qty]) => ({ itemId, qty })), builds }))
      const names = new Map((await loadCloset()).map(p => [p.id, p.name]))
      return { text: `Changed "${r.title}": ${[...lines].map(([k, q]) => `${names.get(k) ?? k} x${q}`).join(', ')}${builds.length ? ` + ${builds.length} custom` : ''}.` }
    }
    case 'cancel_props_request': {
      const id = s(args.request_id, 100)
      const r = await docById('reservations', id)
      if (!r || r.creatorEmail !== u.email) return { text: 'That isn\'t one of your props requests.' }
      await cancelReservation.run(asUser(u, { id }))
      return { text: `Cancelled the props request "${r.title}" for ${r.startDate}.` }
    }
    case 'join_waitlist': {
      const start = toMin(args.start), house = s(args.place, 10) as House
      if (start == null || !isDay(args.day) || !HOUSES.includes(house)) return { text: 'Give the house, day (YYYY-MM-DD) and the start (HH:MM) of the booking you want.' }
      const r = await joinWaitlist.run(asUser(u, { date: args.day, house, start })) as Json
      return { text: `You're on the waitlist for ${PLACE[house]} ${args.day} at ${hm(start)}${r.position ? ` (number ${r.position} in line)` : ''}. If it opens up, it's held for you for 20 minutes and you get a notification.`, structured: { result: r } }
    }
    case 'leave_waitlist': {
      if (!/^[\w-]{1,300}$/.test(s(args.waitlist_id, 300))) return { text: 'That id isn\'t right: my_status has the ids.' }
      await leaveWaitlist.run(asUser(u, { id: s(args.waitlist_id, 300) }))
      return { text: 'Taken off that waitlist.' }
    }
    case 'invite_to_video': {
      const own = await ownShoot(String(args.shoot_id ?? ''), u, false)
      if (!own) return { text: 'Pick one of your own shoots (my_shoots).' }
      const people = await filmingPeople({ includeDemo: true })
      const emails: string[] = []
      for (const n of (Array.isArray(args.people) ? args.people : []).map(x => s(x, 120)).filter(Boolean)) {
        const m = matchPerson(people, n, u.email)
        const ask = askWho(n, m)
        if (ask) return { text: m.status === 'none' ? `${ask} Only people on the app can get a video invite.` : ask }
        emails.push(m.hits[0].email)
      }
      if (!emails.length) return { text: 'Who should be in the video?' }
      await inviteToVideo.run(asUser(u, { shootId: s(args.shoot_id, 100), emails }))
      return { text: `Invited ${emails.length} ${emails.length === 1 ? 'person' : 'people'} into your ${own.sh.date} video. They'll say yes or no in the app.` }
    }
    case 'answer_video_invite': {
      if (!/^[\w-]{1,300}$/.test(s(args.invite_id, 300))) return { text: 'That id isn\'t right: my_status has the ids.' }
      await answerVideoInvite.run(asUser(u, { id: s(args.invite_id, 300), accept: args.accept === true }))
      return { text: args.accept === true ? 'You\'re in ✓ It shows in your app with reminders.' : 'Declined. They\'ll see you can\'t make it.' }
    }
    case 'request_swap': {
      const own = await ownShoot(String(args.my_shoot_id ?? ''), u, false)
      if (!own) return { text: 'Pick one of your own approved shoots (my_shoots).' }
      const start = toMin(args.their_start), house = s(args.their_place, 10) as House
      if (start == null || !isDay(args.their_day) || !HOUSES.includes(house)) return { text: 'Give their house, day and start time.' }
      const day = (await db.doc(`schedule_days/${args.their_day}`).get()).data() as ScheduleDay | undefined
      const e = Object.values((day?.[house] ?? {}) as Record<string, { shootId: string; time?: { start: number }; pending?: boolean; hold?: unknown }>)
        .find(x => x?.shootId && !x.hold && !x.pending && (x.time?.start ?? -1) === start) ?? (day?.[house] as Record<string, { shootId: string }> | undefined)?.[String(start)]
      if (!e?.shootId) return { text: `Nobody has an approved booking at ${PLACE[house]} ${args.their_day} ${hm(start)} (check get_schedule).` }
      await requestSwap.run(asUser(u, { myShootId: s(args.my_shoot_id, 100), theirShootId: e.shootId }))
      return { text: 'Swap request sent. They accept or decline in the app; you get a notification.' }
    }
    case 'answer_swap': {
      if (!/^[\w-]{1,300}$/.test(s(args.swap_id, 300))) return { text: 'That id isn\'t right: my_status has the ids.' }
      await answerSwap.run(asUser(u, { id: s(args.swap_id, 100), accept: args.accept === true }))
      return { text: args.accept === true ? 'Swapped ✓ Both shoots changed.' : 'Declined.' }
    }
    case 'report_problem': {
      await reportProblem.run(asUser(u, { kind: args.kind === 'props' ? 'props' : 'gear', id: s(args.id, 100), name: s(args.what, 80), note: s(args.note, 300) }))
      return { text: `Reported ✓ The ${args.kind === 'props' ? 'arts department' : 'equipment team'} is told.` }
    }
    case 'app_link': {
      const id = s(args.shoot_id, 100)
      const path: Record<string, string> = {
        shoot: id ? `/schedule?shoot=${id}` : '/shoots',
        return: '/requests', pickup: '/requests', take_gear: '/gear', calendar: '/schedule', props: '/browse', requests: '/requests', notifications: '/account',
      }
      const p = path[s(args.what, 20)] ?? '/'
      const what: Record<string, string> = { return: 'return props or gear (with a photo)', pickup: 'sign for your props', take_gear: 'take gear for your shoot', shoot: 'open the shoot', calendar: 'see the calendar', props: 'browse the props', requests: 'see your requests', notifications: 'turn on notifications' }
      return { text: `Tap to ${what[s(args.what, 20)] ?? 'open the app'}: ${APP_URL}${p}`, structured: { url: `${APP_URL}${p}` } }
    }
  }
  return null
}

async function myStatus(u: McpUser): Promise<ToolResult> {
  const today = todayInStudio(), now = nowStamp()
  const [sch, b, shootsOwn, shootsCrew, res, gear, swaps, casts, waits, status] = await Promise.all([
    loadScheduleSettings(), loadSettings(),
    db.collection('shoots').where('creatorEmail', '==', u.email).where('date', '>=', addDays(today, -1)).get(),
    db.collection('shoots').where('people', 'array-contains', u.email).get(),
    db.collection('reservations').where('creatorEmail', '==', u.email).get(),
    db.collection('gear_bookings').where('creatorEmail', '==', u.email).get(),
    db.collection('swap_requests').where('toEmail', '==', u.email).where('status', '==', 'pending').get(),
    db.collection('cast_invites').where('toEmail', '==', u.email).get(),
    db.collection('waitlist').where('email', '==', u.email).get(),
    db.doc(`user_status/${u.email}`).get(),
  ])
  const shoots = [...shootsOwn.docs, ...shootsCrew.docs.filter(d => d.get('creatorEmail') !== u.email)]
    .map(d => ({ id: d.id, ...d.data() } as Json & { id: string }))
    .filter(x => ['booked', 'requested'].includes(String(x.status)) && String(x.to ?? '') > now)
    .sort((a, c) => String(a.from).localeCompare(String(c.from)))
  const next = shoots[0]
  const out = res.docs.map(d => ({ id: d.id, ...d.data() } as Json & { id: string }))
  const toReturn = out.filter(r => r.status === 'collected').map(r => ({ id: r.id, video: r.title, items: ((r.lines ?? []) as Json[]).map(l => `${l.itemName} x${l.qty}`), due: `${returnDueDay(String(r.endDate), b)} 10:00` }))
  const open = out.filter(r => ['requested', 'preparing', 'packed'].includes(String(r.status)) && String(r.startDate) >= today)
    .map(r => ({ id: r.id, video: r.title, day: r.startDate, status: PROPS_STATUS[String(r.status)] ?? r.status, issues: ((r.issues ?? []) as Json[]).length || undefined }))
  const gearOut = gear.docs.map(d => ({ id: d.id, ...d.data() } as Json & { id: string })).filter(g => g.status === 'out').map(g => ({ id: g.id, items: ((g.lines ?? []) as Json[]).map(l => String(l.name)), due: clock(String(g.to ?? '')) }))
  const st = status.data() ?? {}
  const data = {
    today, now: clock(now),
    next_shoot: next ? { id: next.id, day: next.date, start: hm(Number(next.start)), end: hm(Number(next.end)), place: PLACE[String(next.place)] ?? next.place, status: STATUS[String(next.status)],
      props_deadline: clock(propsDeadline(shootStartStamp(String(next.date), Number(next.start)), b.leadTimeHours ?? 48)) } : null,
    upcoming_shoots: shoots.length,
    props_to_bring_back: toReturn, gear_to_bring_back: gearOut, props_requests_open: open,
    swap_requests_for_you: swaps.docs.map(d => ({ id: d.id, from: firstName(String(d.get('fromName'))), they_offer: d.get('from'), they_want: d.get('to') })),
    video_invites_waiting: casts.docs.filter(d => d.get('status') === 'pending' && String(d.get('to') ?? '') > now).map(d => ({ id: d.id, host: firstName(String(d.get('hostName'))), day: d.get('date'), start: hm(Number(d.get('start'))), place: d.get('placeName') })),
    videos_you_are_in: casts.docs.filter(d => d.get('status') === 'accepted' && String(d.get('to') ?? '') > now).map(d => ({ host: firstName(String(d.get('hostName'))), day: d.get('date'), start: hm(Number(d.get('start'))), place: d.get('placeName') })),
    waitlist: waits.docs.filter(d => ['waiting', 'offered'].includes(String(d.get('status')))).map(d => ({ id: d.id, day: d.get('date'), place: PLACE[String(d.get('house'))], start: hm(Number(d.get('start'))), status: d.get('status') })),
    strikes: Number(st.strikes ?? 0), paused_until: st.pausedUntil && String(st.pausedUntil) >= today ? st.pausedUntil : null,
  }
  const lines = [
    next ? `Next shoot: ${data.next_shoot!.day} ${data.next_shoot!.start}–${data.next_shoot!.end} ${data.next_shoot!.place} (${data.next_shoot!.status}); props from the closet by ${data.next_shoot!.props_deadline}.` : 'No shoots coming up.',
    toReturn.length ? `Props to bring back: ${toReturn.map(r => `"${r.video}" by ${r.due}`).join('; ')}.` : '',
    gearOut.length ? `Gear out: ${gearOut.map(g => `${g.items.join(', ')} (due ${g.due})`).join('; ')}.` : '',
    data.swap_requests_for_you.length ? `${data.swap_requests_for_you.length} swap request(s) waiting for an answer.` : '',
    data.video_invites_waiting.length ? `${data.video_invites_waiting.length} video invite(s) waiting: ${data.video_invites_waiting.map(v => `${v.host} ${v.day}`).join(', ')}.` : '',
    data.paused_until ? `Props requests are paused until ${data.paused_until} (${data.strikes} strikes).` : data.strikes ? `${data.strikes} strike(s) in the last ${sch.strikeDays} days.` : '',
  ].filter(Boolean)
  return { text: lines.join('\n'), structured: data }
}

async function getShoot(args: Json, u: McpUser): Promise<ToolResult> {
  const own = await ownShoot(String(args.shoot_id ?? ''), u)
  if (!own) return { text: 'That isn\'t one of your shoots (my_shoots has the ids).' }
  const { sh } = own
  const id = s(args.shoot_id, 100)
  const [, b, reqs, casts] = await Promise.all([loadScheduleSettings(), loadSettings(),
    db.collection('reservations').where('scheduleShootId', '==', id).get(), db.collection('cast_invites').where('shootId', '==', id).get()])
  const now = nowStamp()
  const start = shootStartStamp(String(sh.date), Number(sh.start))
  const data = {
    id, day: sh.date, start: hm(Number(sh.start)), end: hm(Number(sh.end)), place: PLACE[String(sh.place)] ?? sh.place, where: sh.where || undefined,
    status: STATUS[String(sh.status)] ?? sh.status, denied_reason: sh.deniedReason || undefined, booked_by: own.mine ? 'you' : firstName(String(sh.creatorName)),
    collaborators: ((sh.with ?? []) as Json[]).map(w => ({ name: firstName(String(w.name)), on_app: !w.guest })),
    in_the_video: casts.docs.map(d => ({ name: firstName(String(d.get('toName'))), answer: d.get('status') })),
    props_requests: reqs.docs.filter(d => d.get('creatorEmail') === u.email).map(d => ({ id: d.id, video: d.get('title'), status: PROPS_STATUS[String(d.get('status'))] ?? d.get('status'),
      items: ((d.get('lines') ?? []) as Json[]).map(l => `${l.itemName} x${l.qty}${(l.pick as Json | undefined)?.state === 'unavailable' ? ' (not available)' : ''}`),
      custom: ((d.get('builds') ?? []) as Json[]).map(x => String(x.description)) })),
    props_deadline: clock(propsDeadline(start, b.leadTimeHours ?? 48)), props_still_open: now <= propsDeadline(start, b.leadTimeHours ?? 48),
    custom_props_deadline: lastDayToBook(String(sh.date), b.buildLeadDays ?? 4, b),
    outcome: sh.noShow || sh.outcome === 'noshow' ? 'marked a no-show' : undefined,
    wrapped: !!sh.wrap || undefined, guideline: sh.guideline ? 'attached' : undefined,
    app_link: `${APP_URL}/schedule?shoot=${id}`,
  }
  const text = `${data.place} ${data.day} ${data.start}–${data.end}, ${data.status}${data.collaborators.length ? `, with ${data.collaborators.map(c => c.name).join(', ')}` : ''}.\nProps: ${data.props_requests.map(r => `"${r.video}" ${r.status}: ${r.items.join(', ')}`).join(' | ') || 'none yet'}${data.props_still_open ? ` (add from the closet by ${data.props_deadline})` : ' (too late for new closet props)'}.\nApp: ${data.app_link}`
  return { text, structured: data }
}

interface FreeAsk { dates: string[]; need: number; houses: House[]; tod: string; around: number | null; limit: number; crew?: string[] }
/** Ready-to-book times: this person's locks and one-booking-a-day limit, and (crew) days a collaborator already films are left out. */
async function freeOptions(a: FreeAsk, u: McpUser) {
  const sch = await loadScheduleSettings()
  const now = nowStamp()
  const inTod = (m: number) => a.tod === 'any' || (a.tod === 'morning' ? m < 720 : a.tod === 'afternoon' ? m >= 720 && m < 1020 : a.tod === 'evening' ? m >= 1020 && m < 1260 : m >= 1260)
  const snaps = a.dates.length ? await db.getAll(...a.dates.map(d => db.doc(`schedule_days/${d}`))) : []
  const options: Json[] = [], busy: { day: string; who: string }[] = [], guideline = new Set<string>()
  a.dates.forEach((date, i) => {
    const day = snaps[i].data() as ScheduleDay | undefined
    if (houseSlotsOn(day, u.email, now) >= slotsPerDayFor(u.email, sch)) { busy.push({ day: date, who: 'you' }); return }
    const taken = (a.crew ?? []).filter(e => !e.startsWith('guest:') && houseSlotsOn(day, e, now) >= slotsPerDayFor(e, sch))
    if (taken.length) { busy.push(...taken.map(e => ({ day: date, who: e }))); return }
    for (const h of a.houses) {
      if (priorityLocked(date, h, sch, u.email, now)) continue
      for (const g of freeGaps(day, date, h, sch, now, a.need)) {
        const starts = new Set<number>([g.start, g.end - a.need])
        if (a.around != null) starts.add(Math.min(Math.max(a.around, g.start), g.end - a.need))
        for (const x of [720, 1020, 1260]) if (x > g.start && x + a.need <= g.end) starts.add(x)
        for (const st of starts) {
          if (st % TIME_STEP || st < g.start || st + a.need > g.end || !inTod(st)) continue
          // A guideline PDF can't be attached from a chat (review, Nov 24): those times are booked in the app instead.
          if (needsGuideline(date, h, u.email, sch)) { guideline.add(`${date} ${PLACE[h]}`); continue }
          options.push({ day: date, place: h, house: PLACE[h], start: hm(st), end: hm(st + a.need), free_stretch: `${hm(g.start)}–${hm(g.end)}`, _s: st })
        }
      }
    }
  })
  const around = a.around
  options.sort((x, c) => around != null ? Math.abs(Number(x._s) - around) - Math.abs(Number(c._s) - around) || String(x.day).localeCompare(String(c.day)) : String(x.day).localeCompare(String(c.day)) || Number(x._s) - Number(c._s))
  return { options: options.slice(0, a.limit).map(({ _s, ...o }) => o), busy, guideline: [...guideline] }   // eslint-disable-line @typescript-eslint/no-unused-vars
}
const todOf = (v: unknown) => { const x = s(v, 10); return ['morning', 'afternoon', 'evening', 'night'].includes(x) ? x : 'any' }
const housesOf = (v: unknown) => { const l = (Array.isArray(v) ? v : []).filter((h): h is House => HOUSES.includes(h as House)); return l.length ? l : [...HOUSES] }

async function findFreeTimes(args: Json, u: McpUser): Promise<ToolResult> {
  const sch = await loadScheduleSettings()
  const today = todayInStudio()
  const from = isDay(args.from) && String(args.from) >= today ? String(args.from) : today
  const n = Math.min(21, Math.max(1, Number.isInteger(args.days) ? Number(args.days) : 7))
  const people = Math.min(5, Math.max(1, Number.isInteger(args.people) ? Number(args.people) : 1))
  const need = Math.round(Math.min(12, Math.max(0.5, Number(args.hours) || 2)) * 60 / TIME_STEP) * TIME_STEP
  if (!isLongBooker(u.email, sch) && need > maxMinutesFor(people, sch)) {
    const more = Math.ceil(need / sch.slotMinutes) - people
    return { text: `${need / 60} hours needs ${more} more ${more === 1 ? 'person' : 'people'} on the booking (2 hours each). Ask who's filming with them, then use plan_shoot with their names.` }
  }
  const { options: top, guideline } = await freeOptions({ dates: Array.from({ length: n }, (_, i) => addDays(from, i)), need, houses: housesOf(args.houses), tod: todOf(args.time_of_day), around: toMin(args.around), limit: clampInt(args.limit, 1, 30, 12) }, u)
  const gl = guideline.length ? `\n${GUIDELINE_TEXT(guideline)}` : ''
  return { text: (top.length ? top.map(o => `${o.day} ${o.house} ${o.start}–${o.end}`).join('\n') + '\nBook one with book_shoot (add collaborators in `with` if more than 2 hours).' : 'Nothing free that fits. Try other days, a shorter time or the other house.') + gl,
    structured: { length_hours: need / 60, people, options: top, ...(guideline.length ? { needs_guideline_in_app: guideline, app_link: `${APP_URL}/schedule` } : {}) } }
}

// PLAN A SHOOT from how people talk (owner, Nov 24): "film with Justin and Rolly tomorrow" → who Justin and Rolly are (nicknames,
// typos asked about, never guessed), how long (2 h each unless they said), which days, and times that fit EVERYONE (nobody on the
// booking already filming that day). Read only: it books nothing. Returns `questions` for whatever is genuinely unclear.
async function planShoot(args: Json, u: McpUser): Promise<ToolResult> {
  const sch = await loadScheduleSettings()
  const today = todayInStudio()
  const people = await filmingPeople({ includeDemo: true, offApp: true })
  const said = (Array.isArray(args.with) ? args.with : []).map(x => s(x, 80)).filter(Boolean).slice(0, 4)
  const questions: string[] = [], resolved: Json[] = [], crew: string[] = [], names: string[] = []
  let unsure = 0
  for (const n of said) {
    if (n.includes('@')) { questions.push('Use names, not email addresses.'); continue }
    const m = matchPerson(people, n, u.email)
    const likely = m.status === 'one' || (m.status === 'maybe' && m.hits.length === 1) ? m.hits[0] : null
    if (likely && crew.includes(likely.email)) continue   // "Justin and Jus" = one person
    if (m.status === 'one') {
      crew.push(likely!.email); names.push(shortName(likely!.name))
      resolved.push({ said: n, status: 'found', name: shortName(likely!.name), person_id: personId(likely!.email), ...(likely!.email.startsWith('guest:') ? { on_app: false } : {}) })
      continue
    }
    resolved.push({ said: n, status: m.status === 'none' ? 'not_found' : m.status === 'many' ? 'which_one' : 'did_you_mean',
      candidates: m.hits.map(h => ({ name: shortName(h.name), person_id: personId(h.email) })) })
    if (likely) {
      // A nickname / short form / typo with one likely person: times are found as if it's them; the assistant confirms in one line.
      crew.push(likely.email); names.push(shortName(likely.name))
      questions.push(`Check: "${n}" = ${shortName(likely.name)}? (person id ${personId(likely.email)})`)
    } else {
      unsure++
      questions.push(m.status === 'none' ? `Is "${n}" someone who isn't on the app yet? (Then book_shoot can add them by name with not_on_app.)` : askWho(n, m)!)
    }
  }
  const total = 1 + crew.length + unsure   // one per person, duplicates counted once
  // Length: what they said, else 2 h per person (the studio's rule, and what people almost always mean).
  const saidHours = Number(args.hours)
  let need = saidHours > 0 ? Math.round(Math.min(12, Math.max(0.5, saidHours)) * 60 / TIME_STEP) * TIME_STEP : Math.min(maxMinutesFor(total, sch), 5 * sch.slotMinutes)
  const longOk = isLongBooker(u.email, sch)
  if (!longOk && need > maxMinutesFor(total, sch)) {
    questions.push(`${need / 60} hours is more than ${total} ${total === 1 ? 'person gets' : 'people get'} (2 hours each). Who else is filming, or shorter?`)
    need = maxMinutesFor(total, sch)
  }
  // When: an exact day, or the words they used, else the next 7 days.
  let dates: string[] = [], whenLabel = ''
  if (isDay(args.day) && String(args.day) >= today) { dates = [String(args.day)]; whenLabel = String(args.day) }
  else {
    const w = resolveWhen(s(args.when, 80), today)
    if (w) { dates = w.days.filter(d => d >= today); whenLabel = w.label }
    else { dates = Array.from({ length: 7 }, (_, i) => addDays(today, i)); whenLabel = 'the next 7 days'; if (s(args.when, 80)) questions.push(`Couldn't tell which day "${s(args.when, 80)}" is: which date?`) }
  }
  const around = parseClock(args.at)
  const plan = await freeOptions({ dates, need, houses: housesOf(args.houses), tod: around != null ? 'any' : todOf(args.time_of_day), around, limit: clampInt(args.limit, 1, 12, 6), crew }, u)
  const busyText = plan.busy.map(b => `${b.day}: ${b.who === 'you' ? 'you already film that day' : `${names[crew.indexOf(b.who)] ?? 'a collaborator'} already films that day`}`)
  let fallback: Json[] = []
  if (!plan.options.length && dates.length <= 2) {
    // Nothing that day: offer the soonest days after it, so the conversation keeps going.
    const after = Array.from({ length: 7 }, (_, i) => addDays(dates[dates.length - 1] ?? today, i + 1))
    fallback = (await freeOptions({ dates: after, need, houses: housesOf(args.houses), tod: around != null ? 'any' : todOf(args.time_of_day), around, limit: 4, crew }, u)).options
  }
  const who = names.length ? `you + ${names.join(' + ')}` : said.length ? `you + ${said.length} more` : 'just you'
  const lines = plan.options.map(o => `${o.day} ${o.house} ${o.start}–${o.end}`)
  const text = [
    `Plan: ${who}, ${need / 60} h, ${whenLabel}.`,
    ...resolved.filter(r => r.status === 'found').map(r => `"${r.said}" = ${r.name}${r.on_app === false ? ' (not on the app; booked by name)' : ''}`),
    ...(questions.length ? ['Ask first:', ...questions.map(q => `- ${q}`)] : []),
    ...(lines.length ? ['Times that fit everyone:', ...lines] : [`Nothing free ${whenLabel} for ${need / 60} h.${busyText.length ? ` (${busyText.join('; ')})` : ''}`]),
    ...(fallback.length ? ['Soonest after that:', ...fallback.map(o => `${o.day} ${o.house} ${o.start}–${o.end}`)] : []),
    ...(plan.guideline.length ? [GUIDELINE_TEXT(plan.guideline)] : []),
    questions.length ? 'Clear up the questions, then confirm one time and book it with book_shoot.' : 'Offer 2–3 of these, confirm one, then book_shoot with these people in `with` (person ids).',
  ].join('\n')
  return { text, structured: { people: resolved, everyone: total, length_hours: need / 60, when: whenLabel, days: dates, questions, options: plan.options, ...(fallback.length ? { soonest_after: fallback } : {}), ...(busyText.length ? { busy: busyText } : {}), ...(plan.guideline.length ? { needs_guideline_in_app: plan.guideline } : {}) } }
}

async function propCalendar(args: Json): Promise<ToolResult> {
  const p = (await loadCloset()).find(x => x.id === s(args.id, 128))
  if (!p) throw new HttpsError('not-found', 'That prop isn\'t in the closet.')
  const b = await loadSettings()
  const today = todayInStudio()
  const from = isDay(args.from) && String(args.from) >= today ? String(args.from) : today
  const n = Math.min(28, Math.max(1, Number.isInteger(args.days) ? Number(args.days) : 14))
  const entries = ((await db.doc(`item_bookings/${p.id}`).get()).get('entries') ?? []) as BookingEntry[]
  const days = Array.from({ length: n }, (_, i) => addDays(from, i)).map(day => ({ day, free: freeForRange({ quantity: p.quantity, missingQty: p.missing, legacyCheckedOut: false }, entries, day, day, today, b.bufferDays, b) }))
  return { text: `${p.name} (x${short(p).how_many}): ` + days.map(d => `${d.day.slice(5)} ${d.free}`).join(', '), structured: { prop: short(p), days } }
}
