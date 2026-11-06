// "Test the AI chat" (Nov 6): sends a list of realistic, messy messages to the PRACTICE site's real chat brain (askChat) and
// prints what it decided (action, reply, shoot, query), then follows "times" with the time finder and "props" with the prop
// finder like the app does. Practice project only (the workflow refuses the live one). Signs in as practice creators.
// Usage: node chat_qa.mjs <projectId> <webApiKey> <cases.json> [filter]
import { readFileSync } from 'node:fs'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const [PID, API_KEY, CASES, FILTER] = process.argv.slice(2)
if (!PID || PID === 'proptracker-9732e') { console.error('Practice project only.'); process.exit(1) }
initializeApp({ credential: applicationDefault(), projectId: PID })
const BASE = `https://northamerica-northeast1-${PID}.cloudfunctions.net`

const PEOPLE = ['creator@example.com', 'jana@example.com', 'newbie@example.com', 'kyle@example.com']
const tokens = {}
async function idToken(email) {
  if (tokens[email] && tokens[email].exp > Date.now()) return tokens[email].t
  const auth = getAuth()
  const u = await auth.getUserByEmail(email).catch(() => auth.createUser({ email, emailVerified: true }))
  const custom = await auth.createCustomToken(u.uid)
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) })
  const j = await r.json()
  if (!j.idToken) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(j).slice(0, 200)}`)
  tokens[email] = { t: j.idToken, exp: Date.now() + 50 * 60000 }
  return j.idToken
}
async function call(name, data, email) {
  const r = await fetch(`${BASE}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken(email)}` }, body: JSON.stringify({ data }) })
  const j = await r.json().catch(() => ({}))
  if (j.error) return { error: `${j.error.status}: ${j.error.message}` }
  return j.result
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Dates relative to today (Toronto).
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())
const add = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const label = (d, place, time) => `${new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${place} · ${time}`
const STATES = {
  normal: { shoots: [{ id: 'shA', label: label(add(today, 1), 'Cliff 1', '1 PM–3 PM'), status: 'booked' }, { id: 'shB', label: label(add(today, 6), 'Cliff 2', '5 PM–7 PM'), status: 'requested' }], out: { props: 0, gear: [] } },
  none: { shoots: [], out: { props: 0, gear: [] } },
  filming: { shoots: [{ id: 'shN', label: label(today, 'Cliff 1', '1 PM–3 PM'), status: 'checked-in' }], out: { props: 0, gear: ['Sony FX3 kit'] } },
  out: { shoots: [{ id: 'shA', label: label(add(today, 3), 'Cliff 2', '3 PM–5 PM'), status: 'booked' }], out: { props: 1, gear: ['Sony A7S III kit #1'] } },
  paused: { shoots: [], out: { props: 0, gear: [] }, paused: add(today, 9), strikes: 2 },
  planTime: { shoots: [], out: { props: 0, gear: [] }, plan: { step: 'time' } },
  planProps: { shoots: [{ id: 'shA', label: label(add(today, 5), 'Cliff 1', '5 PM–7 PM'), status: 'requested' }], out: { props: 0, gear: [] }, plan: { step: 'props', shoot: 'shA' } },
}

const cases = JSON.parse(readFileSync(CASES, 'utf8')).filter(c => !FILTER || c.group === FILTER || c.msg.includes(FILTER))
console.log(`Today ${today}. ${cases.length} messages.\n`)
let i = 0, fallbacks = 0, errors = 0, flagged = 0
const RED_FLAGS = /first shoot of the (month|week)|all set|locked in|is booked|you'?re booked|been (booked|cancelled|sent|moved|approved|reported)|i'?m (not a bot|human|a real person|a person)|not quite a bot|far from it|door code is|wi-?fi (password|reset)|reset the router|replacement|we wrap up|houses close|too late for (the|our) houses|\bsh[A-Z]\b|right back at (you|ya)|love you too|we(?:'ve| have) (got )?(a few|plenty|some|several|definitely)/gi
const tally = {}
for (const c of cases) {
  const email = PEOPLE[i++ % PEOPLE.length]
  const state = STATES[c.state ?? 'normal']
  const t = await call('askChat', { message: c.msg, history: c.history ?? [], state }, email)
  let line = `#${i} [${c.group}] "${c.msg}"${c.history?.length ? ` (after: ${c.history.map(h => `${h.who}:${h.text.slice(0, 40)}`).join(' / ')})` : ''} state=${c.state ?? 'normal'}\n`
  if (!t || t.error) { errors++; line += `   ERROR ${t?.error}\n` }
  else if (t.fallback) { fallbacks++; line += `   FALLBACK (no AI answer)\n` }
  else {
    tally[t.action] = (tally[t.action] ?? 0) + 1
    const ok = !c.expect || c.expect.split('|').includes(t.action)
    // Things the chat must never say (chat QA, Nov 6): made-up facts, "done" claims, pretending to be human, internal ids.
    const bad = (t.reply.match(RED_FLAGS) ?? []).map(x => x.toLowerCase())
    if (bad.length) flagged++
    line += `   ${ok ? '' : `✗ expected ${c.expect} · `}${bad.length ? `⚠ SAID "${[...new Set(bad)].join('", "')}" · ` : ''}action=${t.action}${t.shoot ? ` shoot=${t.shoot}` : ''}${t.query ? ` query="${t.query}"` : ''}${t.also ? ` also=${t.also.action}:"${t.also.query}"` : ''}\n   reply: ${t.reply.replace(/\n/g, ' ⏎ ')}\n${t.chips?.length ? `   chips: ${t.chips.join(' | ')}\n` : ''}${t.steps?.length ? `   steps: ${t.steps.join(' > ')}\n` : ''}`
    if (t.action === 'times' && c.follow !== false) {
      await sleep(1500)
      const f = await call('askForTime', { text: t.query || c.msg }, email)
      line += f?.error ? `   times ERROR ${f.error}\n` : `   → times: ${f.ask.from}..${f.ask.to} ${f.ask.houses.join('+')} ${f.ask.timeOfDay}${f.ask.at !== undefined ? ` at ${f.ask.at}` : ''} people[${f.ask.people.join(',')}] slots ${f.ask.mySlots} → ${f.options.length} options${f.options[0] ? ` (first ${f.options[0].date} ${f.options[0].place} ${f.options[0].start})` : ''} · "${f.reply}"${f.notice ? ` · notice: "${f.notice}"` : ''}\n`
    }
    if (t.action === 'props' && c.follow) {
      await sleep(1500)
      const f = await call('ideaToProps', { idea: t.query || c.msg }, email)
      line += f?.error ? `   props ERROR ${f.error}\n` : `   → props: ${f.groups.map(g => `${g.title}: ${g.picks.map(p => p.name).join(', ')}`).join(' | ').slice(0, 400)}${f.missing?.length ? ` · missing: ${f.missing.map(m => m.name).join(', ')}` : ''}${f.note ? ` · note: ${f.note}` : ''}\n`
    }
  }
  console.log(line)
  await sleep(2200)
}
console.log(`\nDone. ${cases.length} messages, ${fallbacks} without an AI answer, ${errors} errors, ${flagged} replies with a red-flag phrase. Actions: ${JSON.stringify(tally)}`)
if (fallbacks === cases.length) console.log('Every answer was a fallback: the practice site has no real AI key (GEMINI_API_KEY is the placeholder).')
