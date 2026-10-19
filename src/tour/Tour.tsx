// App tour (owner, Oct 19): a hands-on practice run for new creators. Book a pretend shoot, add real props
// and a gear kit to it, send it, follow it in My requests, pick it up, check in, wrap and return it.
// SEALED: these screens only READ (real prop photos, gear kits, live rules). Nothing here calls the server
// or writes anything: no booking, no request, no upload (camera photos stay on the phone and are thrown away).
// Required once for creators (App.tsx TourGate; can pause and resume); anyone can replay it at /tour.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSession } from '../auth'
import { useItems } from '../hooks/useItems'
import { useBookingSettings } from '../hooks/useBookings'
import { useScheduleSettings, fmtSlot } from '../services/schedule'
import { subscribeToGearBundles, type GearBundle } from '../services/gear'
import { thumbOf } from '../services/itemShape'
import { GearArt } from '../components/GearUi'
import { TAB_ICONS } from '../components/BottomNav'
import BrandMark from '../components/BrandMark'
import type { Item } from '../types'
import { formatDay } from '../lib/dates'
import { todayInStudio, addDays, addOpenDays, lastDayToBook } from '../../functions/src/booking'
import { GEAR_LEAD_TIME_DAYS } from '../../functions/src/gearBooking'
import { Spotlight } from './Spotlight'
import { markTourDone, savedStep, saveStep } from './tourState'

type Scene = 'welcome' | 'home' | 'book' | 'booked' | 'browse' | 'review' | 'sent' | 'me' | 'requests'
  | 'pickup' | 'gearpickup' | 'checkin' | 'wrap' | 'return' | 'ai' | 'rules' | 'done'
interface Step { id: string; scene: Scene; target?: string; tip?: ReactNode; next?: string; skip?: boolean }

const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const START = 13 * 60, SLOT = 120

export default function Tour({ onFinish, required = false }: { onFinish: () => void; required?: boolean }) {
  const { profile, user } = useSession()
  const first = (profile.name || user.displayName || '').split(' ')[0]
  const items = useItems()
  const settings = useBookingSettings()
  const s = useScheduleSettings()
  const [bundles, setBundles] = useState<GearBundle[]>([])
  useEffect(() => subscribeToGearBundles(setBundles), [])

  // Real props with photos (read only), and a real gear kit if the team has made one.
  const props = useMemo(() => items.filter(i => i.collection === 'company' && i.photos?.length && !i.archived && i.condition !== 'damaged').slice(0, 6), [items])
  const p0: Item | undefined = props[0], p1: Item | undefined = props[1]
  const kit = bundles.find(b => b.kind !== 'extra' && !b.archived)
  const kitName = kit?.name ?? 'Camera kit'
  const pieces = (kit?.pieces.length ? kit.pieces.slice(0, 4).map(p => `${p.name ?? 'Piece'}${p.qty > 1 ? ` × ${p.qty}` : ''}`) : ['Camera body', 'Lens', 'Batteries × 2'])

  // The pretend shoot: Cliff 1, 1–3 PM, five open days from now (so every cutoff is still open).
  const today = todayInStudio()
  const day = addOpenDays(today, 5, settings)
  const house = s.houses.cliff1.name
  const shootLabel = `${house} · ${formatDay(day)} · ${fmtSlot(START, SLOT)}`
  const cut = { props: lastDayToBook(day, settings.leadTimeDays, settings), builds: lastDayToBook(day, settings.buildLeadDays, settings), gear: lastDayToBook(day, GEAR_LEAD_TIME_DAYS, settings) }
  const [video, setVideo] = useState('My practice video')

  const STEPS: Step[] = [
    { id: 'welcome', scene: 'welcome' },
    { id: 'book', scene: 'home', target: 'book', tip: <>Everything starts with a <b>shoot</b>. Tap <b>Book a shoot</b>.</> },
    { id: 'who', scene: 'book', target: 'who', next: 'Next', tip: <>Filming with friends? Pick <b>+ 1 friend</b> and you get times back to back. Your friend gets 20 minutes to confirm their slot.</> },
    { id: 'days', scene: 'book', target: 'days', next: 'Next', tip: <>Days with free time. A greyed-out day is full.</> },
    { id: 'slot', scene: 'book', target: 'slot', tip: <>Each row is a free 2-hour time. Tap a <b>house</b> to book it.</> },
    { id: 'addprops', scene: 'booked', target: 'addprops', tip: <>Booked! Now get what you need for it. Tap <b>Add props &amp; gear</b>.</> },
    { id: 'adding', scene: 'browse', target: 'adding', next: 'Next', tip: <>This bar shows the shoot you're adding to. Free or taken is for <b>that</b> day.</> },
    { id: 'add1', scene: 'browse', target: 'add-0', tip: <>Real props from our closet. Tap <b>+</b> to add this one.</> },
    { id: 'add2', scene: 'browse', target: 'add-1', tip: <>Add one more. (Tap a photo any time to see the details.)</> },
    { id: 'geartab', scene: 'browse', target: 'geartab', tip: <>Cameras, lights and sound are here. Tap <b>Gear</b>.</> },
    { id: 'addgear', scene: 'browse', target: 'gear-add', tip: <>Gear comes in kits, booked whole, for your shoot's hours. Tap <b>+</b>.</> },
    { id: 'reviewbar', scene: 'browse', target: 'reviewbar', tip: <>Tap here to check everything before it goes.</> },
    { id: 'name', scene: 'review', target: 'name', next: 'Next', tip: <>Name the video so the teams know what it's for.</> },
    { id: 'make', scene: 'review', target: 'make', next: 'Next', tip: <>Don't see it in the closet? Ask the arts team to <b>make or find it</b>. That needs more notice: by <b>{formatDay(cut.builds)}</b> for this shoot.</> },
    { id: 'send', scene: 'review', target: 'send', tip: <>Props go to the arts team, gear to the equipment team. Tap <b>Send</b>. (It's practice: nothing is sent.)</> },
    { id: 'navme', scene: 'sent', target: 'nav-me', tip: <>Your shoot now shows on Home. Everything you asked for is on <b>Me</b>. Tap it.</> },
    { id: 'myreq', scene: 'me', target: 'myrequests', tip: <>Tap <b>My requests</b>.</> },
    { id: 'card', scene: 'requests', target: 'card', next: 'Next', tip: <>One card per shoot, with its props and gear and where each one is.</> },
    { id: 'change', scene: 'requests', target: 'propsrow', next: 'Next', tip: <>Until the team starts on it, tap a request to <b>change</b> it or add more.</> },
    { id: 'packed', scene: 'requests', target: 'propsrow', next: 'Next', tip: <>When it's ready you get a notification, and the bar moves along.</> },
    { id: 'openpickup', scene: 'requests', target: 'propsrow', tip: <>Shoot day: tap your props request to <b>pick it up</b>.</> },
    { id: 'sign', scene: 'pickup', target: 'sign', tip: <>Check you've got everything, then sign. Only you can sign for your props.</> },
    { id: 'pieces', scene: 'gearpickup', target: 'pieces', tip: <>Gear: tick <b>every piece</b> in the case. Something missing? Tap <b>Missing</b> so it isn't blamed on you.</> },
    { id: 'gearsign', scene: 'gearpickup', target: 'gearsign', tip: <>Then sign. The kit is yours until you bring it back.</> },
    { id: 'setphoto', scene: 'checkin', target: 'camera', skip: true, tip: <>At the house: check-in opens <b>{s.checkinBefore} minutes</b> before your time. Take a photo of the set. (It stays on your phone.)</> },
    { id: 'report', scene: 'checkin', target: 'report', next: 'Next', tip: <>Did the slot before you run over, or leave a mess? Report it here, with photos. The team reviews it.</> },
    { id: 'checkin', scene: 'checkin', target: 'checkin', tip: <>Tap <b>Check in</b>. That's how the team knows you filmed.</> },
    { id: 'wrap', scene: 'wrap', target: 'wrap', tip: <>Done filming? Say what you shot and tap <b>Wrap</b>.</> },
    { id: 'retphoto', scene: 'return', target: 'camera', skip: true, tip: <>Bringing it back: one photo of <b>everything</b> together (gear with the batteries plugged in to charge).</> },
    { id: 'returned', scene: 'return', target: 'returned', tip: <>Tap <b>Done</b>. The team then checks in each item.</> },
    { id: 'ai', scene: 'ai', target: 'ai', tip: <>Stuck? <b>✦ AI</b> is at the top of every screen. Tap it.</> },
    { id: 'aishow', scene: 'ai', target: 'chat', next: 'Next', tip: <>Tell it your video idea or when you want to film. It finds real props and free times; you still tap to book and send.</> },
    { id: 'rules', scene: 'rules' },
    { id: 'done', scene: 'done' },
  ]
  const [idx, setIdx] = useState(() => required ? Math.min(savedStep(profile.email), STEPS.length - 1) : 0)
  const step = STEPS[idx]
  const I = (id: string) => STEPS.findIndex(x => x.id === id)
  const past = (id: string) => idx > I(id)
  const advance = () => setIdx(n => { const m = Math.min(n + 1, STEPS.length - 1); if (required) saveStep(profile.email, m); return m })
  // A tap only counts when it's the highlighted thing (everything else is blocked by the spotlight anyway).
  const tap = (t: string) => () => { if (step.target === t) advance() }
  const T = (t: string) => ({ 'data-tour': t })

  // Camera photos: shown back, never uploaded, freed when the tour closes.
  const [setPhoto, setSetPhoto] = useState(''), [retPhoto, setRetPhoto] = useState('')
  useEffect(() => () => { if (setPhoto) URL.revokeObjectURL(setPhoto); if (retPhoto) URL.revokeObjectURL(retPhoto) }, [setPhoto, retPhoto])
  const cam = useRef<HTMLInputElement>(null)
  const shot = (f?: File) => {
    if (!f) return
    const u = URL.createObjectURL(f)
    if (step.id === 'setphoto') setSetPhoto(u); else setRetPhoto(u)
    advance()
  }
  const [ticked, setTicked] = useState<string[]>([])
  const tick = (p: string) => {
    if (step.id !== 'pieces') return
    const next = ticked.includes(p) ? ticked.filter(x => x !== p) : [...ticked, p]
    setTicked(next)
    if (next.length === pieces.length) setTimeout(advance, 350)
  }
  const finish = () => { markTourDone(profile.email); onFinish() }

  // ── Pieces of the practice screens ──
  const photo = (i: Item | undefined, cls: string) => i?.photos?.[0]
    ? <img src={thumbOf(i, i.photos[0])} alt="" className={`${cls} object-cover`} />
    : <span className={`${cls} grid place-items-center bg-pt-border text-2xl`}>🎭</span>
  const nameOf = (i: Item | undefined, f: string) => i?.name ?? f
  const header = (title: string, ai = false) => (
    <div className="flex items-center gap-3 pt-2 pb-4">
      <h1 className="font-display text-[34px] text-pt-text flex-1 tracking-title">{title}</h1>
      {ai && <span className="rounded-full px-3 py-1.5 text-sm font-semibold text-[#140f22] bg-[#BF9DFF]">✦ AI</span>}
    </div>
  )
  const bar = (at: number, n: number) => <span className="flex gap-1">{Array.from({ length: n }, (_, i) => <i key={i} className={`flex-1 h-1.5 rounded-full ${i <= at ? 'bg-pt-accent' : 'bg-pt-border'}`} />)}</span>
  const propsStatus = past('packed') ? (past('sign') ? 'Picked up' : 'Packed & ready') : idx >= I('packed') ? 'Packed & ready' : 'Requested'
  const propsAt = propsStatus === 'Requested' ? 0 : propsStatus === 'Packed & ready' ? 2 : 3
  const shootCard = (ticks: boolean) => (
    <div className="rounded-[24px] p-5 bg-pt-accent text-stone-900 shadow-gold space-y-3">
      <p className="text-xs font-bold uppercase tracking-wider opacity-70">Your next shoot</p>
      <p className="text-[22px] font-extrabold leading-tight">{formatDay(day)} · {fmtSlot(START, SLOT)}</p>
      <p className="text-sm font-semibold opacity-80">{house} · {video}</p>
      {ticks && <div className="flex gap-2 text-sm font-semibold">{['Time', 'Props', 'Gear'].map(x => <span key={x} className="rounded-full bg-black/10 px-3 py-1">✓ {x}</span>)}</div>}
    </div>
  )

  const scenes: Record<Scene, () => ReactNode> = {
    welcome: () => (
      <div className="min-h-full grid place-items-center text-center px-6">
        <div className="space-y-5 rise-in">
          <BrandMark className="w-20 h-20 mx-auto text-white" />
          <h1 className="font-display text-[30px] font-extrabold leading-tight">Welcome to Prime Capitol{first ? `, ${first}` : ''}!</h1>
          <p className="text-pt-muted text-[15px]">Let's practise booking a shoot, start to finish. About 3 minutes.</p>
          <p className="rounded-2xl bg-pt-surface shadow-hairline px-4 py-3 text-sm text-pt-text">🧪 This is a <b>practice run</b>. Nothing gets booked, nobody gets a request, and no photos are uploaded.</p>
          <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Let's go</button>
          {idx === 0 && required && savedStep(profile.email) > 0 && <p className="text-pt-muted text-xs">You'll pick up where you left off.</p>}
        </div>
      </div>
    ),
    home: () => (
      <>
        {header(`Hey${first ? ` ${first}` : ''}`, true)}
        <div className="rounded-[24px] p-5 bg-pt-surface shadow-card space-y-3">
          <p className="text-pt-muted text-sm">No shoot booked yet.</p>
          <button {...T('book')} onClick={tap('book')} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Book a shoot</button>
        </div>
      </>
    ),
    book: () => (
      <>
        {header('Book a shoot')}
        <div {...T('who')} className="flex gap-1 bg-pt-surface rounded-full p-1 mb-4">
          {['Just me', '+ 1 friend', '+ 2 friends'].map((x, i) => <span key={x} className={`flex-1 text-center rounded-full py-2 text-sm font-semibold ${i === 0 ? 'bg-pt-accent text-stone-900' : 'text-pt-muted'}`}>{x}</span>)}
        </div>
        <div {...T('days')} className="flex gap-2 overflow-hidden mb-5">
          {Array.from({ length: 6 }, (_, n) => addDays(day, n - 2)).map((d, n) => {
            const dt = new Date(d + 'T12:00:00'), full = n === 1
            return <span key={d} className={`shrink-0 w-12 rounded-2xl py-2 text-center ${d === day ? 'bg-pt-accent text-stone-900' : full ? 'opacity-35' : 'bg-pt-surface'}`}>
              <span className="block text-[10px] font-semibold">{WEEKDAY[dt.getDay()]}</span><span className="block text-lg font-bold">{dt.getDate()}</span></span>
          })}
        </div>
        <p className="text-[19px] font-semibold mb-2">{formatDay(day)}</p>
        {[START, START + SLOT, START + 3 * SLOT].map((t, n) => (
          <div key={t} {...(n === 0 ? T('slot') : {})} className="flex items-center gap-2 py-3 border-b border-white/[0.06]">
            <span className="flex-1 text-[15px]">{fmtSlot(t, SLOT)}</span>
            <button onClick={n === 0 ? tap('slot') : undefined} className="rounded-full px-4 py-2 text-sm font-bold text-stone-900 bg-pt-accent">{house}</button>
            <button onClick={n === 0 ? tap('slot') : undefined} className="rounded-full px-4 py-2 text-sm font-bold text-stone-900 bg-pt-accent">{s.houses.cliff2.name}</button>
          </div>
        ))}
      </>
    ),
    booked: () => (
      <div className="pt-10 text-center space-y-5 rise-in">
        <p className="text-6xl pop">🎬</p>
        <h1 className="font-display text-[30px] font-extrabold">Booked ✓</h1>
        <p className="text-pt-muted">{shootLabel}</p>
        <div className="rounded-2xl bg-pt-surface shadow-hairline p-4 text-sm text-left space-y-1">
          <p className="font-semibold">Add things by:</p>
          <p className="text-pt-muted">Props from the closet · <b className="text-pt-text">{formatDay(cut.props)}</b></p>
          <p className="text-pt-muted">Props to make or find · <b className="text-pt-text">{formatDay(cut.builds)}</b></p>
          <p className="text-pt-muted">Gear · <b className="text-pt-text">{formatDay(cut.gear)}</b></p>
        </div>
        <button {...T('addprops')} onClick={tap('addprops')} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Add props &amp; gear</button>
      </div>
    ),
    browse: () => {
      const gear = idx >= I('addgear')
      const nProps = (past('add1') ? 1 : 0) + (past('add2') ? 1 : 0), nGear = past('addgear') ? 1 : 0
      return (
        <>
          {header('Browse', true)}
          <div {...T('adding')} className="rounded-2xl bg-pt-accent/10 shadow-[inset_0_0_0_0.5px_rgba(201,169,97,0.5)] px-4 py-3 mb-3">
            <span className="block text-pt-muted text-[11px] uppercase tracking-wider">Adding to</span>
            <span className="block text-pt-text text-[15px] font-semibold">{shootLabel}</span>
          </div>
          <div className="flex gap-1 bg-pt-surface rounded-full p-1 mb-4">
            <span className={`flex-1 text-center rounded-full py-2 text-sm font-semibold ${!gear ? 'bg-pt-accent text-stone-900' : 'text-pt-muted'}`}>Props &amp; costumes</span>
            <button {...T('geartab')} onClick={tap('geartab')} className={`flex-1 text-center rounded-full py-2 text-sm font-semibold ${gear ? 'bg-pt-accent text-stone-900' : 'text-pt-muted'}`}>Gear</button>
          </div>
          {!gear ? (
            <div className="grid grid-cols-2 gap-3">
              {(props.length ? props : [undefined, undefined, undefined, undefined]).map((p, n) => {
                const added = (n === 0 && past('add1')) || (n === 1 && past('add2'))
                return (
                  <div key={p?.id ?? n} className="space-y-1.5">
                    <div className="relative">
                      {photo(p, 'w-full aspect-square rounded-[20px]')}
                      <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">Free</span>
                      <button {...(n < 2 ? T(`add-${n}`) : {})} onClick={tap(`add-${n}`)} aria-label={`Add ${nameOf(p, 'prop')}`}
                        className={`absolute bottom-2 right-2 w-11 h-11 rounded-full grid place-items-center text-xl font-bold shadow-card ${added ? 'pop bg-pt-accent text-stone-900' : 'bg-white text-stone-900'}`}>{added ? '✓' : '+'}</button>
                    </div>
                    <p className="text-sm font-semibold truncate">{nameOf(p, ['Police costume', 'Candles', 'Diner sign', 'Old phone'][n] ?? 'Prop')}</p>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="relative">
                  <GearArt photo={kit?.photos?.[0]} category={kit?.category} className="w-full aspect-square rounded-[20px]" />
                  <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">Free</span>
                  <button {...T('gear-add')} onClick={tap('gear-add')} aria-label={`Add ${kitName}`}
                    className={`absolute bottom-2 right-2 w-11 h-11 rounded-full grid place-items-center text-xl font-bold shadow-card ${nGear ? 'pop bg-pt-accent text-stone-900' : 'bg-white text-stone-900'}`}>{nGear ? '✓' : '+'}</button>
                </div>
                <p className="text-sm font-semibold truncate">{kitName}</p>
                <p className="text-xs text-pt-muted">{pieces.length} pieces · {fmtSlot(START, SLOT)}</p>
              </div>
            </div>
          )}
          {nProps + nGear > 0 && (
            <button {...T('reviewbar')} onClick={tap('reviewbar')} className="sticky bottom-3 mt-6 w-full rounded-2xl px-4 py-4 flex items-center justify-between font-bold text-stone-900 bg-pt-accent shadow-gold">
              <span>Your shoot · {nProps} prop{nProps === 1 ? '' : 's'}{nGear ? ` · ${nGear} gear` : ''}</span><span>Review →</span>
            </button>
          )}
        </>
      )
    },
    review: () => (
      <>
        {header('Your shoot')}
        <p className="text-pt-muted text-sm -mt-2 mb-4">{shootLabel}</p>
        <label {...T('name')} className="block mb-4"><span className="block text-pt-muted text-xs mb-1">Video name</span>
          <input value={video} onChange={e => setVideo(e.target.value.slice(0, 60))} className="w-full bg-pt-surface border border-pt-border rounded-xl px-3 py-3 text-base focus:outline-none focus:border-pt-accent" /></label>
        <p className="text-xs font-semibold uppercase tracking-wider text-pt-muted mb-2">Props · arts team</p>
        {[p0, p1].map((p, n) => (
          <div key={n} className="flex items-center gap-3 py-2">
            {photo(p, 'w-12 h-12 rounded-xl')}
            <span className="flex-1 min-w-0 truncate text-[15px]">{nameOf(p, n ? 'Candles' : 'Police costume')}</span>
            <span className="flex items-center gap-1"><span className="w-9 h-9 rounded-full bg-pt-surface grid place-items-center">−</span><b className="w-6 text-center">1</b><span className="w-9 h-9 rounded-full bg-pt-surface grid place-items-center">+</span></span>
          </div>
        ))}
        <p {...T('make')} className="rounded-xl border border-dashed border-pt-border px-3 py-3 my-2 text-sm text-pt-accent">+ We don't have it · make or find</p>
        <p className="text-xs font-semibold uppercase tracking-wider text-pt-muted mt-4 mb-2">Gear · equipment team</p>
        <div className="flex items-center gap-3 py-2">
          <GearArt photo={kit?.photos?.[0]} category={kit?.category} className="w-12 h-12 rounded-xl" />
          <span className="flex-1 min-w-0"><span className="block truncate text-[15px]">{kitName}</span><span className="block text-xs text-pt-muted">Pick up {fmtSlot(START, SLOT).split('–')[0]} · back by {fmtSlot(START, SLOT).split('–')[1]}</span></span>
        </div>
        <button {...T('send')} onClick={tap('send')} className="mt-6 w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Book props + gear</button>
      </>
    ),
    sent: () => (
      <>
        {header(`Hey${first ? ` ${first}` : ''}`, true)}
        <p className="rise-in text-center text-pt-accent text-sm mb-3">Sent ✓ <span className="text-pt-muted">(practice: nothing was sent)</span></p>
        {shootCard(true)}
      </>
    ),
    me: () => (
      <>
        {header('Me', true)}
        <div className="bg-pt-surface shadow-hairline rounded-2xl divide-y divide-white/[0.06]">
          <button {...T('myrequests')} onClick={tap('myrequests')} className="w-full flex items-center gap-3 px-4 py-3 text-left">
            <span className="flex-1"><span className="block text-pt-text">My requests</span><span className="block text-pt-muted text-xs">Props and gear for each shoot, and where they are</span></span><span className="text-pt-muted">›</span>
          </button>
          {['Help', 'How it works', 'App tour'].map(x => <div key={x} className="px-4 py-3 text-pt-muted">{x}</div>)}
        </div>
      </>
    ),
    requests: () => (
      <>
        {header('My requests')}
        <div {...T('card')} className="bg-pt-surface shadow-card rounded-[20px] p-3 space-y-2">
          <div className="flex items-center gap-3 px-1">
            <span className="w-12 text-center"><span className="block text-[11px] font-semibold text-pt-accent">{WEEKDAY[new Date(day + 'T12:00:00').getDay()]}</span><span className="block text-[24px] font-bold leading-none">{new Date(day + 'T12:00:00').getDate()}</span></span>
            <span className="flex-1 min-w-0"><b className="block text-[15px] truncate">{shootLabel}</b><span className="block text-pt-muted text-xs truncate">{video}</span></span>
          </div>
          <button {...T('propsrow')} onClick={tap('propsrow')} className="w-full bg-pt-bg rounded-lg px-3 py-3 text-left space-y-2">
            <span className="flex justify-between gap-2 text-sm"><span>🎬 Props &amp; costumes · 2 props</span><span className="text-pt-accent text-xs">{propsStatus} ›</span></span>
            {bar(propsAt, 5)}
            {propsAt === 0 && <span className="block text-pt-muted text-xs">Tap to change it, until the arts team starts.</span>}
          </button>
          <div className="w-full bg-pt-bg rounded-lg px-3 py-3 space-y-2">
            <span className="flex justify-between gap-2 text-sm"><span>🎥 Gear · {fmtSlot(START, SLOT)} · 1 item</span><span className="text-pt-accent text-xs">Held ›</span></span>
            {bar(0, 4)}
          </div>
        </div>
      </>
    ),
    pickup: () => (
      <>
        {header('Pick up')}
        <p className="text-pt-muted text-sm -mt-2 mb-4">{video} · Packed &amp; ready</p>
        {[p0, p1].map((p, n) => <div key={n} className="flex items-center gap-3 py-2">{photo(p, 'w-12 h-12 rounded-xl')}<span className="flex-1 truncate">{nameOf(p, n ? 'Candles' : 'Police costume')}</span><span className="text-emerald-300 text-sm">✓ Packed</span></div>)}
        <button {...T('sign')} onClick={tap('sign')} className="mt-6 w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">✍️ I've got everything · sign</button>
      </>
    ),
    gearpickup: () => (
      <>
        {header('Gear pickup')}
        <p className="text-pt-muted text-sm -mt-2 mb-4">{kitName} · opens 30 min before {fmtSlot(START, SLOT).split('–')[0]}</p>
        <div {...T('pieces')} className="space-y-2">
          {pieces.map(p => {
            const on = ticked.includes(p)
            return (
              <div key={p} className="flex items-center gap-3 bg-pt-surface rounded-xl px-3 py-2">
                <button onClick={() => tick(p)} aria-pressed={on} className={`w-10 h-10 rounded-full grid place-items-center font-bold ${on ? 'pop bg-pt-accent text-stone-900' : 'bg-pt-border'}`}>{on ? '✓' : ''}</button>
                <span className="flex-1 text-[15px]">{p}</span>
                <span className="text-xs text-pt-muted">Missing?</span>
              </div>
            )
          })}
        </div>
        <button {...T('gearsign')} onClick={tap('gearsign')} disabled={ticked.length < pieces.length} className="mt-6 w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold disabled:opacity-40">✍️ Sign for the gear</button>
      </>
    ),
    checkin: () => (
      <>
        {header("You're up")}
        <p className="text-pt-muted text-sm -mt-2 mb-4">{shootLabel}</p>
        {setPhoto ? <img src={setPhoto} alt="Your set photo" className="w-full aspect-[4/3] object-cover rounded-[20px] mb-1" />
          : <button {...T('camera')} onClick={() => step.target === 'camera' && cam.current?.click()} className="w-full aspect-[4/3] rounded-[20px] bg-pt-surface shadow-hairline grid place-items-center text-pt-muted">
              <span className="text-center"><span className="block text-5xl mb-2">📷</span>Take a photo of the set</span></button>}
        {setPhoto && <p className="text-pt-muted text-xs text-center mb-3">This photo stays on your phone. Practice only.</p>}
        <div {...T('report')} className="rounded-2xl bg-pt-surface p-3 my-3 space-y-2">
          <p className="text-sm font-semibold">The slot before you</p>
          <div className="flex gap-2">{['Ran over', 'Left a mess'].map(x => <span key={x} className="rounded-full bg-pt-border px-3 py-1.5 text-sm">{x}</span>)}</div>
        </div>
        <button {...T('checkin')} onClick={tap('checkin')} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Check in</button>
      </>
    ),
    wrap: () => (
      <>
        {header('Filming…')}
        <p className="rise-in text-center text-emerald-300 text-sm mb-4">Checked in ✓</p>
        <label className="block mb-4"><span className="block text-pt-muted text-xs mb-1">What did you film?</span>
          <input defaultValue={video} className="w-full bg-pt-surface border border-pt-border rounded-xl px-3 py-3 text-base focus:outline-none focus:border-pt-accent" /></label>
        <button {...T('wrap')} onClick={tap('wrap')} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Wrap 🎬</button>
      </>
    ),
    return: () => (
      <>
        {header('Return')}
        <p className="text-pt-muted text-sm -mt-2 mb-4">{video} · 2 props + {kitName}</p>
        {retPhoto ? <img src={retPhoto} alt="Your return photo" className="w-full aspect-[4/3] object-cover rounded-[20px] mb-1" />
          : <button {...T('camera')} onClick={() => step.target === 'camera' && cam.current?.click()} className="w-full aspect-[4/3] rounded-[20px] bg-pt-surface shadow-hairline grid place-items-center text-pt-muted">
              <span className="text-center"><span className="block text-5xl mb-2">📷</span>Photo of everything you're bringing back</span></button>}
        {retPhoto && <p className="text-pt-muted text-xs text-center mb-3">This photo stays on your phone. Practice only.</p>}
        <button {...T('returned')} onClick={tap('returned')} className="mt-4 w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Done, I've brought it back</button>
      </>
    ),
    ai: () => (
      <>
        <div className="flex items-center gap-3 pt-2 pb-4">
          <h1 className="font-display text-[34px] text-pt-text flex-1">Home</h1>
          <button {...T('ai')} onClick={tap('ai')} className="rounded-full px-3 py-1.5 text-sm font-semibold text-[#140f22] bg-[#BF9DFF] shadow-violet">✦ AI</button>
        </div>
        {past('ai') ? (
          <div {...T('chat')} className="space-y-3 rise-in">
            <p className="ml-auto w-fit max-w-[86%] rounded-[20px] rounded-br-md px-4 py-3 text-[15px] text-stone-900 bg-pt-accent">A séance that goes wrong, filming Friday</p>
            <p className="w-fit max-w-[86%] rounded-[20px] rounded-bl-md px-4 py-3 text-[15px] bg-[#BF9DFF]/10 border border-[#BF9DFF]/25">Here's what we have for that, and some free Friday times.</p>
            <div className="flex gap-2">{props.slice(2, 5).map(p => <span key={p.id} className="w-20">{photo(p, 'w-20 h-20 rounded-xl')}<span className="block text-[11px] truncate mt-1">{p.name}</span></span>)}</div>
          </div>
        ) : shootCard(true)}
      </>
    ),
    rules: () => (
      <div className="pt-6 space-y-4 rise-in">
        <h1 className="font-display text-[30px] font-extrabold">Good to know</h1>
        {[
          ['📅', `Props from the closet: book ${settings.leadTimeDays} open days ahead. To make or find: ${settings.buildLeadDays}. Gear: ${GEAR_LEAD_TIME_DAYS}.`],
          ['🔁', `Moving or cancelling is free with ${s.noticeHours} hours' notice. Closer than that, swap with someone instead.`],
          ['📸', `Check in at the house: it opens ${s.checkinBefore} minutes before your time.`],
          ['⚠️', `No-shows and late cancels give a strike. ${s.strikeCount} in ${s.strikeDays} days pauses props and gear for ${s.pauseDays} days.`],
          ['❓', 'Forgot something? Me → Help, or Me → App tour to do this again.'],
        ].map(([i, t]) => <div key={t} className="flex gap-3 rounded-2xl bg-pt-surface shadow-hairline p-4"><span className="text-2xl">{i}</span><p className="text-[15px] text-pt-text">{t}</p></div>)}
        <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Got it</button>
      </div>
    ),
    done: () => (
      <div className="min-h-full grid place-items-center text-center px-6">
        <div className="space-y-5 rise-in">
          <p className="text-7xl pop">🎉</p>
          <h1 className="font-display text-[30px] font-extrabold">You're ready!</h1>
          <p className="text-pt-muted text-[15px]">That's the whole thing: book a time, add props and gear, pick up, check in, bring it back.</p>
          <button onClick={finish} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">{required ? 'Start using the app' : 'Done'}</button>
        </div>
      </div>
    ),
  }

  const tabs: [string, Scene[]][] = [['Home', ['home', 'sent', 'ai']], ['Book', ['book', 'booked']], ['Browse', ['browse', 'review']], ['Me', ['me', 'requests', 'pickup', 'gearpickup', 'checkin', 'wrap', 'return']]]
  const shell = !['welcome', 'rules', 'done'].includes(step.scene)
  const tipCount = STEPS.filter(x => x.tip).length
  const tipNo = STEPS.slice(0, idx + 1).filter(x => x.tip).length

  return (
    <div className="fixed inset-0 z-[60] bg-pt-bg flex flex-col" role="dialog" aria-label="App tour (practice)">
      <div className="pt-safe px-4 shrink-0 flex items-center gap-3 pb-2">
        <span className="rounded-full bg-violet-500/15 text-violet-200 text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1">Practice</span>
        <span className="flex-1 h-1 rounded-full bg-pt-border overflow-hidden"><i className="block h-full bg-pt-accent transition-all duration-500 ease-spring" style={{ width: `${(idx / (STEPS.length - 1)) * 100}%` }} /></span>
        {required ? <span className="text-pt-muted text-xs">{Math.round((idx / (STEPS.length - 1)) * 100)}%</span>
          : <button onClick={onFinish} aria-label="Close the tour" className="tap text-pt-muted text-lg">✕</button>}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-6">{scenes[step.scene]()}</div>
      {shell && (
        <nav className="shrink-0 grid grid-cols-4 border-t border-white/[0.06] pb-tabbar pt-2 bg-pt-bg">
          {tabs.map(([t, sc]) => (
            <button key={t} {...(t === 'Me' ? T('nav-me') : {})} onClick={t === 'Me' ? tap('nav-me') : undefined}
              className={`text-center text-[11px] py-1 ${sc.includes(step.scene) ? 'text-pt-accent' : 'text-pt-muted'}`}>
              <span className="flex justify-center mb-0.5">{TAB_ICONS[t]}</span>{t}</button>
          ))}
        </nav>
      )}
      {step.id === 'packed' && (
        <div className="fixed top-3 inset-x-3 z-[80] rise-in rounded-[20px] bg-pt-raised/95 shadow-float px-4 py-3 flex items-center gap-3" style={{ marginTop: 'env(safe-area-inset-top)' }}>
          <span className="w-9 h-9 rounded-xl bg-black grid place-items-center"><BrandMark className="w-6 h-6 text-white" /></span>
          <span className="flex-1 min-w-0"><b className="block text-sm">Prime Capitol <span className="font-normal text-pt-muted">· now</span></b><span className="block text-sm truncate">Your props for {video} are packed and ready ✓</span></span>
        </div>
      )}
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { shot(e.target.files?.[0]); e.target.value = '' }} />
      {step.tip && <Spotlight key={step.id} target={step.target} tip={step.tip} step={tipNo} total={tipCount} next={step.next} onNext={advance} onSkip={step.skip ? advance : undefined} />}
    </div>
  )
}
