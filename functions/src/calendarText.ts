// Reading old Google Calendar events (pure, shared with tests): which house they're at, and which aren't about filming.
import type { House } from './schedule.js'

// Which house an event is at, from its address or name (owner, Oct 30: "check what address the events say":
// 2375 Cliff = Cliff 1, 2371 Cliff = Cliff 2). null = it doesn't say.
export function houseFromText(text: string): House | null {
  const t = text.toLowerCase()
  if (/\b2371\b/.test(t) || /cliff\s*(#\s*)?(2|two|ii)\b/.test(t)) return 'cliff2'
  if (/\b2375\b/.test(t) || /cliff\s*(#\s*)?(1|one|i)\b/.test(t)) return 'cliff1'
  return null
}

// Events that aren't about filming (owner, Oct 30: "Valentyna away Nov 14 all day… useless"; birthdays are tracked in
// the app, not on the schedule). Hidden from the import unless they name a house. Returns why, or ''.
export function ignoreReason(e: { title: string; location: string; eventType?: string }) {
  const text = `${e.title} ${e.location}`
  if (houseFromText(text)) return ''
  if (e.eventType === 'birthday' || /\b(birthday|bday|b-day)\b|🎂/i.test(text)) return 'Birthday'
  if (e.eventType === 'outOfOffice' || /\b(away|ooo|out of (the )?office|vacation|vacay|holiday|holidays|day off|days off|off work|sick|pto|leave)\b/i.test(text)) return 'Someone away'
  if (e.eventType === 'workingLocation' || e.eventType === 'focusTime') return 'Not a booking'
  return ''
}

