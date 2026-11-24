// The ✦ AI button opens ChatGPT or Claude (owner, Nov 24, option A: "when they click AI, it takes them straight to the actual
// connector setup, or to ChatGPT, or to whatever they choose"). The smart work (finding props, times, planning) happens in
// the person's own ChatGPT/Claude through the Prime Capitol connector; the app's chat stays for "how do I…" questions.
//  • Not connected yet: the one-time setup (link + Copy + steps), with a button to open ChatGPT or Claude to add it.
//  • Connected: one big button opens the one they use, with the message already typed (ChatGPT ?q=, Claude ?q=).
// Anywhere in the app can call openAiLauncher(prompt?) — the sheet is mounted once (AiLauncherHost, in AssistantProvider).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BottomSheet from './BottomSheet'
import { CONNECTOR_URL, myConnectors } from '../services/connector'

export type AiApp = 'chatgpt' | 'claude'
const EVENT = 'pc:ai-launch'
const APP_KEY = 'pc.aiApp', CONNECTED_KEY = 'pc.aiConnected'
const ls = () => { try { return window.localStorage } catch { return null } }

/** Open the launcher, optionally with a message ready for ChatGPT/Claude. */
export function openAiLauncher(prompt?: string) { window.dispatchEvent(new CustomEvent(EVENT, { detail: { prompt: prompt ?? '' } })) }

/** The address that opens the assistant with the message typed in. */
export function aiAppUrl(app: AiApp, prompt: string) {
  const q = prompt.trim() ? encodeURIComponent(prompt.trim()) : ''
  return app === 'claude' ? `https://claude.ai/new${q ? `?q=${q}` : ''}` : `https://chatgpt.com/${q ? `?q=${q}` : ''}`
}
export const preferredAiApp = (): AiApp => (ls()?.getItem(APP_KEY) === 'claude' ? 'claude' : 'chatgpt')
export const aiAppName = (a: AiApp) => (a === 'claude' ? 'Claude' : 'ChatGPT')
/** Which assistants this phone knows are connected (refreshed every time the launcher opens). */
export function knownConnected(): AiApp[] {
  try { return (JSON.parse(ls()?.getItem(CONNECTED_KEY) ?? '[]') as AiApp[]).filter(a => a === 'chatgpt' || a === 'claude') } catch { return [] }
}
/** Open ChatGPT/Claude in a new tab (on a phone with the app installed, the app opens). Remembers the choice. */
export function goToAi(app: AiApp, prompt: string) {
  try { ls()?.setItem(APP_KEY, app) } catch { /* private mode */ }
  window.open(aiAppUrl(app, prompt), '_blank', 'noopener')
}

export function AiLauncherHost({ onHelp }: { onHelp: () => void }) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [connected, setConnected] = useState<AiApp[]>(knownConnected)
  const [checked, setChecked] = useState(false)
  const [copied, setCopied] = useState('')
  const navigate = useNavigate()
  useEffect(() => {
    const on = (e: Event) => { setPrompt(((e as CustomEvent).detail?.prompt as string) ?? ''); setCopied(''); setOpen(true) }
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  // Who is connected: from the server each time it opens (kept on the phone so the next open is instant).
  useEffect(() => {
    if (!open) return
    myConnectors({}).then(r => {
      const apps = [...new Set(r.data.connections.map(c => (/claude/i.test(c.assistant) ? 'claude' : /chatgpt|openai/i.test(c.assistant) ? 'chatgpt' : null)).filter((x): x is AiApp => !!x))]
      setConnected(apps); setChecked(true)
      try { ls()?.setItem(CONNECTED_KEY, JSON.stringify(apps)) } catch { /* private mode */ }
    }).catch(() => setChecked(true))
  }, [open])
  const pref = preferredAiApp()
  const order: AiApp[] = connected.length ? [...connected].sort(a => (a === pref ? -1 : 1)) : [pref, pref === 'chatgpt' ? 'claude' : 'chatgpt']
  const copy = async (what: string, label: string) => { try { await navigator.clipboard.writeText(what); setCopied(label) } catch { setCopied('') } }
  const ready = connected.length > 0
  return (
    <BottomSheet open={open} onClose={() => setOpen(false)}>
      <div className="space-y-4">
        <div>
          <h2 className="text-pt-text text-[22px] font-bold tracking-tight leading-tight">{ready ? 'Ask your AI' : 'Use Prime Capitol in ChatGPT or Claude'}</h2>
          <p className="text-pt-muted text-[14px] mt-1 leading-snug">{ready
            ? 'Props for a video idea, a time to film, your requests: just ask. It books and sends nothing without your OK.'
            : 'Set it up once (about 2 minutes). Then you can book times, find props and return things by just talking to it, by typing or by voice.'}</p>
        </div>
        {prompt && (
          <div className="rounded-2xl bg-white/[0.05] px-4 py-3">
            <p className="text-pt-muted text-[12px]">Your message (already typed in when it opens)</p>
            <p className="text-pt-text text-[15px] leading-snug mt-0.5">“{prompt}”</p>
            <button onClick={() => copy(prompt, 'msg')} className="mt-1.5 text-[13px] font-semibold text-pt-accent min-h-[32px]">{copied === 'msg' ? 'Copied ✓' : 'Copy message'}</button>
          </div>
        )}
        {!ready && (
          <ol className="rounded-2xl bg-pt-surface p-4 space-y-2.5 text-[15px] leading-snug">
            <li className="flex gap-3"><b className="w-6 h-6 shrink-0 rounded-full bg-pt-accent text-stone-900 grid place-items-center text-[13px]">1</b>
              <span className="min-w-0 flex-1">Copy your link<span className="flex gap-2 items-center mt-1.5"><code className="flex-1 min-w-0 truncate rounded-lg bg-black/40 px-2.5 py-2 text-[13px]">{CONNECTOR_URL}</code>
                <button onClick={() => copy(CONNECTOR_URL, 'link')} className="shrink-0 min-h-[40px] px-3 rounded-lg bg-pt-accent text-stone-900 text-[14px] font-semibold">{copied === 'link' ? 'Copied ✓' : 'Copy'}</button></span></span></li>
            <li className="flex gap-3"><b className="w-6 h-6 shrink-0 rounded-full bg-pt-accent text-stone-900 grid place-items-center text-[13px]">2</b>
              <span><b>ChatGPT:</b> Plugins → + → Add custom MCP server, paste it, choose OAuth. <b>Claude:</b> Settings → Connectors → Add custom connector.</span></li>
            <li className="flex gap-3"><b className="w-6 h-6 shrink-0 rounded-full bg-pt-accent text-stone-900 grid place-items-center text-[13px]">3</b>
              <span>Sign in with Google and tap <b>Allow</b>. Done.</span></li>
          </ol>
        )}
        <div className="space-y-2">
          {order.map((a, i) => (
            <button key={a} onClick={() => { goToAi(a, prompt); setOpen(false) }}
              className={`w-full min-h-[52px] rounded-2xl font-bold text-[16px] flex items-center justify-center gap-2 ${i === 0 ? 'bg-pt-accent text-stone-900 shadow-gold' : 'bg-pt-raised text-pt-text'}`}>
              Open {aiAppName(a)}{connected.includes(a) ? <span className={`text-[12px] font-semibold ${i === 0 ? 'text-stone-800' : 'text-emerald-300'}`}>· connected ✓</span> : ready ? null : <span className="text-[12px] font-medium opacity-70">· to add it</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 pt-1 text-[14px]">
          <button onClick={() => { setOpen(false); navigate('/connector') }} className="min-h-[44px] text-pt-muted">{ready ? 'Connections & settings' : 'Full steps with pictures'}</button>
          <button onClick={() => { setOpen(false); onHelp() }} className="min-h-[44px] font-semibold text-pt-accent">How does the app work?</button>
        </div>
        {!checked && !ready && <p className="text-pt-muted text-[12px]">Checking if you're already connected…</p>}
      </div>
    </BottomSheet>
  )
}
