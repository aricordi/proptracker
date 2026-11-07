// One AI helper for the whole app (owner, Oct 19: "like YouTube Studio's AI button"). Any screen can open the same
// chat with useAssistant().open(); 'props' or 'time' starts it on that helper, 'plan' walks through a whole shoot
// (time → props → gear → review), nothing shows the choices.
// The chat stays alive while the app is open, so closing and reopening keeps the conversation.
// Props-only creators: always the props helper, never a shoot (the server refuses everything else for them anyway).
//
// CHAT FIRST (owner, Nov 2: "the creator app becomes a chat… type what you want, it gets done"): for people who film
// (creators on the full app, and the owner) the chat IS the home tab. The same chat lives in one DOM box that is moved
// into the Chat tab when it's open (ChatHome), so the conversation survives switching tabs; ✦ AI buttons elsewhere just
// go to the Chat tab and ask it for that helper.
import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSession } from './auth'

export type AssistantMode = 'props' | 'time' | 'plan'
const Assistant = lazy(() => import('./components/Assistant'))

interface Ask { mode?: AssistantMode; shootId?: string; text?: string; n: number }
const Ctx = createContext<{ open: (mode?: AssistantMode, shootId?: string, text?: string) => void; available: boolean; chatFirst: boolean; host: HTMLDivElement | null }>(
  { open: () => {}, available: false, chatFirst: false, host: null })
export const useAssistant = () => useContext(Ctx)

/** People who film on the full app get the chat as their home tab. */
export const isChatFirst = (s: { canBook: boolean; demo: boolean }) => s.canBook && !s.demo

export function AssistantProvider({ children }: { children: ReactNode }) {
  // Props-only (demo) creators get the chat too (owner, Oct 28), in its locked "prop ideas only" form (see Assistant).
  // Staff who don't film (arts, equipment, admins) get it too, as a "how do I…?" guide only (owner, Oct 28).
  const session = useSession()
  const { canBook, demo, role } = session
  const chatFirst = isChatFirst(session)
  const navigate = useNavigate()
  // Chat first: the chat is "shown" only while the Chat tab is open, so leaving it stops the microphone (audit, Nov 7).
  const onChatTab = useLocation().pathname === '/'
  const variant = canBook ? 'full' : demo ? 'demo' : `help-${role}`
  // Keyed by person too: the practice site's Switch signs straight from one person to the next without unmounting,
  // so a fresh chat (and its remembered turns) must start for the new person (review, Nov 7).
  const chatKey = `${variant}-${session.profile.email}`
  const [shown, setShown] = useState(false)
  const [started, setStarted] = useState(chatFirst)
  // Each open() asks for a mode; the counter lets the chat notice a new request even for the same mode.
  const [ask, setAsk] = useState<Ask>({ n: 0 })
  // The chat's own box (chat-first): parked off screen until the Chat tab takes it in.
  const host = useMemo(() => { if (typeof document === 'undefined') return null; const d = document.createElement('div'); d.className = 'h-full'; return d }, [])
  useEffect(() => { if (chatFirst) setStarted(true) }, [chatFirst])
  useEffect(() => { setShown(false) }, [session.profile.email])
  // shootId (with 'plan'): plan an already-booked shoot, starting at its props. text: send this message straight away.
  const open = (mode?: AssistantMode, shootId?: string, text?: string) => {
    const m = demo ? 'props' : mode, id = demo ? undefined : shootId
    setAsk(a => ({ mode: m, shootId: id, text, n: a.n + 1 })); setStarted(true)
    if (chatFirst) navigate('/')
    else setShown(true)
  }
  return (
    <Ctx.Provider value={{ open, available: true, chatFirst, host }}>
      {children}
      {started && (chatFirst && host
        ? createPortal(<Suspense fallback={null}><Assistant key={chatKey} page shown={onChatTab} ask={ask} onClose={() => navigate('/')} /></Suspense>, host)
        : !chatFirst && <Suspense fallback={null}><Assistant key={chatKey} shown={shown} ask={ask} onClose={() => setShown(false)} /></Suspense>)}
    </Ctx.Provider>
  )
}

/** The Chat tab: takes in the chat's box while it's on screen. */
export function ChatHome() {
  const { host } = useAssistant()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !host) return
    el.appendChild(host)
    return () => { if (host.parentElement === el) el.removeChild(host) }
  }, [host])
  return <div ref={ref} className="h-full" />
}
