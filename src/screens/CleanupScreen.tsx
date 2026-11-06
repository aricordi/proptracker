// Clean up props (owner, Nov 6): the arts crew's job after the photo imports, thousands of props. The page is a plan in
// the order that saves the most work: (1) combine doubles (the app finds them, the AI helps), (2) put props in their bin
// (matched from the photo folders), (3) quick-approve what already looks complete, (4) work bin by bin for the rest.
// Every card shows what's left. Made for people who have never seen the app.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useItems } from '../hooks/useItems'
import { useBins } from '../hooks/useBins'
import { cleanupCounts, binGuesses, looksComplete, inCleanup } from '../lib/cleanup'
import { loadDoubles, cachedDoubles } from '../services/cleanup'
import { CleanupHeader } from '../components/cleanup/Parts'
import { Icon, type IconName } from '../components/Icon'

export default function CleanupScreen() {
  const navigate = useNavigate()
  const items = useItems()
  const bins = useBins()
  const c = useMemo(() => cleanupCounts(items), [items])
  // The doubles list takes the server a few seconds: start it now, so the Doubles screen opens with it ready.
  const [pairs, setPairs] = useState(() => cachedDoubles()?.pairs ?? null)
  useEffect(() => { if (!pairs) loadDoubles().then(r => setPairs(r.pairs)).catch(() => setPairs([])) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const live = useMemo(() => new Set(items.filter(inCleanup).map(i => i.id)), [items])
  const livePairs = (pairs ?? []).filter(p => live.has(p.a) && live.has(p.b))
  const doubleIds = useMemo(() => new Set(livePairs.filter(p => p.tier !== 'maybe').flatMap(p => [p.a, p.b])), [livePairs.length])   // eslint-disable-line react-hooks/exhaustive-deps
  const toPlace = useMemo(() => [...binGuesses(items, bins).values()].reduce((n, l) => n + l.length, 0), [items, bins])
  const complete = useMemo(() => pairs ? items.filter(i => looksComplete(i, doubleIds)).length : null, [items, doubleIds, pairs])
  const [how, setHow] = useState(() => { try { return localStorage.getItem('pc.cleanupHow') !== 'seen' } catch { return true } })
  const pct = c.total ? Math.round((c.checked / c.total) * 100) : 0
  const closeHow = () => { setHow(false); try { localStorage.setItem('pc.cleanupHow', 'seen') } catch { /* private mode */ } }
  const sure = livePairs.filter(p => p.tier === 'sure').length

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <CleanupHeader title="Clean up props" back="/admin" />
      <div className="px-4 space-y-6 max-w-[640px] mx-auto">
        <div className="rounded-[20px] bg-pt-surface p-4">
          <div className="flex items-baseline gap-2">
            <span className="text-[34px] font-bold text-pt-text leading-none">{c.checked.toLocaleString()}</span>
            <span className="text-pt-muted text-[16px]">of {c.total.toLocaleString()} props checked</span>
          </div>
          <div className="mt-3 h-3 rounded-full bg-white/[0.08] overflow-hidden" aria-hidden><div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${pct}%` }} /></div>
          <p className="text-pt-muted text-[14px] mt-2">{c.todo ? `${c.todo.toLocaleString()} still to check · ${pct}% done` : 'Everything is checked ✓'}</p>
        </div>

        {how && <HowItWorks onClose={closeHow} />}

        <section>
          <h2 className="text-pt-text text-[20px] font-bold px-1">Do it in this order</h2>
          <p className="text-pt-muted text-[14px] px-1 mb-3">Each step makes the next one shorter. The app does the finding.</p>
          <ol className="space-y-3">
            <Step n={1} icon="file" title="Combine doubles" go={() => navigate('/cleanup/doubles')}
              count={pairs === null ? '…' : livePairs.length} unit="to look at"
              detail={pairs === null ? 'The app is comparing every prop (photos, names, bins)…'
                : sure ? `${sure} are the exact same picture: combine them all with one tap. The AI helps with the rest.` : 'Two photos side by side: same thing? One tap. The AI checks them with you.'} />
            <Step n={2} icon="archive" title="Put props in their bin" go={() => navigate('/cleanup/place')} count={toPlace} unit="the app can place"
              detail="No bin yet, but their photo folder is named like a bin. Check the photos, one tap." />
            <Step n={3} icon="check" title="Quick approve" go={() => navigate('/cleanup/approve')} count={complete === null ? '…' : complete} unit="look complete"
              detail="Real name, a bin, a photo, no doubles. Glance at 30 at a time, untick anything wrong, approve." />
            <Step n={4} icon="box" title="Work bin by bin" go={() => navigate('/cleanup/bins')} count={c.todo} unit="left to check"
              detail="Stand at a bin, see everything in it on one screen, fix what's wrong, then “Everything here looks right”." />
          </ol>
        </section>

        <Section title="More ways to fix">
          <Row icon="sparkle" title={`Fix odd names with AI${c.names ? ` · ${c.names}` : ''}`} detail={'Names like "IMG_2034": the AI looks at the photo and suggests one'} onClick={() => navigate('/cleanup/names')} />
          <Row icon="check" title="Check props one by one" detail="One prop at a time with a big photo: name, count, bin, category" onClick={() => navigate('/cleanup/check?f=todo')} />
          <Row icon="list" title="Quick list" detail="Every prop in a list: rename, change counts, move or remove many at once" onClick={() => navigate('/cleanup/list')} />
          <div className="px-4 py-3 flex flex-wrap gap-2">
            <Chip n={c.nobin} label="No bin" onClick={() => navigate('/cleanup/bin/none')} />
            <Chip n={c.nophoto} label="No photo" onClick={() => navigate('/cleanup/check?f=nophoto')} />
            <Chip n={c.many} label="More than 1" onClick={() => navigate('/cleanup/check?f=many')} />
            <Chip n={c.costumes} label="Costumes" onClick={() => navigate('/cleanup/check?f=costumes')} />
          </div>
        </Section>

        <Section title="Safety net">
          <Row icon="restore" title={`Removed props${c.removed ? ` · ${c.removed}` : ''}`} detail="Everything removed. Put any of them back with one tap" onClick={() => navigate('/cleanup/removed')} />
          <Row icon="search" title="Look-alike groups (advanced)" detail="The older duplicate finder: groups of look-alikes, flag to gather" onClick={() => navigate('/duplicates')} />
          {!how && <Row icon="help" title="How this works" detail="The 1-minute explanation" onClick={() => setHow(true)} />}
        </Section>
      </div>
    </div>
  )
}

function Step({ n, icon, title, detail, count, unit, go }: { n: number; icon: IconName; title: string; detail: string; count: number | string; unit: string; go: () => void }) {
  const empty = count === 0
  return (
    <li>
      <button onClick={go} className={`w-full text-left rounded-[20px] p-4 flex gap-3 active:scale-[0.99] transition-transform ${empty ? 'bg-pt-surface opacity-70' : n === 1 ? 'bg-pt-accent text-stone-900 shadow-gold' : 'bg-pt-surface'}`}>
        <span className={`w-9 h-9 rounded-full grid place-items-center font-bold shrink-0 ${n === 1 && !empty ? 'bg-stone-900 text-pt-accent' : 'bg-pt-raised text-pt-accent'}`}>{empty ? '✓' : n}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`text-[18px] font-bold ${n === 1 && !empty ? '' : 'text-pt-text'}`}>{title}</span>
            <span className={`text-[14px] font-semibold whitespace-nowrap ${n === 1 && !empty ? 'opacity-80' : 'text-pt-muted'}`}><Icon name={icon} className="w-4 h-4 mr-1 align-[-2px]" />{typeof count === 'number' ? count.toLocaleString() : count} {unit}</span>
          </span>
          <span className={`block text-[15px] mt-0.5 ${n === 1 && !empty ? 'opacity-90' : 'text-pt-muted'}`}>{empty ? 'Nothing to do here right now.' : detail}</span>
        </span>
      </button>
    </li>
  )
}

function HowItWorks({ onClose }: { onClose: () => void }) {
  const steps: [string, string][] = [
    ['The app finds the work', 'It compares every prop (photos, names, bins, and the AI) and lines up the jobs below with how many are left.'],
    ['You answer simple questions', 'Same thing? Yes or no. Is this bin right? One tap. Fix a name or a count by typing over it.'],
    ['Junk? Remove it', 'Not a prop, a bad photo, or we don\'t have it any more. It\'s never deleted: Removed props has Put back, and Undo shows right after.'],
    ['Nothing breaks', 'Every change is saved with your name in Activity. A count can\'t go below what\'s booked; a prop out on a shoot can\'t be removed.'],
  ]
  return (
    <div className="rounded-[20px] bg-sky-400/10 p-4">
      <p className="text-sky-200 text-[14px] font-semibold">How this works · 1 minute</p>
      <ul className="mt-2 space-y-3">
        {steps.map(([t, d]) => (
          <li key={t}><b className="block text-pt-text text-[16px]">{t}</b><span className="text-pt-muted text-[16px]">{d}</span></li>
        ))}
      </ul>
      <button onClick={onClose} className="mt-4 w-full rounded-2xl min-h-[52px] bg-white/[0.08] text-pt-text text-[16px] font-semibold">Got it</button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-pt-muted text-[14px] font-semibold px-1 mb-2">{title}</h2>
      <div className="rounded-[20px] bg-pt-surface divide-y divide-white/[0.06] overflow-hidden">{children}</div>
    </section>
  )
}

function Row({ icon, title, detail, onClick }: { icon: IconName; title: string; detail: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 min-h-[64px] text-left active:bg-white/[0.04]">
      <span className="w-10 h-10 rounded-full bg-pt-raised grid place-items-center text-pt-accent shrink-0"><Icon name={icon} className="w-5 h-5" /></span>
      <span className="flex-1 min-w-0"><span className="block text-pt-text text-[16px] font-semibold">{title}</span><span className="block text-pt-muted text-[14px]">{detail}</span></span>
      <span className="text-pt-muted text-[20px]">›</span>
    </button>
  )
}

function Chip({ n, label, onClick }: { n: number; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={!n} className="min-h-[44px] inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-4 text-[16px] text-pt-text disabled:opacity-40">
      {label} <b className={n ? 'text-pt-accent' : 'text-pt-muted'}>{n}</b>
    </button>
  )
}
