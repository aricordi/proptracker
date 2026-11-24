// Me → ChatGPT & Claude (owner, Nov 24): how to add Prime Capitol to your AI assistant, and the ones you've connected.
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { CONNECTOR_URL, myConnectors, disconnectConnector, type Connection } from '../services/connector'
import { friendlyError } from '../lib/errors'

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
            <li>On chatgpt.com, open <b>Settings → Apps</b> (turn on <b>Developer mode</b> under Advanced if you don't see "Create").</li>
            <li>Tap <b>Create</b>, name it <b>Prime Capitol</b>, paste the link, choose <b>OAuth</b>, and save.</li>
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
      </div>
    </div>
  )
}
