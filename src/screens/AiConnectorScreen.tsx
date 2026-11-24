// Me → ChatGPT & Claude (owner, Nov 24): how to add Prime Capitol to your AI assistant, and the ones you've connected.
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { CONNECTOR_URL, myConnectors, disconnectConnector, reviewerAccount, type Connection } from '../services/connector'
import { useSession } from '../auth'
import { friendlyError } from '../lib/errors'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

const ago = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : ''

export default function AiConnectorScreen() {
  const [list, setList] = useState<Connection[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const load = () => myConnectors({}).then(r => setList(r.data.connections)).catch(e => setError(friendlyError(e)))
  useEffect(() => { load() }, [])
  const copy = async () => { try { await navigator.clipboard.writeText(CONNECTOR_URL); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* shown below */ } }
  const off = async (id: string) => { try { await disconnectConnector({ id }); load() } catch (e) { setError(friendlyError(e)) } }
  return (
    <div className="pb-24">
      <PageHeader title="ChatGPT & Claude" sub="Use Prime Capitol by chatting with your AI" />
      <div className="px-4 space-y-5 max-w-xl">
        <section className="bg-pt-surface rounded-[20px] shadow-card p-5 space-y-3">
          <h2 className="text-[18px] font-semibold">Your link</h2>
          <div className="flex gap-2 items-center">
            <code className="flex-1 min-w-0 truncate bg-black/40 rounded-xl px-3 py-3 text-[15px]">{CONNECTOR_URL}</code>
            <button onClick={copy} className="min-h-[44px] px-4 rounded-xl bg-pt-accent text-stone-900 font-semibold">{copied ? 'Copied ✓' : 'Copy'}</button>
          </div>
          <p className="text-pt-muted text-[14px]">Then ask it things like "find me props for a haunted diner", "book Cliff 1 Thursday 5:15 to 7:15 with Kyle" or "is my shoot approved?". It asks before booking anything.</p>
        </section>
        <section className="bg-pt-surface rounded-[20px] shadow-card p-5 space-y-2">
          <h2 className="text-[18px] font-semibold">ChatGPT</h2>
          <ol className="list-decimal pl-5 space-y-1 text-[15px]">
            <li>On chatgpt.com, open <b>Plugins</b> in the sidebar, tap <b>+</b>, then <b>Add custom MCP server</b>.</li>
            <li>Name it <b>Prime Capitol</b>, paste the link, choose <b>OAuth</b>, and save.</li>
            <li>Sign in with your Google account and tap <b>Allow</b>.</li>
            <li>In a chat, pick <b>Prime Capitol</b> from the + menu (or just ask).</li>
          </ol>
          <p className="text-pt-muted text-[13px]">For now this needs a paid ChatGPT plan and works in typed chat. Once Prime Capitol is approved in ChatGPT's app list, everyone can add it in one tap and talk to it by voice.</p>
        </section>
        <section className="bg-pt-surface rounded-[20px] shadow-card p-5 space-y-2">
          <h2 className="text-[18px] font-semibold">Claude</h2>
          <ol className="list-decimal pl-5 space-y-1 text-[15px]">
            <li>On claude.ai, open <b>Settings → Connectors</b> and tap <b>Add custom connector</b>.</li>
            <li>Name it <b>Prime Capitol</b>, paste the link, and add it.</li>
            <li>Tap <b>Connect</b>, sign in with Google and tap <b>Allow</b>.</li>
          </ol>
          <p className="text-pt-muted text-[13px]">Works in the Claude app on your phone too once it's added.</p>
        </section>
        <section className="space-y-2">
          <h2 className="text-[18px] font-semibold px-1">Connected</h2>
          {list === null && !error && <p className="text-pt-muted px-1">Loading…</p>}
          {list?.length === 0 && <p className="text-pt-muted px-1">Nothing connected yet.</p>}
          {list?.map(c => (
            <div key={c.id} className="bg-pt-surface rounded-[20px] shadow-card px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0"><div className="font-semibold">{c.assistant}</div><div className="text-pt-muted text-[13px]">Connected {ago(c.connectedAt)} · last used {ago(c.lastUsed)}</div></div>
              <button onClick={() => off(c.id)} className="min-h-[44px] px-4 rounded-xl bg-white/10">Disconnect</button>
            </div>
          ))}
          {error && <p className="text-amber-300 text-sm px-1">{error}</p>}
        </section>
        <SuggestionsCard />
        <ReviewerCard />
      </div>
    </div>
  )
}

// Owner only (Nov 24): the demo account OpenAI's reviewers need to test the app. It only sees a practice copy of the studio.
function ReviewerCard() {
  const { realRole } = useSession()
  const [st, setSt] = useState<{ enabled: boolean; email?: string; password?: string; createdAt?: string } | null>(null)
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  useEffect(() => { if (realRole === 'owner') reviewerAccount({ action: 'status' }).then(r => setSt(r.data)).catch(e => setErr(friendlyError(e))) }, [realRole])
  if (realRole !== 'owner') return null
  const run = async (action: 'create' | 'disable') => { setBusy(true); setErr(''); try { setSt((await reviewerAccount({ action })).data) } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) } }
  return (
    <section className="bg-pt-surface rounded-[20px] shadow-card p-4 space-y-2">
      <h2 className="text-[18px] font-semibold">Demo account for app review</h2>
      <p className="text-pt-muted text-[14px]">OpenAI's reviewers need a login to test Prime Capitol in ChatGPT. This account signs in on the ChatGPT sign-in page ("App reviewer? Use the demo account") and only sees a practice copy of the studio: the real props, made-up people and bookings. Nothing it does reaches the team, the schedule or the calendars.</p>
      {st?.password && <div className="rounded-xl bg-pt-bg p-3 text-[14px] space-y-1"><div>Email: <b className="select-all">{st.email}</b></div><div>Password: <b className="select-all">{st.password}</b></div><p className="text-amber-200 text-xs">Copy it now: the password is only shown once. Paste both into OpenAI's form.</p></div>}
      {st && !st.password && <p className="text-[14px]">{st.enabled ? <>On · {st.email}{st.createdAt ? ` · made ${ago(st.createdAt)}` : ''}</> : 'Off'}</p>}
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => run('create')} className="flex-1 min-h-[44px] rounded-xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40">{st?.enabled ? 'Make a new password' : 'Turn on'}</button>
        {st?.enabled && <button disabled={busy} onClick={() => run('disable')} className="flex-1 min-h-[44px] rounded-xl bg-white/10 disabled:opacity-40">Turn off</button>}
      </div>
      {err && <p className="text-amber-300 text-sm">{err}</p>}
    </section>
  )
}

// Anonymous suggestions (owner, Nov 24; OpenAI: disclosed + under the person's control). On by default; off = nothing is saved.
function SuggestionsCard() {
  const { profile } = useSession()
  const [value, setValue] = useState(true)
  const [err, setErr] = useState('')
  // Private to this person (connector_prefs/{email}); missing = on.
  useEffect(() => { getDoc(doc(db, 'connector_prefs', profile.email)).then(s => setValue(s.get('shareSuggestions') !== false)).catch(() => 0) }, [profile.email])
  const flip = async () => {
    const next = !value
    setValue(next); setErr('')
    try { await setDoc(doc(db, 'connector_prefs', profile.email), { shareSuggestions: next, updatedAt: new Date().toISOString() }) } catch (e) { setValue(!next); setErr(friendlyError(e)) }
  }
  return (
    <section className="bg-pt-surface rounded-[20px] shadow-card p-5 space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-[18px] font-semibold">Share anonymous suggestions</h2>
          <p className="text-pt-muted text-[14px] mt-1">When you ask your AI for something the app can't do yet (a feature, a prop we don't have), it can offer to pass a few words on to the team so they know what to add. It only does it if you say yes, and your name is never attached.</p>
        </div>
        <button role="switch" aria-checked={value} aria-label="Share anonymous suggestions" onClick={flip}
          className={`shrink-0 w-[52px] h-[32px] rounded-full relative transition-colors ${value ? 'bg-pt-accent' : 'bg-white/15'}`}>
          <span className={`absolute top-[3px] w-[26px] h-[26px] rounded-full bg-white shadow transition-[left] ${value ? 'left-[23px]' : 'left-[3px]'}`} />
        </button>
      </div>
      {err && <p className="text-amber-300 text-sm">{err}</p>}
    </section>
  )
}
