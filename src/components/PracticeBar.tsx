// PRACTICE SITE strip (owner, Nov 3): only on the separate practice copy of the app (built with VITE_PRACTICE=1). Shows who
// you are right now and lets you switch to any practice person, for real (the server signs you in as them), so every team's
// screens and rules can be tried end to end. Nothing here can reach the real app: it's a different project and database.
import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { signInWithCustomToken } from 'firebase/auth'
import { auth, functions } from '../firebase'
import { useSession } from '../auth'
import BottomSheet from './BottomSheet'
import { friendlyError } from '../lib/errors'

export const IS_PRACTICE = import.meta.env.VITE_PRACTICE === '1'

interface Person { email: string; name: string; role: string; access?: string }
const practiceSwitch = httpsCallable<{ list?: boolean; email?: string }, { people?: Person[]; token?: string }>(functions, 'practiceSwitch')

const WHAT: Record<string, string> = {
  owner: 'Everything: Team tab, settings, analytics',
  creator: 'Chat, Calendar, Props: books shoots, asks for props, takes gear',
  arts: 'Props queue: pack, hand over, check in',
  equipment: 'Requests to approve, gear log, schedule',
  admin: 'Dashboard, creators, flags, approvals',
}
const roleLabel = (p: Person) => p.role === 'creator' ? (p.access === 'full' ? 'Creator' : 'Creator · Props only') : p.role === 'equipment' ? 'Equipment team' : p.role === 'arts' ? 'Arts department' : p.role === 'admin' ? 'Admin' : 'Owner'

export default function PracticeBar() {
  const { profile, role } = useSession()
  const [open, setOpen] = useState(false)
  const [people, setPeople] = useState<Person[] | null>(null)
  const [busy, setBusy] = useState(''), [err, setErr] = useState('')
  if (!IS_PRACTICE) return null
  async function show() {
    setOpen(true); setErr('')
    try { setPeople((await practiceSwitch({ list: true })).data.people ?? []) } catch (e) { setErr(friendlyError(e)) }
  }
  async function become(p: Person) {
    setBusy(p.email); setErr('')
    try {
      const { token } = (await practiceSwitch({ email: p.email })).data
      await signInWithCustomToken(auth, token!)
      window.location.assign('/')   // a clean start as that person
    } catch (e) { setErr(friendlyError(e)); setBusy('') }
  }
  return (
    <>
      <div className="bg-orange-500 text-stone-950 pt-safe">
        <div className="flex items-center justify-center gap-2 px-3 py-1 text-xs font-semibold">
          <span className="truncate">Practice site · You're {profile.name || profile.email} ({role})</span>
          <button onClick={show} className="shrink-0 bg-stone-950/20 rounded-full px-3 py-0.5 active:opacity-70">Switch</button>
        </div>
      </div>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Practice as…">
        <p className="text-pt-muted text-[13px] mb-3">This is the practice copy: real props, pretend people. Nothing here books anything, notifies anyone or touches the real app.</p>
        {err && <p className="text-red-300 text-sm mb-2">{err}</p>}
        {!people && !err && <p className="text-pt-muted text-sm">Loading…</p>}
        <div className="rounded-[20px] bg-pt-surface overflow-hidden divide-y divide-white/[0.06]">
          {(people ?? []).map(p => {
            const me = p.email === profile.email
            return (
              <button key={p.email} disabled={!!busy || me} onClick={() => become(p)} className="w-full flex items-center gap-3 px-4 py-3 text-left disabled:opacity-60">
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-semibold truncate">{p.name}{me ? ' · you now' : ''}</span>
                  <span className="block text-[13px] text-pt-muted truncate">{roleLabel(p)} · {WHAT[p.role] ?? ''}</span>
                </span>
                <span className="text-pt-muted text-sm">{busy === p.email ? 'Switching…' : me ? '' : '›'}</span>
              </button>
            )
          })}
        </div>
      </BottomSheet>
    </>
  )
}
