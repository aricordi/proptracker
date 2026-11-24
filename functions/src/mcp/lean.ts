// ─── What ChatGPT / Claude read on every turn, kept short (owner, Nov 24) ─────────────────────────────────────────────
// ChatGPT (especially voice mode) re-reads the instructions + every tool definition before each answer: ~40k characters made
// it slow to start talking. The tools themselves still enforce every rule (they refuse or ask), so the descriptions only say
// what each tool is for and the few things the assistant must do. Nothing here changes what a tool can do.
// The long descriptions stay in tools.ts / more.ts / gear.ts (they are the reference for people reading the code).

export const SHORT: Record<string, string> = {
  note_feature_request: 'Pass on an anonymous suggestion when they want something the studio doesn\'t offer. Ask first; only call after they say yes. A few words, no names.',
  get_context: 'Call ONCE at the start: who they are, now, the next 14 days with weekdays, their upcoming shoots (ids), open props requests, invites/swaps waiting, people they film with, short rules.',
  how_to: '"How do I / where do I / what happens if" questions about the app or studio, answered from the app\'s guide with a link.',
  search_props: 'Find props, costumes and set dressing in the closet (words + meaning). Several terms at once with `also`; `day` gives how many are free. Then show_props for pictures.',
  closet_list: 'The whole closet in a compact list, for substitutes and creative stand-ins the search misses. Pages of 400.',
  props_for_idea: 'Check what the closet has for a video idea: give concrete needs per scene; returns matches per need and what\'s missing (missing = custom props). Props only, no filming gear.',
  get_schedule: 'Raw schedule per day (≤21): bookings with names, blocks, heads-ups, offsite, and FREE stretches per house. Bookings: any quarter-hour start/end, 30 min to 2 h per person.',
  book_shoot: 'Book Cliff 1, Cliff 2 or offsite. Confirm first. Creators\' bookings are requests the team approves. 2 h per person; add collaborators in `with` for longer; people not on the app also go in `not_on_app` (after they confirm). Times HH:MM 24 h.',
  request_props: 'Send props for one of their shoots: items = prop ids + qty; custom = things to make or find (optional reference_image). Never promise a date for custom props (arts follows up). Confirm the list first.',
  my_status: 'What they have going on (next shoot, props to pick up/return, requests, invites, strikes). Only what exists. Say it in a sentence or two, never as a list.',
  get_shoot: 'One of their shoots in detail: place, hours, status, collaborators, who\'s in the video, props requests, props deadlines.',
  plan_shoot: 'Plan filming with other people: matches names (asks when unsure), 2 h each, finds back-to-back times free for all; if the day is full it offers alternatives. Books nothing: then book_shoot.',
  find_free_times: 'Ready-to-book times for this person: length, people, houses, time of day or a preferred start. Respects their locks and limits.',
  change_props_request: 'Change a props request still "requested": set quantities (0 removes, new ids add) and/or add custom props. Confirm first.',
  pick_up_props: 'At pick-up of a "packed & ready" request: sign that everything is there, or say what\'s missing. Ask them to check the bag first, confirm, then call.',
  return_props: 'Return a picked-up props request: needs ONE photo of everything taken now and attached in the chat, plus anything broken. Confirm first.',
  shoot_done: 'Record whether one of their shoots happened ("we wrapped", "it didn\'t happen"). From the shoot start to 48 h after.',
  invite_to_video: 'Tell people they\'re on camera in one of their shoots; each gets a notification to accept. Confirm first.',
  request_swap: 'Swap one of their approved house shoots with another creator\'s (same length). ONLY when they say they already agreed. Never with priority bookings. Confirm first.',
  app_link: 'Last resort: a link to one app screen, only for what can\'t be done here (guideline PDF, gear on the shoot day) or when they ask for the app.',
}

// Parameter hints: keep only the first sentence (the format hint), at most 80 characters.
function shortText(s: string, max = 80) {
  const first = s.split(/(?<=[.!?])\s+(?=[A-Z(])/)[0] ?? s
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first
}
export function leanSchema(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(leanSchema)
  if (!x || typeof x !== 'object') return x
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    out[k] = k === 'description' && typeof v === 'string' ? shortText(v) : leanSchema(v)
  }
  return out
}
export const leanDescription = (name: string, full: string) => SHORT[name] ?? full
