// One AI helper for the whole app (owner, Oct 19: "like YouTube Studio's AI button"). Any screen can open the same
// chat with useAssistant().open(); 'props' or 'time' starts it on that helper, 'plan' walks through a whole shoot
// (time → props → gear → review), nothing shows the choices.
// The chat stays alive while the app is open, so closing and reopening keeps the conversation.
import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from 'react'
import { useSession } from './auth'

export type AssistantMode = 'props' | 'time' | 'plan'
const Assistant = lazy(() => import('./components/Assistant'))

const Ctx = createContext<{ open: (mode?: AssistantMode) => void; available: boolean }>({ open: () => {}, available: false })
export const useAssistant = () => useContext(Ctx)

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { canBook } = useSession()
  const [shown, setShown] = useState(false)
  const [started, setStarted] = useState(false)
  // Each open() asks for a mode; the counter lets the chat notice a new request even for the same mode.
  const [ask, setAsk] = useState<{ mode?: AssistantMode; n: number }>({ n: 0 })
  const open = (mode?: AssistantMode) => { setAsk(a => ({ mode, n: a.n + 1 })); setStarted(true); setShown(true) }
  return (
    <Ctx.Provider value={{ open, available: canBook }}>
      {children}
      {canBook && started && (
        <Suspense fallback={null}>
          <Assistant shown={shown} ask={ask} onClose={() => setShown(false)} />
        </Suspense>
      )}
    </Ctx.Provider>
  )
}
