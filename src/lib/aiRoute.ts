// Which AI helper a chat message is for (owner, Oct 20: "no toggle, it should use context to do both").
// Pure and on the phone: no AI call, so it costs nothing and can't be talked into anything; the two helpers
// (props ideas, find a time) keep their own server-side safety checks.
//   - "props for my Saturday shoot" → props, for that booked shoot
//   - "4 hours with Kyle next week" → the schedule
//   - "a séance video, filming Friday night" → both (props first, then times)
//   - short follow-ups ("make it spookier", "anything earlier?") → whatever the chat was just doing
import { normalizeWhen, namedDate, parseAt } from '../../functions/src/timeFinder'
import { todayInStudio, addDays } from '../../functions/src/booking'

export type Helper = 'props' | 'time' | 'help'
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
  // How people really type (chat QA, Nov 6): "yo can i shoot tmrw at 3", "whats free", "5:30", "around 5", "midnight", "right now".
  String.raw`\b(right now|rn|midnight)\b`, String.raw`^\s*now\s*\??\s*$`, String.raw`^\s*with \w+\s*\??$`, String.raw`^\s*(2371|2375)\s*$`, String.raw`\b(at|around|after|before) (\d{1,2}|noon)\b`, String.raw`\b\d{1,2}:\d\d\b`, String.raw`\b\d{1,2} ?ish\b`,
  String.raw`\b(can i|could i|i wanna|i want to|wanna|gonna|need to|lemme|let me) (shoot|film|record|book)\b`,
  String.raw`\bwhat'?s? (free|open|available)\b`, String.raw`\bfree (at|on|today|tomorrow|tonight)\b`,
].join('|'), 'i')
// A message that's only a time ("5", "7?", "5pm").
const BARE_TIME = /^\s*\d{1,2}(:\d\d)?\s*(am|pm|ish)?\s*\??\s*$/i
const NOT_WHEN = /\b(last night|yesterday|last week|ago)\b/i
// Only means "when" if the chat is already about times ("evenings only", "anything earlier?").
const TIME_WEAK = /\b(mornings?|afternoons?|evenings?|nights?|weekends?|earlier|later|sooner|just me|only me|either house|other house)\b/i
// Clearly about WHAT: props, costumes, a video idea or a scene.
const PROPS_STRONG = /\b(props?|costumes?|wardrobe|outfits?|masks?|set dressing|gear|camera|lights?|video|skit|prank|sketch|scene|idea|parody|episode|theme|vibe|spookier|funnier|scarier|something for)\b/i
// "my next shoot", "my Saturday shoot", "the shoot on Oct 27", "the 27th shoot"
const SHOOT_REF = /\b(my|the|our|this|that)\s+(\w+\s+){0,3}shoot\b|\bshoot (on|for) /i

// "How do I…?" about the app itself (owner, Oct 28: the AI also helps people find their way). A question about how
// or where, with no specific day, time or length in it ("how do I book a shoot?" yes; "can I book Friday at 3?" no:
// that's a time search), and not a prop idea.
const HELP_START = /^\s*(how (do|can|should|would) (i|we|you)|how to|how does|how is|where (is|are|do|can|does)|what (is|are|does|do|happens)|can i|is there|why (can'?t|cant|is|does|did|do)|i can'?t|i cant|i don'?t (know|see|understand)|help( me)?\b|what'?s the)/i
const SPECIFIC = /\d|\b(today|tomorrow|tonight|this week|next week|this weekend|next weekend|asap|soonest|earliest)\b/i
const IDEA = /\b(props? for|ideas? for|my video|a video|skit|prank|sketch|scene|parody|costume for|something for)\b/i
export function isHelpQuestion(t: string) {
  return HELP_START.test(t) && !SPECIFIC.test(t) && !DAY_RE.test(t) && !IDEA.test(t)
}

function words(t: string) { return t.trim().split(/\s+/).filter(Boolean).length }

// Which booked shoot does the message point at (by a date, a weekday, or "next")? A date or weekday that matches none of
// your shoots points at nothing (audit, Nov 5: "cancel my shoot on the 19th" picked the 12th).
export const namesADay = (text: string) => { const t = normalizeWhen(text); return DAY_RE.test(t) || /\b(today|tonight|tomorrow)\b/.test(t) || !!namedDate(text, todayInStudio()) }
// loose: a bare day is enough ("cancel friday"); otherwise the message must be about a shoot ("my Friday shoot"), so
// "filming Friday with Kyle" stays a time search.
export function findShoot(text: string, shoots: RouteShoot[], loose = false): string | undefined {
  if (!shoots.length || (!loose && !SHOOT_REF.test(text))) return undefined
  const t = normalizeWhen(text), today = todayInStudio()
  const day = t.match(DAY_RE)
  const wd = day ? DAYS.findIndex(d => d.startsWith(day[1].slice(0, 3))) : -1
  const onWeekday = (s: RouteShoot) => wd < 0 || new Date(s.date + 'T12:00:00').getDay() === wd
  // A date first ("Thursday the 19th" = the 19th; "11/19", "nov 19"), then today / tomorrow, then a weekday.
  const date = namedDate(text, today)
  if (date === 'bad') return undefined
  if (date) {
    const d = Number(date.slice(8)), m = date.slice(5, 7)
    // "the 19th" with no month: whichever of your shoots falls on a 19th.
    const monthSaid = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{1,2}\/\d{1,2}/.test(t)
    return shoots.find(s => Number(s.date.slice(8)) === d && (!monthSaid || s.date.slice(5, 7) === m) && onWeekday(s))?.id
  }
  if (/\b(today|tonight)\b/.test(t)) return shoots.find(s => s.date === today)?.id
  if (/\btomorrow\b/.test(t)) return shoots.find(s => s.date === addDays(today, 1))?.id
  if (wd >= 0) return shoots.find(onWeekday)?.id   // the soonest one on that weekday
  if (!SHOOT_REF.test(text)) return undefined
  if (/\bnext shoot\b|\bmy shoot\b|\bupcoming shoot\b/.test(t)) return shoots[0].id
  return undefined
}

export function routeMessage(text: string, ctx: { last: Helper | null; shoots: RouteShoot[] }): Route {
  const t = text.trim()
  if (isHelpQuestion(t)) return { helpers: ['help'] }
  const booking = /\b(book|slots?|available|availability|find (me )?(a |some )?(time|slot)|when can)\b/i.test(t)
  // A booked shoot named in the message: props for it (unless they're asking to book another time).
  // "props for saturday" / "costume for tmrw": the shoot on that day, when there is one.
  const shootId = booking ? undefined : findShoot(t, ctx.shoots) ?? (/\b(props?|costumes?|wardrobe|outfits?)\b/i.test(t) && namesADay(t) ? findShoot(t, ctx.shoots, true) : undefined)
  if (shootId) return { helpers: ['props'], shootId }
  // A weak time word counts when the chat is about times, or in a short message with nothing about props.
  const n = normalizeWhen(t)
  const weak = (TIME_WEAK.test(t) || (/^\s*(me and|w\/)\s+[a-z]+/i.test(t) && words(t) <= 5)) && (ctx.last === 'time' || (!PROPS_STRONG.test(t) && words(t) <= 6))
  const time = !NOT_WHEN.test(t) && (TIME_STRONG.test(n) || BARE_TIME.test(t) || !!namedDate(t, todayInStudio()) || weak)
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

// ── Things the chat does by itself, without the AI (owner, Nov 2: "type what you want, it gets done") ──
const CANCEL = /\b(cancel|withdraw|call (it )?off|can'?t make (it|my)|cant make (it|my)|not filming|delete my (shoot|booking)|drop (my|the) (shoot|booking|slot)|can'?t (come|do it|film|go) (anymore|tomorrow|today|tonight|on)|won'?t make it|not gonna make it|something came up|gotta cancel|(i'?m|im) sick)\b/i
/** "cancel my thursday shoot" → which shoot (undefined = ask which). Null = not a cancel. */
export function cancelIntent(text: string, shoots: RouteShoot[]): { shootId?: string } | null {
  const t = text.trim()
  if (!CANCEL.test(t) || isHelpQuestion(t) && /^\s*how\b/i.test(t)) return null
  // A day or date names the shoot; "my next shoot" / "my shoot" (only one) = the soonest; otherwise ask which.
  // A day or date that matches none of your shoots: ask which (never the wrong one).
  if (namesADay(t)) { const id = findShoot(t, shoots.filter(Boolean), true); return id ? { shootId: id } : {} }
  if (/\bnext (shoot|booking)\b/i.test(t) && shoots.length) return { shootId: shoots[0].id }
  return shoots.length === 1 && !DAY_RE.test(t) ? { shootId: shoots[0].id } : {}
}
const STATUS = /\b(is (it|my \w+( shoot| booking)?) (approved|confirmed|booked)|approved yet|status|my (next )?(shoots?|bookings?)|what('?s| is) (my next|coming up|booked|on my schedule)|when('?s| is) my (next )?shoot|did (it|my \w+) get approved|what do i have( booked| coming up)?|when am i (filming|shooting|booked)|did (they|maanik|someone|anyone) approve|any news)\b|^\s*approved\s*\??\s*$/i
/** "is my shoot approved?", "what's my next shoot?" → answered from your own shoots. Not "add a couch to my shoot". */
export const isStatusQuestion = (text: string) => STATUS.test(text) && !CANCEL.test(text) && !/\b(book|find|props?|add|remove|change|put|move|drop)\b/i.test(text)

// ── More things the chat does by itself (owner, Nov 3: "the chat is so important… cover so many edge cases… flexible
// enough to understand nuance and guide people in the right direction"). Plain word rules, no AI, unit-tested.
// Order matters: the first match wins. Anything that isn't one of these goes to the AI helpers (props / time / help).
export type Intent = 'greeting' | 'thanks' | 'ack' | 'confirm' | 'return' | 'take-gear' | 'report' | 'pickup' | 'move' | 'swap' | 'offsite' | 'strikes' | 'requests'
  | 'checkin' | 'done' | 'late' | 'access' | 'house' | 'upset' | 'whoami' | 'capabilities'
const GEAR_WORD = /\b(gear|camera|cam|fx3|fx ?30|a7s?|sony|kit|case|lens|lights?|mic|microphone|tripod|drone|batter(y|ies)|charger|stand|gimbal|rig)\b/i
const PROP_WORD = /\b(props?|costumes?|wardrobe|bin|stuff|things|everything|it all)\b/i
const RETURN = /\b(return(ing|ed)?|bring(ing)? (it |them |everything |the \w+ )?back|brought (it |them |everything |the \w+ |all )?back|drop(ping|ped)? (it |them |everything |the \w+ )?off|done with (the |my )?(gear|camera|props|kit|case|stuff|everything)|giving (it |them )?back|put (it |them )?back)\b/i
const TAKE = /\b(tak(e|ing)|grab(bing)?|check(ing)? ?out|pick(ing)? up|need|borrow(ing)?|get(ting)?)\b/i
const REPORT = /\b(broke|broken|cracked|damaged?|doesn'?t work|doesnt work|not working|won'?t (turn on|charge|work)|dead|missing|lost|can'?t find|scratched|smashed|stole|stolen|ripped|torn|stained|leaking|faulty)\b/i
const PICKUP = /\b(are my props ready|props (ready|packed)|pick(ing)? up (my |the )?props|collect(ing)? (my |the )?props|where (are|is) my props)\b|^\s*pick ?up\s*\??\s*$/i
const MOVE = /\b(move|reschedule|change (the |my )?(time|day|date|slot)|push (it|my shoot|back)|switch (the |my )?(time|day)|different (time|day))\b/i
const SWAP = /\bswap|trade (slots?|shoots?|with)\b/i
const OFFSITE = /\b(offsite|off-site|off site|on location|outside the house|somewhere else|at (the |a )?(park|beach|mall|school|studio|downtown|office|restaurant|street|gym)|not at (the )?(house|cliff))\b/i
const STRIKES = /\b(strikes?|am i paused|paused\??$|penalt(y|ies)|blocked from|why can'?t i (book|request) props)\b/i
const REQUESTS = /\b(my requests?|what did i (ask|request)|where('?s| is| are) my (gear|request)|status of my (props|gear|request))\b/i
// "yo what's up", "hey how's it going" (owner, Nov 4) count too.
const GREETING = /^\s*((hi+|hey+y*|hello+|helo|yo+|sup|hiya|heya|wassup|whats? ?up|what's up|howdy|gm|good (morning|afternoon|evening))\b[\s,!.?]*)+((what'?s ?up|wassup|how'?s it going|how are (you|u)|how r u|how you doing|man|bro|dude|guys|there|anyone there|you there)\b[\s,!.?]*)*$/i
const THANKS = /^\s*(thanks?|thank (you|u)|thx|ty|tysm|cheers|appreciate (it|you))\b[\s!.,a-z]{0,12}$/i
// Nothing to do: "ok", "nvm", "k", "cool", "no", "wait".
const ACK = /^\s*((actually|oh|ok|okay|nah|umm*|uh+|wait),?\s+)?(ok(ay)?|k+|cool|kool|nice|great|awesome|perfect|sounds good|got it|gotcha|alright|aight|word|bet|fine|nvm|never ?mind|nevermind|forget (it|that|about it)|scratch that|leave it|stop|no worries|nah|no|nope|not now|wait|hold on|one sec|1 sec|hmm+|lol|lmao|haha+|👍|🙏|👌)\s*[!.]*$/i
// "yes", "book it", "do it", "that one": only means something right after the chat showed something to tap.
const CONFIRM = /^\s*(y(es|ea|eah|ep|up|s)|sure|ok(ay)? (do it|book it|go)|do it|book it|book that|go ahead|confirm|let'?s do it|lets go|send it|that one|this one|that works|works for me|perfect,? book it|yes,? (book|do|please)[a-z ]*)\s*[!.]*$/i
const CHECKIN = /^\s*((i'?m|im|we'?re|were) (here|at the house|at cliff ?[12]?|outside|on (my|our) way in)|just (got here|got in|arrived)|arrived|checking in|check ?in|check me in|i'?m in)\b/i
const DONE = /^\s*((i'?m|im|we'?re|were|all) (done|finished)( filming| shooting)?|done( filming| shooting)?|finished( filming| shooting)?|wrapp?ed|that'?s a wrap|it'?s a wrap|wrap( it)?( up)?|we wrapped)\b/i
const LATE = /\b((i'?m|im|i will be|i'?ll be|gonna be|going to be|running|we'?re|were) (\d+ ?(min(ute)?s?|mins?) )?late|stuck in traffic|be there in \d+|behind schedule|late for my shoot)\b/i
const ACCESS = /\b(door code|gate code|the code|lock ?box|keys?|locked out|(house|door|gate) is locked|can'?t get in|cant get in|let me in|buzz (me|us) in|nobody'?s? (here|there))\b/i
const HOUSE = /\b(toilet|bathroom|shower|wi-?fi|internet|power (is )?(out|off)|no power|heat(ing)?|a\/c|air ?con|water|leak(ing)?|(house|place|kitchen|room) is (a mess|dirty|messy|trashed)|garbage|trash everywhere|smells?|parking|neighbou?rs?)\b/i
const UPSET = /\b(sucks|useless|hate (this|it|you)|stupid|dumb|wtf|fuck\w*|f u|annoying|ridiculous|not fair|unfair|bullshit|bs|trash app|garbage app|worst)\b|\bf\*+(?!\w)|\bsh\*t/i
const WHOAMI = /\b(are (you|u) (a )?(bot|robot|real|human|person|ai|chatgpt|gpt)|who (are|r) (you|u)|is this (a )?(bot|real person|human|ai))\b/i
const CAPABILITIES = /^\s*(what (can|do) (you|u) (do|help with)|what are (you|u) for|options|menu|commands|what now|what can i (do|ask))\s*\??\s*$/i

// Something wrong with the APP itself (owner, Nov 5: bug reports), not with gear or props: "the app is broken",
// "found a bug", "it keeps crashing", "blank screen". Answered with the "Report a problem" button, no AI needed.
const APP_BUG = /\bnothing (works|is working|loads|is loading)\b|\b(bugs?|buggy|glitch(y|es|ing)?|crash(ed|es|ing)?|froze|frozen|freez(es|ing)|blank (screen|page)|white screen|black screen|error (message|pops?|keeps|says)|(app|page|screen|chat|button|it) (is |'s |keeps |won'?t |doesn'?t |isn'?t )?(broken|not working|not loading|stuck|load|loading|open|work|working|showing)|won'?t (load|open)|(something'?s?|something is) (wrong|off|weird) with (the |this )?app|report (a |an )?(bug|problem|issue)|logs? me out|can'?t see (my|the|any)\b)/i
export function isAppBug(text: string): boolean {
  const t = text.trim()
  if (!t || /^\s*how\b/i.test(t)) return false
  // Broken gear or props is the "report" intent (it goes to the team), not an app problem.
  if (/\b(broke|broken|damaged|missing|lost)\b/i.test(t) && (GEAR_WORD.test(t) || PROP_WORD.test(t)) && !/\b(app|screen|page|button|chat)\b/i.test(t)) return false
  return APP_BUG.test(t)
}

export function detectIntent(text: string): Intent | null {
  const t = text.trim()
  if (!t) return null
  if (GREETING.test(t)) return 'greeting'
  if (THANKS.test(t)) return 'thanks'
  if (CONFIRM.test(t)) return 'confirm'
  if (ACK.test(t)) return 'ack'
  if (WHOAMI.test(t)) return 'whoami'
  if (CAPABILITIES.test(t)) return 'capabilities'
  if (/^\s*how\b/i.test(t)) return null   // "how do I return gear?" = a help question
  // On the day (chat QA, Nov 6): "im here", "running late", "we're done", "what's the door code".
  if (CHECKIN.test(t) && words(t) <= 8) return 'checkin'
  if (DONE.test(t) && words(t) <= 10 && !RETURN.test(t)) return 'done'
  if (LATE.test(t) && !/\b(props?|gear|return)\b/i.test(t)) return 'late'
  const idea = /\b(props?|costumes?|idea|video|skit|scene|prank|sketch|character|episode)\b/i.test(t)
  if (ACCESS.test(t) && !GEAR_WORD.test(t) && !idea) return 'access'
  if (HOUSE.test(t) && !GEAR_WORD.test(t) && !idea) return 'house'
  if (UPSET.test(t) && words(t) <= 12 && !idea) return 'upset'
  if (PICKUP.test(t)) return 'pickup'
  // Something they have that broke ("i broke the lamp", "the chair broke"), short, and not a video idea.
  if (REPORT.test(t) && (GEAR_WORD.test(t) || PROP_WORD.test(t) || /\b(it|piece|thing|the|my|a)\b/i.test(t)) && words(t) <= 12 && !/\b(something for|props for|idea|video|skit|scene|prank)\b/i.test(t)) return 'report'
  if (RETURN.test(t) && !/\bprops? for\b/i.test(t)) return 'return'
  if (STRIKES.test(t)) return 'strikes'
  if (REQUESTS.test(t)) return 'requests'
  if (SWAP.test(t)) return 'swap'
  if (MOVE.test(t) && (/\b(shoot|booking|slot|it|my)\b/i.test(t) || /^\s*reschedule\b/i.test(t)) && !/\bprops?\b/i.test(t)) return 'move'
  // "can i do 7 instead", "cancel saturday and book sunday instead": change the time of an existing shoot.
  if (/\binstead\b/i.test(t) && (namesADay(t) || parseAt(t) !== null || /\b\d{1,2}\b/.test(t) || /\bcliff\b/i.test(normalizeWhen(t))) && !/\bprops?\b/i.test(t)) return 'move'
  if (/^\s*(switch|move|change) (it |my shoot |the shoot )?(to|over to) (cliff ?[12]|c[12]|the other house|cliff (one|two))\b/i.test(t)) return 'move'
  // Gear: taking it, or trying to book/reserve it ahead ("reserve the drone", "camera for tomorrow", or just "gear").
  if (GEAR_WORD.test(t) && (TAKE.test(t) || /\b(book|reserve|rent|hold)\b/i.test(t) || /\bfor (today|tomorrow|tmrw|tonight|my shoot|the shoot|(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?)\b/i.test(t))
    && !/\b(slot|house|cliff|props? for|idea|video|skit|prank)\b/i.test(t) && words(t) <= 12) return 'take-gear'
  if (/^\s*(the )?gear\s*\??\s*$/i.test(t)) return 'take-gear'
  if (OFFSITE.test(t) && !/\bprops? for\b/i.test(t)) return 'offsite'
  return null
}

// ── Just a day or a time (chat QA, Nov 6, real-AI run: "next sat" got "you're filming Nov 14", "the 31st" got "the calendar
// only goes to Nov 19") ── a message that is nothing but when ("next sat", "nov 14", "5:30", "tmrw @ 7", "the 31st", "asap",
// "cliff 2 tomorrow at 3") goes straight to the time finder, which reads dates exactly and shows the real free times.
const WHEN_WORD = /\b(today|tonight|tomorrow|tmrw|weekend|asap|now|next week|this week|morning|afternoon|evening|night|noon|midnight)\b/
const WHEN_FILLER = /\b(next|this|on|at|around|after|before|by|from|the|a|an|in|any|anything|time|slot|please|pls|plz|ish|or|and|book|me|can|i|get|free|what about|how about|maybe|like|right|cliff ?[12]|today|tonight|tomorrow|weekend|asap|now|week|morning|afternoon|evening|night|noon|midnight|am|pm|of|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?|\d{1,2}\/\d{1,2}|\d{1,2}(:\d\d)?\s*(am|pm|a|p)|\d{1,2}(:\d\d)?(st|nd|rd|th|h)?)\b/g
export function isJustWhen(text: string): boolean {
  const t = normalizeWhen(text).replace(/[?!.,@]/g, ' ').trim()
  if (!t || words(t) > 8 || /^\d{1,2}$/.test(t)) return false   // a bare "5" could mean anything
  const says = DAY_RE.test(t) || WHEN_WORD.test(t) || !!namedDate(text, todayInStudio()) || parseAt(text) !== null
  return says && !t.replace(WHEN_FILLER, ' ').trim()
}

// ── Typing instead of tapping (chat QA, Nov 6) ──
// After the chat shows free times, people type "yes book it", "the 5pm one", "the second one", "cliff 2 one" instead of tapping
// Book. The AI never sees those cards, so the app reads it here. Returns the option they meant, 'which' when "yes" doesn't say
// which of several, or null when it isn't about the times shown (e.g. "what about sunday" = a new search).
export interface ShownOption { date: string; place: string; start: number }
export function pickOption(text: string, options: ShownOption[]): { index: number } | { which: number[] } | null {
  if (!options.length) return null
  const t = normalizeWhen(text).trim()
  if (words(t) > 10) return null
  const yes = CONFIRM.test(text) || /^\s*(ok(ay)?|perfect|great|cool|sounds good)\s*[,!.]?\s*(book|that|do|take)/i.test(text)
  const ord = /\b(first|1st|top)\b/.test(t) ? 0 : /\b(second|2nd)\b/.test(t) ? 1 : /\b(third|3rd)\b/.test(t) ? 2 : /\b(fourth|4th)\b/.test(t) ? 3 : /\blast\b/.test(t) ? options.length - 1 : -1
  if (ord >= 0 && /\b(one|option|slot|time|book|that|the|take)\b/.test(t) && ord < options.length) return { index: ord }
  let pool = options.map((o, i) => ({ o, i }))
  const at = parseAt(text)
  const house = /\bcliff ?1\b/.test(t) ? 'cliff1' : /\bcliff ?2\b/.test(t) ? 'cliff2' : ''
  const date = namedDate(text, todayInStudio())
  const dayM = t.match(DAY_RE)
  const wd = dayM ? DAYS.findIndex(d => d.startsWith(dayM[1].slice(0, 3))) : -1
  const said = at !== null || !!house || (date && date !== 'bad') || wd >= 0
  if (at !== null) pool = pool.filter(x => x.o.start === at)
  if (house) pool = pool.filter(x => x.o.place === house)
  if (date && date !== 'bad') pool = pool.filter(x => x.o.date === date)
  if (wd >= 0) pool = pool.filter(x => new Date(`${x.o.date}T12:00:00`).getDay() === wd)
  // It names one of the times shown, and reads like picking it ("the 5pm one", "cliff 2 at 7", "yes saturday").
  // …or it's nothing but the time itself ("cliff 2 at 5", "saturday 7pm").
  const residual = t.replace(/\b(cliff ?[12]|at|on|the|one|a|for|\d{1,2}(:\d\d)?|am|pm|ish|around|today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|please|pls|plz)\b|[?!.,]/g, '').trim()
  const picky = yes || /\b(one|that|book|take|do|works?|grab|want|please|pls|plz|ok|yes|yeah)\b/.test(t) || words(t) <= 3 || !residual
  if (said) return !picky || !pool.length ? null : pool.length === 1 ? { index: pool[0].i } : { which: pool.map(x => x.i) }
  if (yes) return options.length === 1 ? { index: 0 } : { which: options.map((_, i) => i) }
  return null
}
