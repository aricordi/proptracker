// Owner only: "Calendar & email" (owner, Oct 28: "the shared Google Calendar flow and email flow is confusing").
// ONE page, three steps, top to bottom, each showing whether it's done:
//   1 connect the Prime Capitol Google account (one-time Google Cloud setup folded away inside it),
//   2 link the calendars: the APP's own calendar (the app writes every booking/block there, one colour per place) and,
//     read only, the old calendars the team still uses (owner, Oct 30) whose events wait on the import screen,
//   3 turn on emails (sent from that same account).
// The old pages still exist for the rare extras: /google (IT details), /email (recent emails, other email services).
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { friendlyError } from '../lib/errors'
import { useScheduleSettings, saveScheduleSettings, testCalendarLink, errorText, oldCalendarFor, defaultTitleStyle, type CalendarFeed } from '../services/schedule'
import { subscribeToEmailSettings, saveEmailSettings, sendTestEmail, EMPTY_EMAIL_SETTINGS, type EmailSettings } from '../services/email'
import { cleanClientId, cleanSecret } from '../../functions/src/googleLink'
import { PageHeader } from '../components/PageHeader'

interface Status {
  redirectUri: string; clientId: string; secret: string; server: string
  connected: { email: string; calendar: boolean; gmail: boolean; connectedAt: string; connectedBy: string; broken: string } | null
}
const googleAccountStatus = httpsCallable<Record<string, never>, Status>(functions, 'googleAccountStatus')

const saveGoogleClient = httpsCallable<{ clientId: string; clientSecret: string }, { ok: boolean }>(functions, 'saveGoogleClient')
const googleConnectStart = httpsCallable<{ origin: string; loginHint?: string }, { url: string }>(functions, 'googleConnectStart')
const previewCalendarImport = httpsCallable<Record<string, never>, { events: { calendar?: string; kind: string }[]; calendars: { name: string; title: string; found: number; hidden: number; error?: string }[] }>(functions, 'previewCalendarImport', { timeout: 130_000 })
const checkCalendarAccess = httpsCallable<Record<string, never>, { account: string; calendars: { id: string; name: string; role: string; canWrite: boolean; error?: string }[] }>(functions, 'checkCalendarAccess', { timeout: 70_000 })
const googleDisconnect = httpsCallable<Record<string, never>, { ok: boolean }>(functions, 'googleDisconnect')

const PROJECT = 'proptracker-9732e'
const CONSENT = `https://console.cloud.google.com/apis/credentials/consent?project=${PROJECT}`
const CREDENTIALS = `https://console.cloud.google.com/apis/credentials?project=${PROJECT}`
const GMAIL_API = `https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=${PROJECT}`
const CAL_API = `https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=${PROJECT}`
const BACK_ERRORS: Record<string, string> = {
  expired: 'That sign-in took too long. Tap Connect again.',
  access_denied: 'Sign-in was cancelled on Google\'s page.',
  no_refresh: 'Google didn\'t give a lasting connection. Tap Connect again.',
  admin_policy_enforced: 'Prime Capitol\'s Google admin blocks this app. Send IT the note at the bottom of step 1.',
}

export default function ConnectionsScreen() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [s, setS] = useState<Status | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState('')
  const back = params.get('connected'), backErr = params.get('error')
  const load = () => googleAccountStatus({}).then(r => setS(r.data)).catch(e => setErr(friendlyError(e)))
  useEffect(() => { load() }, [])
  useEffect(() => { if (back || backErr) { const t = setTimeout(() => setParams({}, { replace: true }), 8000); return () => clearTimeout(t) } }, [back, backErr, setParams])

  // Step 1 bits.
  const [clientId, setClientId] = useState(''), [secret, setSecret] = useState(''), [hint, setHint] = useState('')
  useEffect(() => { if (s?.clientId) setClientId(c => c || s.clientId) }, [s?.clientId])
  // Step 2 bits.
  const sched = useScheduleSettings()
  const [calId, setCalId] = useState('')
  useEffect(() => { setCalId(sched.googleCalendarId ?? '') }, [sched.googleCalendarId])
  const [calMsg, setCalMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [feeds, setFeeds] = useState<CalendarFeed[]>([])
  const feedsKey = JSON.stringify(sched.calendarFeeds ?? [])
  useEffect(() => { setFeeds(sched.calendarFeeds ?? []) }, [feedsKey])   // eslint-disable-line react-hooks/exhaustive-deps
  const feedsChanged = JSON.stringify(feeds.filter(f => f.id)) !== feedsKey
  const [feedMsg, setFeedMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Writing app bookings into the old calendars (owner, Nov 16): who can write where, as Google says.
  const [access, setAccess] = useState<Record<string, { canWrite: boolean; role: string; error?: string }> | null>(null)
  const [writeMsg, setWriteMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function checkAccess() {
    setBusy('access'); setWriteMsg(null)
    try {
      const r = (await checkCalendarAccess({})).data
      setAccess(Object.fromEntries(r.calendars.map(x => [x.id, x])))
      const bad = r.calendars.filter(x => !x.canWrite && x.id !== sched.googleCalendarId)
      setWriteMsg(bad.length ? { ok: false, text: `${bad.map(x => x.name).join(', ')}: the app can only read ${bad.length === 1 ? 'it' : 'them'}. Share with ${r.account || 'the account'} as "Make changes to events", wait a minute, check again.` }
        : { ok: true, text: 'The app can write to every old calendar ✓' })
    } catch (e) { setWriteMsg({ ok: false, text: errorText(e) }) } finally { setBusy('') }
  }
  async function setWriteOld(on: boolean) {
    setBusy('write'); setWriteMsg(null)
    try {
      await saveScheduleSettings({ ...sched, writeOldCalendars: on })
      setWriteMsg({ ok: true, text: on ? 'On ✓ New and changed app bookings go into the old calendars now; bookings already on the schedule are added over the next few checks (every 15 minutes).' : 'Off. Nothing more is written to the old calendars (what is already there stays).' })
    } catch (e) { setWriteMsg({ ok: false, text: errorText(e) }) } finally { setBusy('') }
  }
  // Step 3 bits.
  const [mail, setMail] = useState<EmailSettings>(EMPTY_EMAIL_SETTINGS)
  const [from, setFrom] = useState(''), [name, setName] = useState('')
  const [mailMsg, setMailMsg] = useState('')
  useEffect(() => subscribeToEmailSettings(m => { setMail(m); setFrom(m.service === 'google' ? m.fromAddress : ''); setName(m.fromName) }), [])

  const c = s?.connected
  const setupDone = !!s?.clientId && !!s?.secret
  const accountOk = !!c && !c.broken
  const calendarOk = accountOk && c!.calendar && !!sched.googleCalendarId
  const mailOk = accountOk && c!.gmail && mail.enabled && mail.service === 'google'

  async function run(what: string, f: () => Promise<unknown>, after?: () => void) {
    setBusy(what); setErr('')
    try { await f(); after?.() } catch (e) { setErr(friendlyError(e)) } finally { setBusy('') }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(''), 1500) } catch { /* shown anyway */ } }
  async function connect() {
    setBusy('connect'); setErr('')
    try { window.location.href = (await googleConnectStart({ origin: window.location.origin, loginHint: hint || undefined })).data.url }
    catch (e) { setErr(friendlyError(e)); setBusy('') }
  }
  async function linkCalendar() {
    setBusy('cal'); setCalMsg(null)
    try {
      if (calId !== (sched.googleCalendarId ?? '')) await saveScheduleSettings({ ...sched, googleCalendarId: calId })
      await testCalendarLink({})
      setCalMsg({ ok: true, text: 'Linked ✓ The app just added and removed a test event.' })
    } catch (e) {
      const t = errorText(e)
      setCalMsg({ ok: false, text: /has not been used|SERVICE_DISABLED|disabled/i.test(t) ? 'The Google Calendar API is off. Turn it on (link above), wait a minute, then try again.'
        : /404|notFound|Not Found/i.test(t) ? 'That calendar ID wasn\'t found. Copy it again from the calendar\'s settings.'
        : /403|401|share/i.test(t) ? `The calendar isn't shared with ${c?.email ?? 'the account'} yet (or not with "Make changes to events"). Share it, wait a minute, then try again.` : t })
    } finally { setBusy('') }
  }
  // Old calendars: save the list, then read them once (read only) to show they work.
  async function saveFeeds() {
    setBusy('feeds'); setFeedMsg(null)
    try {
      // A title without {name} isn't kept (the server would drop it too): the default for that kind of calendar is used.
      const list = feeds.filter(f => f.id.trim()).map(({ titleStyle, ...f }) => ({ ...f, id: f.id.trim(), name: f.name.trim() || 'Old calendar', ...(titleStyle?.includes('{name}') ? { titleStyle: titleStyle.trim() } : {}) }))
      setFeeds(list)
      await saveScheduleSettings({ ...sched, calendarFeeds: list })
      if (!list.length) { setFeedMsg({ ok: true, text: 'Saved. No old calendars are read.' }); return }
      const r = (await previewCalendarImport({})).data
      const fresh = (n: string) => r.events.filter(e => e.calendar === n && e.kind === 'new').length
      // Per calendar: Google's own name for it (spots a wrong ID), what's coming up, and what's hidden (time off, birthdays).
      const who = c?.email ?? 'the account'
      const lines = r.calendars.filter(c => c.name !== 'App calendar').map(c => {
        const google = c.title && c.title !== c.name ? ` (Google calls it "${c.title}")` : ''
        // Couldn't be read (wrong ID, not shared): the other calendars are still followed; this one is skipped until fixed.
        if (c.error) return `${c.name}: couldn't read it. Check the ID and that it's shared with ${who} ("See all event details"). The other calendars still work.`
        if (!c.found) return `${c.name}${google}: nothing in the next 4 months. If it should have events, check the ID is this calendar's.`
        return `${c.name}${google}: ${c.found} event${c.found === 1 ? '' : 's'} in the next 4 months, ${fresh(c.name)} to check${c.hidden ? `, ${c.hidden} time off / birthdays hidden` : ''}.`
      })
      const bad = r.calendars.some(c => c.error && c.name !== 'App calendar')
      setFeedMsg({ ok: !bad, text: `${bad ? 'Saved, but one calendar needs a look.' : 'Read ✓'} ${lines.join(' ')}` })
    } catch (e) { setFeedMsg({ ok: false, text: `${errorText(e)} Share each calendar with ${c?.email ?? 'the account'} ("See all event details"), wait a minute, then try again.` }) }
    finally { setBusy('') }
  }
  async function saveMail(enabled: boolean) {
    setBusy('mail'); setMailMsg('')
    try {
      await saveEmailSettings({ ...mail, enabled, service: 'google', fromAddress: from.trim(), fromName: name.trim() || 'Prime Capitol', appUrl: mail.appUrl || window.location.origin })
      setMailMsg(enabled ? 'Emails are on ✓' : 'Emails are off.')
    } catch { setMailMsg('Couldn\'t save. Try again.') } finally { setBusy('') }
  }

  const card = 'bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3'
  const field = 'w-full bg-pt-bg rounded-xl px-3 py-2.5 text-pt-text placeholder-pt-muted shadow-hairline focus:outline-none'
  const btn = 'bg-pt-accent text-stone-900 font-semibold rounded-xl px-4 min-h-[44px] text-sm disabled:opacity-40'
  const quiet = 'bg-pt-bg rounded-xl px-4 min-h-[44px] text-pt-text text-sm font-medium disabled:opacity-40'
  const copyBox = (text: string) => (
    // The link and its Copy pill side by side: Copy used to run on straight after the text.
    <div className="flex items-center gap-2 bg-pt-bg rounded-xl pl-3 pr-1.5 py-1.5">
      <span className="flex-1 min-w-0 text-[13px] text-pt-text break-all">{text}</span>
      <button onClick={() => copy(text)} className="shrink-0 min-h-[40px] px-4 rounded-full bg-pt-surface shadow-hairline text-pt-accent text-[14px] font-semibold">{copied === text ? 'Copied ✓' : 'Copy'}</button>
    </div>
  )
  const head = (n: number, done: boolean, title: string, sub: string) => (
    <div className="flex items-start gap-3">
      <span className={`w-8 h-8 rounded-full grid place-items-center text-sm font-bold shrink-0 ${done ? 'bg-green-500/20 text-green-400' : 'bg-pt-accent/20 text-pt-accent'}`}>{done ? '✓' : n}</span>
      <div className="min-w-0"><h2 className="text-pt-text font-semibold text-[17px]">{title}</h2><p className="text-pt-muted text-[13px]">{sub}</p></div>
    </div>
  )
  const sub = (l: string, body: React.ReactNode) => <div className="flex gap-2"><span className="text-pt-accent text-sm font-semibold w-4 shrink-0">{l}</span><div className="flex-1 min-w-0 space-y-2 text-[13px] text-pt-muted">{body}</div></div>

  return (
    <div className="min-h-full bg-pt-bg pb-8">
      <PageHeader title="Calendar & email" />
      <div className="px-4 pt-2 space-y-5">
        <p className="text-pt-muted text-sm">The app uses <b className="text-pt-text">one Prime Capitol Google account</b> (like bookings@primecapitol.ca) for two jobs: putting shoots in your shared Google Calendar, and sending emails. Do these three steps once, top to bottom.</p>

        {/* Each step shows its state: a green tick when done, its number in a hollow circle when not. */}
        <div className="grid grid-cols-3 gap-2 text-[14px]">
          {([['Account', accountOk], ['Calendar', calendarOk], ['Emails', mailOk]] as const).map(([l, ok], i) => (
            <span key={l} className={`rounded-xl min-h-[44px] px-2 inline-flex items-center justify-center gap-2 font-semibold ${ok ? 'bg-green-500/15 text-green-400' : 'bg-pt-surface text-pt-muted'}`}>
              <span aria-hidden className={`w-5 h-5 rounded-full grid place-items-center text-[12px] font-bold ${ok ? 'bg-green-500 text-stone-900' : 'shadow-[inset_0_0_0_1.5px_currentColor]'}`}>{ok ? '✓' : i + 1}</span>{l}
            </span>
          ))}
        </div>

        {back && <p className="text-green-400 text-sm font-medium">Connected ✓</p>}
        {backErr && <p className="text-amber-300 text-sm">{BACK_ERRORS[backErr] ?? `Google said: ${backErr}. Try again.`}</p>}
        {err && <p className="text-amber-300 text-sm">{err}</p>}
        {!s && !err && <p className="text-pt-muted text-sm">Loading…</p>}

        {s && <>
          {/* 1 · The account */}
          <section className={card}>
            {head(1, accountOk, 'Connect the Prime Capitol Google account', accountOk ? `Connected as ${c!.email}` : 'Sign in once as the company account IT made (not your own Gmail).')}
            {c && (<>
              {c.broken && <p className="text-red-300 text-sm">{c.broken} Tap Connect again.</p>}
              {(!c.calendar || !c.gmail) && <p className="text-amber-300 text-xs">A box was unticked on Google's page ({!c.calendar ? 'calendar' : 'email'}). Tap Connect again and leave both ticked.</p>}
              <div className="flex gap-2">
                <button onClick={connect} disabled={!!busy || !setupDone} className={`flex-1 ${quiet}`}>{busy === 'connect' ? 'Opening Google…' : 'Connect again'}</button>
                <button onClick={() => { if (confirm('Disconnect? Calendar copies and emails stop until it is connected again.')) run('off', () => googleDisconnect({}), load) }} disabled={!!busy} className={`flex-1 ${quiet} text-red-300`}>Disconnect</button>
              </div>
            </>)}
            {!c && setupDone && (<>
              <input value={hint} onChange={e => setHint(e.target.value.trim())} placeholder="bookings@primecapitol.ca (optional)" className={field} autoCapitalize="none" type="email" aria-label="Company account email" />
              <button onClick={connect} disabled={!!busy} className={`w-full ${btn}`}>{busy === 'connect' ? 'Opening Google…' : 'Connect with Google'}</button>
              <p className="text-pt-muted text-xs">Google may say "Google hasn't verified this app": tap <b>Advanced → Go to Prime Capitol</b> (it's your own app). Leave both boxes ticked.</p>
            </>)}
            <details open={!setupDone} className="rounded-xl bg-pt-bg p-3">
              <summary className="text-pt-text text-sm font-medium">{setupDone ? 'One-time Google Cloud setup ✓' : 'First: one-time Google Cloud setup (about 10 minutes)'}</summary>
              <div className="space-y-3 mt-3">
                {sub('a', <><p>Open the <a href={CONSENT} target="_blank" rel="noreferrer" className="text-pt-accent">consent screen</a>: user type <b>External</b>, app name "Prime Capitol", your email, then tap <b>Publish app</b> (otherwise the connection stops after 7 days).</p></>)}
                {sub('b', <><p>Turn on the <a href={GMAIL_API} target="_blank" rel="noreferrer" className="text-pt-accent">Gmail API</a> and the <a href={CAL_API} target="_blank" rel="noreferrer" className="text-pt-accent">Calendar API</a> (tap Enable on each).</p></>)}
                {sub('c', <><p>In <a href={CREDENTIALS} target="_blank" rel="noreferrer" className="text-pt-accent">Credentials</a>: Create credentials → OAuth client ID → <b>Web application</b> → under "Authorized redirect URIs" add:</p>{copyBox(s.redirectUri)}</>)}
                {sub('d', <>
                  <p>Paste the client ID and the client secret (starts with <b>GOCSPX-</b>). Google shows the full secret only once, right after you create it. Missed it? Open the client and tap <b>Add secret</b>.</p>
                  <input value={clientId} onChange={e => setClientId(cleanClientId(e.target.value))} placeholder="1234-abc.apps.googleusercontent.com" className={field} autoCapitalize="none" aria-label="Client ID" />
                  <input value={secret} onChange={e => setSecret(cleanSecret(e.target.value))} placeholder={s.secret ? `Secret saved (${s.secret}) · paste to replace` : 'Client secret'} className={field} autoCapitalize="none" autoComplete="off" aria-label="Client secret" />
                  {/[*•]/.test(secret) && <p className="text-amber-300 text-sm">That's the hidden version of the secret (with dots or stars). Google only shows the full secret once. In the client's page tap <b>Add secret</b>, then tap the copy button next to the new one (it starts with GOCSPX-).</p>}
                  <button onClick={() => run('save', async () => { await saveGoogleClient({ clientId, clientSecret: secret }); setSecret('') }, load)}
                    disabled={!!busy || !clientId || (!secret && !s.secret) || (clientId === s.clientId && !secret) || /[*•]/.test(secret)} className={btn}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
                  <p className="text-xs">Kept on the server only. Phones never see the secret again.</p>
                </>)}
              </div>
            </details>
            <details className="text-xs text-pt-muted">
              <summary>Google says the admin blocks the app? (note for IT)</summary>
              <p className="mt-2">Admin console → Security → Access and data control → API controls → Manage third-party app access → Configure new app → paste the client ID → <b>Trusted</b>. To cut the app off any time: remove it there, suspend the account, or unshare the calendar.</p>
              {s.clientId && <div className="mt-2">{copyBox(s.clientId)}</div>}
            </details>
          </section>

          {/* 2 · The calendars */}
          <section className={`${card} ${accountOk ? '' : 'opacity-60'}`}>
            {head(2, calendarOk, 'Link the calendars', calendarOk ? 'Bookings go to the app calendar right away.' : 'One new calendar the app writes to, plus the old ones it reads.')}
            <p className="text-pt-text text-sm font-semibold">The app calendar</p>
            {sub('a', <><p>In Google Calendar, whoever should own it (e.g. your admin) makes a new calendar, like <b>"Prime Capitol Shoots"</b>, then ⋮ → <b>Settings and sharing</b> → Share with specific people → add this address with <b>"Make changes to events"</b>:</p>
              {c ? copyBox(c.email) : <p className="text-amber-300">Connect the account in step 1 first.</p>}</>)}
            {sub('b', <><p>Same settings page → Integrate calendar → copy the <b>Calendar ID</b> and paste it here:</p>
              <input value={calId} onChange={e => { setCalId(e.target.value.trim()); setCalMsg(null) }} placeholder="abc123@group.calendar.google.com" className={field} autoCapitalize="none" aria-label="App calendar ID" />
              <button onClick={linkCalendar} disabled={!!busy || !calId || !accountOk} className={btn}>{busy === 'cal' ? 'Checking…' : 'Save & test'}</button>
              {calMsg && <p className={`text-sm ${calMsg.ok ? 'text-green-400' : 'text-amber-300'}`}>{calMsg.text}</p>}</>)}
            <p className="text-pt-muted text-xs">Every booking, move, cancel and blocked time made in the app goes here, one colour per place (Cliff 1 yellow, Cliff 2 blue, offsite green, blocked grey, heads-up orange), with the props on each shoot. Share this one calendar with everyone who needs to see the schedule. Shoots and blocks from the old calendars are copied in too, in the same colours.</p>

            <div className="border-t border-pt-border pt-3 space-y-3">
              <p className="text-pt-text text-sm font-semibold">Old calendars</p>
              <p className="text-pt-muted text-[13px]">The calendars the team still uses until everyone is on the app. Share each with {c?.email ?? 'the account'} and paste its ID. The app reads them every 15 minutes and follows what's there. {sched.writeOldCalendars
                ? <>It also writes approved app bookings into them (share as <b>"Make changes to events"</b>).</>
                : <>To let it write app bookings into them too, share as <b>"Make changes to events"</b> and turn that on below.</>}</p>
              {feeds.map((f, i) => (
                <div key={i} className="bg-pt-bg rounded-xl p-3 space-y-2">
                  <div className="flex gap-2">
                    <input value={f.name} onChange={e => setFeeds(l => l.map((x, j) => j === i ? { ...x, name: e.target.value.slice(0, 40) } : x))} placeholder="Name, e.g. Cliff 2" className={`${field} bg-pt-surface`} aria-label="Calendar name" />
                    <button onClick={() => setFeeds(l => l.filter((_, j) => j !== i))} className="tap text-pt-muted text-sm px-2" aria-label="Remove this calendar">✕</button>
                  </div>
                  <input value={f.id} onChange={e => setFeeds(l => l.map((x, j) => j === i ? { ...x, id: e.target.value.trim() } : x))} placeholder="Calendar ID" className={`${field} bg-pt-surface`} autoCapitalize="none" aria-label="Calendar ID" />
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    {([['cliff1', `All ${sched.houses.cliff1.name}`], ['cliff2', `All ${sched.houses.cliff2.name}`], ['any', 'Mixed / not sure']] as const).map(([h, l]) => (
                      <button key={h} onClick={() => setFeeds(list => list.map((x, j) => j === i ? { ...x, house: h } : x))}
                        className={`min-h-[40px] rounded-lg py-2 ${f.house === h ? 'bg-pt-accent text-stone-900 font-semibold' : 'bg-pt-surface text-pt-muted'}`}>{l}</button>
                    ))}
                  </div>
                  <label className="block space-y-1"><span className="text-pt-muted text-xs">Title for app bookings written here ({'{name}'} = the creator)</span>
                    <input value={f.titleStyle ?? ''} onChange={e => setFeeds(l => l.map((x, j) => j === i ? { ...x, titleStyle: e.target.value.slice(0, 80) } : x))}
                      placeholder={defaultTitleStyle(f.house)} className={`${field} bg-pt-surface`} aria-label="Title for app bookings" /></label>
                  {access?.[f.id] && <p className={`text-xs ${access[f.id].canWrite ? 'text-green-400' : 'text-amber-300'}`}>{access[f.id].canWrite ? 'The app can write here ✓' : access[f.id].error ?? 'Read only: share as "Make changes to events"'}</p>}
                </div>
              ))}
              <div className="flex gap-2">
                {feeds.length < 6 && <button onClick={() => setFeeds(l => [...l, { id: '', name: '', house: 'any' }])} className={`flex-1 whitespace-nowrap ${quiet}`}>+ Add calendar</button>}
                <button onClick={saveFeeds} disabled={!!busy || !accountOk || (!feedsChanged && !feeds.length)} className={`flex-1 whitespace-nowrap ${btn}`}>{busy === 'feeds' ? 'Checking…' : 'Save & check'}</button>
              </div>
              {feedMsg && <p className={`text-sm ${feedMsg.ok ? 'text-green-400' : 'text-amber-300'}`}>{feedMsg.text}</p>}
            </div>
            {/* Owner, Nov 16: until everyone is on the app, app bookings go into the old calendars too. */}
            {feeds.some(f => f.id) && (
              <div className="border-t border-pt-border pt-3 space-y-3">
                <p className="text-pt-text text-sm font-semibold">Write app bookings into the old calendars</p>
                <p className="text-pt-muted text-[13px]">When a booking made in the app is approved, it's also added to the old calendar for its house, titled like the events people add by hand. Changes go both ways: move or delete it in any of the calendars, or in the app, and the newest change wins everywhere. A shoot that came from an old calendar and is moved or cancelled in the app is changed there too.</p>
                <ul className="text-[13px] text-pt-text space-y-1">
                  {(['cliff1', 'cliff2', 'offsite'] as const).map(pl => {
                    const t = oldCalendarFor({ calendarFeeds: feeds.filter(f => f.id), googleCalendarId: sched.googleCalendarId }, pl)
                    return <li key={pl}>{pl === 'offsite' ? 'Offsite' : sched.houses[pl].name} → {t ? <><b>{t.name || 'Old calendar'}</b>{pl === 'offsite' ? ' as "<name> - Offsite Filming"' : ''}</> : <span className="text-pt-muted">no calendar (set one to "{pl === 'offsite' ? `All ${sched.houses.cliff1.name}` : `All ${sched.houses[pl].name}`}")</span>}</li>
                  })}
                </ul>
                <div className="flex gap-2">
                  <button onClick={checkAccess} disabled={!!busy || !accountOk} className={`flex-1 ${quiet}`}>{busy === 'access' ? 'Checking…' : 'Check access'}</button>
                  <button onClick={() => setWriteOld(!sched.writeOldCalendars)} disabled={!!busy || !accountOk || feedsChanged} className={`flex-1 ${sched.writeOldCalendars ? quiet : btn}`}>
                    {busy === 'write' ? 'Saving…' : sched.writeOldCalendars ? 'Turn off' : 'Turn on'}</button>
                </div>
                <p className="text-xs text-pt-muted">{sched.writeOldCalendars ? 'On.' : 'Off.'}{feedsChanged ? ' Save the calendars above first.' : ''}</p>
                {writeMsg && <p className={`text-sm ${writeMsg.ok ? 'text-green-400' : 'text-amber-300'}`}>{writeMsg.text}</p>}
              </div>
            )}
            {/* Stacked: side by side they wrapped onto two lines inside 44px buttons. */}
            <div className="space-y-2 border-t border-pt-border pt-3">
              <button onClick={() => navigate('/schedule/import')} className={`w-full text-left flex items-center justify-between ${quiet}`}>Check old events <span className="text-pt-muted">›</span></button>
              <button onClick={() => navigate('/schedule/calendar')} className={`w-full text-left flex items-center justify-between ${quiet}`}>What the app added <span className="text-pt-muted">›</span></button>
            </div>
          </section>

          {/* 3 · Emails */}
          <section className={`${card} ${accountOk ? '' : 'opacity-60'}`}>
            {head(3, mailOk, 'Turn on emails', mailOk ? `Sent from ${mail.fromAddress || c!.email}.` : 'Booking updates, late notices and warnings, sent from the same account.')}
            <label className="block space-y-1"><span className="text-pt-muted text-[13px]">Sender name people see</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Prime Capitol" className={field} /></label>
            <details className="text-xs text-pt-muted">
              <summary>Send from another address (optional)</summary>
              <p className="mt-2">Leave empty to send from {c?.email ?? 'the account'}. To use an alias (like hello@…), first add it in that account's Gmail → Settings → Accounts → "Send mail as".</p>
              <input value={from} onChange={e => setFrom(e.target.value.trim())} placeholder={c?.email ?? 'the account itself'} className={`${field} mt-2`} autoCapitalize="none" aria-label="Send from" />
            </details>
            {mailOk
              ? <div className="flex gap-2">
                  <button onClick={() => saveMail(true)} disabled={!!busy} className={`flex-1 ${quiet}`}>Save changes</button>
                  <button onClick={() => saveMail(false)} disabled={!!busy} className={`flex-1 ${quiet} text-red-300`}>Turn emails off</button>
                </div>
              : <button onClick={() => saveMail(true)} disabled={!!busy || !accountOk || !c?.gmail} className={`w-full ${btn}`}>{busy === 'mail' ? 'Saving…' : 'Turn on emails'}</button>}
            {mailMsg && <p className="text-pt-muted text-sm">{mailMsg}</p>}
            {mailOk && <button onClick={() => { setMailMsg('Sending…'); sendTestEmail().then(() => setMailMsg('Test sent. Check your inbox (and spam).')).catch(() => setMailMsg('Couldn\'t send the test. Try again.')) }} className={`w-full ${quiet}`}>Send me a test email</button>}
            <Link to="/email" className="block text-pt-muted text-xs tap">Recent emails, or use another email service ›</Link>
          </section>
        </>}
      </div>
    </div>
  )
}
