// One AI helper for the whole app (owner, Oct 19: "like YouTube Studio's AI button"). Any screen can open the same
// chat with useAssistant().open(); 'props' or 'time' starts it on that helper, 'plan' walks through a whole shoot
// (time → props → gear → review), nothing shows the choices.
// The chat stays alive while the app is open, so closing and reopening keeps the conversation.
// Props-only creators: always the props helper, never a shoot (the server refuses everything else for them anyway).
import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from 'react'
import { useSession } from './auth'

export type AssistantMode = 'props' | 'time' | 'plan'
const Assistant = lazy(() => import('./components/Assistant'))

const Ctx = createContext<{ open: (mode?: AssistantMode, shootId?: string) => void; available: boolean }>({ open: () => {}, available: false })
export const useAssistant = () => useContext(Ctx)

export function AssistantProvider({ children }: { children: ReactNode }) {
  // Props-only (demo) creators get the chat too (owner, Oct 28), in its locked "prop ideas only" form (see Assistant).
  const { canBook, demo } = useSession()
  const allowed = canBook || demo
  const [shown, setShown] = useState(false)
  const [started, setStarted] = useState(false)
  // Each open() asks for a mode; the counter lets the chat notice a new request even for the same mode.
  const [ask, setAsk] = useState<{ mode?: AssistantMode; shootId?: string; n: number }>({ n: 0 })
  // shootId (with 'plan'): plan an already-booked shoot, starting at its props.
  const open = (mode?: AssistantMode, shootId?: string) => { setAsk(a => ({ mode, shootId, n: a.n + 1 })); setStarted(true); setShown(true) }
  return (
    <Ctx.Provider value={{ open: (m, id) => open(demo ? 'props' : m, demo ? undefined : id), available: allowed }}>
      {children}
      {allowed && started && (
        <Suspense fallback={null}>
          <Assistant key={demo ? 'demo' : 'full'} shown={shown} ask={ask} onClose={() => setShown(false)} />
        </Suspense>
      )}
    </Ctx.Provider>
  )
}
