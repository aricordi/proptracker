// Which AI helper a chat message is for (owner, Oct 20: "no toggle, it should use context to do both").
// Pure and on the phone: no AI call, so it costs nothing and can't be talked into anything; the two helpers
// (props ideas, find a time) keep their own server-side safety checks.
//   - "props for my Saturday shoot" → props, for that booked shoot
//   - "4 hours with Kyle next week" → the schedule
//   - "a séance video, filming Friday night" → both (props first, then times)
//   - short follow-ups ("make it spookier", "anything earlier?") → whatever the chat was just doing
export type Helper = 'props' | 'time'
export interface RouteShoot { id: string; date: string }   // date 'YYYY-MM-DD', soonest first
export interface Route { helpers: Helper[]; shootId?: string }

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAY_RE = /\b(sun|mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?)(day)?s?\b/i
// Clearly about WHEN: booking words, lengths, days, dates, houses, people to film with.
const TIME_STRONG = new RegExp([
  String.raw`\b(book|booking|reserve the house|slots?|free (time|slot)s?|available|availability|when can|schedule)\b`,
  String.raw`\bfind (me )?(a |some )?(time|slot)`,
  String.raw`\b\d+(\.\d)?\s*(h|hrs?|hours?)\b`, String.raw`\b(an?|one|two|three|four|six) hours?\b`,
  String.raw`\b(today|tomorrow|tonight|this week|next week|this weekend|next weekend|asap|soonest|earliest)\b`,
  DAY_RE.source, String.raw`\b\d{1,2}(:\d\d)?\s*(am|pm)\b`,
  String.raw`\b(${MONTHS.join('|')})[a-z]*\.? \d{1,2}(st|nd|rd|th)?\b`, String.raw`\bthe \d{1,2}(st|nd|rd|th)\b`,
  String.raw`\bcliff ?[12]\b`, String.raw`\b(film|filming|shoot|shooting) with\b`, String.raw`\bback to back\b`,
].join('|'), 'i')
// Only means "when" if the chat is already about times ("evenings only", "anything earlier?").
const TIME_WEAK = /\b(mornings?|afternoons?|evenings?|nights?|weekends?|earlier|later|sooner|just me|only me|either house|other house)\b/i
// Clearly about WHAT: props, costumes, a video idea or a scene.
const PROPS_STRONG = /\b(props?|costumes?|wardrobe|outfits?|masks?|set dressing|gear|camera|lights?|video|skit|prank|sketch|scene|idea|parody|episode|theme|vibe|spookier|funnier|scarier|something for)\b/i
// "my next shoot", "my Saturday shoot", "the shoot on Oct 27", "the 27th shoot"
const SHOOT_REF = /\b(my|the|our|this|that)\s+(\w+\s+){0,3}shoot\b|\bshoot (on|for) /i

function words(t: string) { return t.trim().split(/\s+/).filter(Boolean).length }

// Which booked shoot does the message point at (by "next", a weekday or a date)?
export function findShoot(text: string, shoots: RouteShoot[]): string | undefined {
  if (!shoots.length || !SHOOT_REF.test(text)) return undefined
  const t = text.toLowerCase()
  if (/\bnext shoot\b|\bmy shoot\b|\bupcoming shoot\b/.test(t) && !DAY_RE.test(t)) return shoots[0].id
  const day = t.match(DAY_RE)
  if (day) {
    const idx = DAYS.findIndex(d => d.startsWith(day[1].slice(0, 3)))
    const hit = shoots.find(s => new Date(s.date + 'T12:00:00').getDay() === idx)
    if (hit) return hit.id
  }
  const md = t.match(new RegExp(String.raw`\b(${MONTHS.join('|')})[a-z]*\.? (\d{1,2})`))
  const th = t.match(/\bthe (\d{1,2})(st|nd|rd|th)\b/)
  if (md || th) {
    const dayNum = Number(md ? md[2] : th![1])
    const month = md ? MONTHS.indexOf(md[1]) : -1
    const hit = shoots.find(s => Number(s.date.slice(8)) === dayNum && (month < 0 || Number(s.date.slice(5, 7)) === month + 1))
    if (hit) return hit.id
  }
  return undefined
}

export function routeMessage(text: string, ctx: { last: Helper | null; shoots: RouteShoot[] }): Route {
  const t = text.trim()
  const booking = /\b(book|slots?|available|availability|find (me )?(a |some )?(time|slot)|when can)\b/i.test(t)
  // A booked shoot named in the message: props for it (unless they're asking to book another time).
  const shootId = booking ? undefined : findShoot(t, ctx.shoots)
  if (shootId) return { helpers: ['props'], shootId }
  // A weak time word counts when the chat is about times, or in a short message with nothing about props.
  const weak = TIME_WEAK.test(t) && (ctx.last === 'time' || (!PROPS_STRONG.test(t) && words(t) <= 6))
  const time = TIME_STRONG.test(t) || weak
  const props = PROPS_STRONG.test(t) || (words(t) >= 5 && !time)
  if (time && props) {
    // "filming Friday" inside a long idea → both; a short time follow-up in a props chat that names a prop → both too.
    return { helpers: ['props', 'time'] }
  }
  if (time) return { helpers: ['time'] }
  if (props) return { helpers: ['props'] }
  // Short follow-up with no clue ("anything else?", "more"): keep doing what we were doing.
  return { helpers: [ctx.last ?? 'props'] }
}
