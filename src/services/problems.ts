// Report a problem on gear or props you have out (owner, Nov 3: in the chat, any time).
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
export const reportProblem = httpsCallable<{ kind: 'gear' | 'props'; id: string; name?: string; note: string }, { ok: boolean }>(functions, 'reportProblem')
