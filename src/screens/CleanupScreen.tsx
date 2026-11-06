// Clean up props (owner, Nov 6): one page with every tool the arts crew needs after the photo imports, as big cards.
// Made for people who have never seen the app: each card says what it's for in one line, and how it works is one tap away.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useItems } from '../hooks/useItems'
import { cleanupCounts, sameNameSameBin, type CleanupFilter } from '../lib/cleanup'
import { CleanupHeader } from '../components/cleanup/Parts'
import { Icon, type IconName } from '../components/Icon'

export default function CleanupScreen() {
  const navigate = useNavigate()
  const items = useItems()
  const c = useMemo(() => cleanupCounts(items), [items])
  const sameName = useMemo(() => sameNameSameBin(items).length, [items])
  const [how, setHow] = useState(() => { try { return localStorage.getItem('pc.cleanupHow') !== 'seen' } catch { return true } })
  const pct = c.total ? Math.round((c.checked / c.total) * 100) : 0
  const closeHow = () => { setHow(false); try { localStorage.setItem('pc.cleanupHow', 'seen') } catch { /* private mode */ } }
  const check = (f: CleanupFilter) => navigate(`/cleanup/check?f=${f}`)

  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <CleanupHeader title="Clean up props" back="/admin" />
      <div className="px-4 space-y-6 max-w-[640px] mx-auto">
        {/* How far along the whole closet is. */}
        <div className="rounded-[20px] bg-pt-surface p-4">
          <div className="flex items-baseline gap-2">
            <span className="text-[34px] font-bold text-pt-text leading-none">{c.checked.toLocaleString()}</span>
            <span className="text-pt-muted text-[16px]">of {c.total.toLocaleString()} props checked</span>
          </div>
          <div className="mt-3 h-3 rounded-full bg-white/[0.08] overflow-hidden" aria-hidden><div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${pct}%` }} /></div>
          <p className="text-pt-muted text-[14px] mt-2">{c.todo ? `${c.todo.toLocaleString()} still to check` : 'Everything is checked ✓'}</p>
        </div>

        {how && <HowItWorks onClose={closeHow} />}

        {/* The main job. */}
        <button onClick={() => check('todo')} className="w-full text-left rounded-[24px] bg-pt-accent text-stone-900 p-5 shadow-gold active:scale-[0.99] transition-transform">
          <span className="flex items-center gap-2 text-[14px] font-semibold opacity-80"><Icon name="check" className="w-4 h-4" /> Start here</span>
          <span className="block text-[24px] font-bold mt-1">Check props one by one</span>
          <span className="block text-[16px] mt-1 opacity-90">One prop at a time: fix the name, how many, and the bin. Remove junk. About 10 seconds each.</span>
          <span className="inline-flex mt-3 rounded-full bg-stone-900 text-pt-accent px-4 min-h-[44px] items-center text-[16px] font-bold">{c.todo ? `Start · ${c.todo.toLocaleString()} to go` : 'Look through them again'}</span>
        </button>

        <Section title="Find doubles">
          <Row icon="file" title="Same photo twice" detail={sameName ? `Same picture, or same name in the same bin (${sameName} found)` : 'The very same picture on two props, or the same name in the same bin'} onClick={() => navigate('/cleanup/doubles')} />
          <Row icon="search" title="Look-alikes" detail="Props that look alike in different photos" onClick={() => navigate('/duplicates')} />
        </Section>

        <Section title="Fix many at once">
          <Row icon="list" title="Quick list" detail="Every prop in one list: rename, change how many, pick several and move or remove them" onClick={() => navigate('/cleanup/list')} />
          <div className="px-4 py-3 flex flex-wrap gap-2">
            <Chip n={c.nobin} label="No bin" onClick={() => check('nobin')} />
            <Chip n={c.names} label="Odd names" onClick={() => check('names')} />
            <Chip n={c.nophoto} label="No photo" onClick={() => check('nophoto')} />
            <Chip n={c.many} label="More than 1" onClick={() => check('many')} />
            <Chip n={c.costumes} label="Costumes" onClick={() => check('costumes')} />
          </div>
        </Section>

        <Section title="More">
          <Row icon="restore" title={`Removed props${c.removed ? ` · ${c.removed}` : ''}`} detail="Everything you removed. Put any of them back with one tap" onClick={() => navigate('/cleanup/removed')} />
          <Row icon="archive" title="Bin by bin" detail="Scan a bin's QR code and tick what's really in it" onClick={() => navigate('/bins')} />
          {!how && <Row icon="help" title="How this works" detail="The 1-minute explanation" onClick={() => setHow(true)} />}
        </Section>
      </div>
    </div>
  )
}

function HowItWorks({ onClose }: { onClose: () => void }) {
  const steps: [string, string][] = [
    ['Check props one by one', 'You see one prop. Fix its name, how many there are, and which bin it\'s in. Then tap Looks right. Next one comes up.'],
    ['Junk? Remove it', 'Not a prop, a bad photo, or we don\'t have it any more: tap Remove. It\'s never deleted; Removed props has a Put back button.'],
    ['Same prop twice? Combine', 'Tap It\'s a double and pick the other one. Copies add up (1 + 1 = 2). The same thing photographed twice just keeps the photos.'],
    ['Many at once', 'Quick list: tick several props, then move them to a bin, set the category, or remove them together.'],
    ['Nothing breaks', 'Every change is saved with your name in Activity, and anything removed can be put back.'],
  ]
  return (
    <div className="rounded-[20px] bg-sky-400/10 p-4">
      <p className="text-sky-200 text-[14px] font-semibold">How this works · 1 minute</p>
      <ol className="mt-2 space-y-3">
        {steps.map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="w-8 h-8 rounded-full bg-sky-400/20 text-sky-200 grid place-items-center font-bold shrink-0">{i + 1}</span>
            <span><b className="block text-pt-text text-[16px]">{t}</b><span className="text-pt-muted text-[16px]">{d}</span></span>
          </li>
        ))}
      </ol>
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
