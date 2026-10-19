// App tour (owner, Oct 19): a hands-on practice run for new creators. Book a pretend shoot, add real props
// and a gear kit to it, send it, follow it in My requests, pick it up, check in, wrap and return it.
// Owner (Oct 19): it must look like the real app, so each scene copies the real screen's layout (CreatorHomeScreen,
// ScheduleScreen's FindSheet/BookSheet/ShootSheet/OnTheDay, HomeScreen + GearShopScreen, ReserveScreen,
// ReservationDetailScreen, GearBookingScreen, AccountScreen, MyRequestsScreen, Assistant) and reuses the real pieces
// that can't send anything (BottomSheet, PieceChecklist, Pill, PhotoStrip, Avatar, RequestRow, BrandMark, GearArt).
// When one of those screens changes a lot, update its scene here too.
// Hands-on (owner, Oct 19: "make me feel like I'm doing it for real"): you type your friend's name (the real list of
// creators, names only), pick the day, search the closet, name the video, write a make-or-find request, type what you
// filmed and your own AI idea. Calm: no pop-in or pulsing (only the real app's "Booked ✓" glow).
// SEALED: these screens only READ (real prop photos, gear kits, live rules). Nothing here calls the server
// or writes anything: no booking, no request, no upload (camera photos stay on the phone and are thrown away).
// Required once for creators (App.tsx TourGate; can pause and resume); anyone can replay it at /tour.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSession } from '../auth'
import { useItems } from '../hooks/useItems'
import { useBookingSettings } from '../hooks/useBookings'
import { useScheduleSettings, fmtSlot, listFilmingFriends } from '../services/schedule'
import { subscribeToGearBundles, type GearBundle } from '../services/gear'
import { thumbOf } from '../services/itemShape'
import { GearArt, Pill, PieceChecklist } from '../components/GearUi'
import { TAB_ICONS } from '../components/BottomNav'
import BottomSheet from '../components/BottomSheet'
import BrandMark from '../components/BrandMark'
import Avatar from '../components/Avatar'
import { PhotoStrip } from '../components/ProofPhotos'
import { RequestRow } from '../components/ShootNeeds'
import { STATUS_STYLES, JOURNEY } from '../lib/reservationLabels'
import type { ReservationStatus } from '../services/reservations'
import type { Item } from '../types'
import { formatDay } from '../lib/dates'
import { todayInStudio, addOpenDays, lastDayToBook } from '../../functions/src/booking'
import { GEAR_LEAD_TIME_DAYS, fmtTime, fmtHours } from '../../functions/src/gearBooking'
import { Spotlight } from './Spotlight'
import { markTourDone, savedStep, saveStep } from './tourState'

type Scene = 'welcome' | 'home' | 'find' | 'bookit' | 'shoot' | 'browse' | 'gear' | 'review' | 'sent' | 'home2' | 'me' | 'requests'
  | 'pickup' | 'gearpickup' | 'checkin' | 'wrap' | 'return' | 'ai' | 'chat' | 'rules' | 'done'
interface Step { id: string; scene: Scene; target?: string; tip?: ReactNode; next?: string; skip?: boolean }

const START = 13 * 60, SLOT = 120
// Same class strings as the real screens.
const field = 'w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2.5 text-pt-text text-[15px] focus:outline-none focus:border-pt-accent'
const btnGold = 'w-full bg-pt-accent text-stone-900 font-semibold rounded-[14px] py-3 min-h-[48px] shadow-gold disabled:opacity-40 disabled:shadow-none'
const input = 'w-full bg-pt-surface border border-pt-border rounded-xl px-4 py-3 text-pt-text placeholder-pt-muted focus:outline-none focus:border-pt-accent'
const searchIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-pt-muted pointer-events-none"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
const FREE = 'bg-green-500/90 text-stone-900'

export default function Tour({ onFinish, required = false }: { onFinish: () => void; required?: boolean }) {
  const { profile, user } = useSession()
  const name = profile.name || user.displayName || profile.email
  const first = (profile.name || user.displayName || '').split(' ')[0]
  const items = useItems()
  const settings = useBookingSettings()
  const s = useScheduleSettings()
  const [bundles, setBundles] = useState<GearBundle[]>([])
  useEffect(() => subscribeToGearBundles(setBundles), [])

  // Real props with photos (read only), and a real gear kit if the team has made one.
  const all = useMemo(() => items.filter(i => i.collection === 'company' && i.photos?.length && !i.archived && i.condition !== 'damaged'), [items])
  const props = all.slice(0, 6)
  const [query, setQuery] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1).map(w => w.replace(/s$/, ''))
  const hay = (i: Item) => [i.name, i.description, i.notes, ...(i.tags ?? []), ...(Array.isArray(i.searchWords) ? i.searchWords : [i.searchWords ?? ''])].join(' ').toLowerCase()
  const found = (q: string) => { const w = words(q); return w.length ? all.filter(i => w.every(x => hay(i).includes(x))) : [] }
  const shown = query.trim() ? found(query).slice(0, 8) : props
  const picked: (Item | undefined)[] = added.length ? added.map(id => all.find(i => i.id === id)) : [props[0], props[1]]
  // Your friend: typed and picked from the real list of creators (names only; nobody is booked or told).
  const [people, setPeople] = useState<{ email: string; name: string }[] | null>(null)
  useEffect(() => { listFilmingFriends({}).then(r => setPeople(r.data.people.filter(p => p.email !== profile.email))).catch(() => setPeople([])) }, [profile.email])
  const [friendQ, setFriendQ] = useState('')
  const [friend, setFriend] = useState<{ email: string; name: string } | null>(null)
  const friendFirst = friend?.name.split(' ')[0] ?? 'your friend'
  const [builds, setBuilds] = useState<{ description: string; qty: number }[]>([])
  const [showBuild, setShowBuild] = useState(false), [buildDesc, setBuildDesc] = useState(''), [buildQty, setBuildQty] = useState(1)
  const [over, setOver] = useState(false), [mess, setMess] = useState(false)
  const [idea, setIdea] = useState(''), [asked, setAsked] = useState('')
  const [wrapText, setWrapText] = useState('')
  const kit = bundles.find(b => b.kind !== 'extra' && !b.archived)
  const kitName = kit?.name ?? 'Camera kit'
  const kitPieces = kit?.pieces.length ? kit.pieces : [{ itemId: 'a', qty: 1, name: 'Camera body' }, { itemId: 'b', qty: 1, name: 'Lens' }, { itemId: 'c', qty: 2, name: 'Battery' }]
  const pieceLines = kitPieces.flatMap(p => Array.from({ length: Math.min(p.qty, 3) }, (_, u) => ({ key: `${p.itemId}|${u}`, name: p.name ?? 'Piece', unit: u + 1, of: p.qty }))).slice(0, 5)
  const pcs = kitPieces.reduce((n, p) => n + p.qty, 0)

  // The pretend shoot: Cliff 1, 1–3 PM, five open days from now (so every cutoff is still open).
  const today = todayInStudio()
  const [pickedDay, setPickedDay] = useState<string | null>(null)
  const day = pickedDay ?? addOpenDays(today, 5, settings)
  const strip = Array.from({ length: 6 }, (_, n) => addOpenDays(today, n + 4, settings))   // the first one shows as full
  const house = s.houses.cliff1
  const shootLabel = `${house.name} · ${formatDay(day)} · ${fmtSlot(START, SLOT)}`
  const longDay = formatDay(day, { weekday: 'long', month: 'short', day: 'numeric' })
  const cut = { props: lastDayToBook(day, settings.leadTimeDays, settings), builds: lastDayToBook(day, settings.buildLeadDays, settings), gear: lastDayToBook(day, GEAR_LEAD_TIME_DAYS, settings) }
  const [video, setVideo] = useState('')
  const title = video.trim() || 'My practice video'
  const propName = (i: Item | undefined, n: number) => i?.name ?? (n ? 'Candles' : 'Police costume')

  const STEPS: Step[] = [
    { id: 'welcome', scene: 'welcome' },
    { id: 'book', scene: 'home', target: 'book', tip: <>Everything starts with a <b>shoot</b>. Tap <b>Book a shoot</b>.</> },
    { id: 'friend1', scene: 'find', target: 'who', tip: <>Let's say you're filming with a friend. Tap <b>+ 1 friend</b>.</> },
    { id: 'friendname', scene: 'find', target: 'friendsearch', tip: <>Type your friend's name (or their channel), then tap them. Try someone you film with.</> },
    { id: 'days', scene: 'find', target: 'days', tip: <>Tap the day you want to film. A faded day is full.</> },
    { id: 'slot', scene: 'find', target: 'slot', tip: <>Each row is a time that's free for both of you: you first, then {friendFirst}. Tap a <b>house</b>.</> },
    { id: 'bookit', scene: 'bookit', target: 'bookit', tip: <>Tap <b>Book + invite {friendFirst}</b>. Your slot is booked straight away; {friendFirst} gets a notification and {20} minutes to confirm theirs. (Practice: nobody is booked or told.)</> },
    { id: 'addprops', scene: 'shoot', target: 'addprops', tip: <>Booked! This is your shoot. Now add what you need: tap <b>+ Add</b> next to Props &amp; costumes.</> },
    { id: 'search', scene: 'browse', target: 'browsezone', tip: <>This is our real closet. Search for something (try <b>mask</b>, <b>hat</b> or <b>phone</b>), then tap <b>+</b> on a prop you like.</> },
    { id: 'add2', scene: 'browse', target: 'browsezone', tip: <>Nice. Add one more: search again, or scroll and tap <b>+</b>.</> },
    { id: 'geartab', scene: 'browse', target: 'geartab', tip: <>Cameras, lights and sound are here. Tap <b>Gear</b>.</> },
    { id: 'addgear', scene: 'gear', target: 'gear-add', tip: <>Gear comes in kits, booked whole, for your shoot's hours. Tap <b>+</b>.</> },
    { id: 'reviewbar', scene: 'gear', target: 'reviewbar', tip: <>Tap here to check everything before it goes.</> },
    { id: 'name', scene: 'review', target: 'name', next: 'Done', tip: <>Type a name for the video, so the teams know what it's for.</> },
    { id: 'make', scene: 'review', target: 'make', tip: <>Need something we don't have? Tap <b>+ Request something we don't have</b>.</> },
    { id: 'makeform', scene: 'review', target: 'make', tip: <>Describe it in your own words (e.g. "a fake birthday cake"), pick how many, then tap <b>Add request</b>. For this shoot the arts team needs it by <b>{formatDay(cut.builds)}</b>.</> },
    { id: 'send', scene: 'review', target: 'send', tip: <>Props go to the arts team, gear to the equipment team. Tap the button to send. (Practice: nothing is sent.)</> },
    { id: 'sent', scene: 'sent', target: 'journey', next: 'Next', tip: <>Sent! This line shows where your props are, from Requested to Checked in.</> },
    { id: 'back', scene: 'sent', target: 'back', tip: <>Tap <b>‹ Back</b>.</> },
    { id: 'navme', scene: 'home2', target: 'nav-me', tip: <>Your shoot is on Home now, with ✓ Time, Props and Gear. Everything you asked for is on <b>Me</b>. Tap it.</> },
    { id: 'myreq', scene: 'me', target: 'myrequests', tip: <>Tap <b>My requests</b>.</> },
    { id: 'card', scene: 'requests', target: 'card', next: 'Next', tip: <>One card per shoot, with its props and gear and where each one is. Until the team starts on it, tap a request to change it or add more.</> },
    { id: 'packed', scene: 'requests', target: 'propsrow', next: 'Next', tip: <>When it's ready you get a notification, and the bar moves along.</> },
    { id: 'openpickup', scene: 'requests', target: 'propsrow', tip: <>Shoot day: tap your props request to <b>pick it up</b>.</> },
    { id: 'sign', scene: 'pickup', target: 'sign', tip: <>Check you've got everything, then sign. Only you can sign for your props.</> },
    { id: 'pieces', scene: 'gearpickup', target: 'pieces', tip: <>Gear: open the case and tick <b>every piece</b>. Something missing? Tap <b>Missing?</b> so it isn't blamed on you.</> },
    { id: 'gearsign', scene: 'gearpickup', target: 'gearsign', tip: <>Then sign. The kit is yours until you bring it back.</> },
    { id: 'setphoto', scene: 'checkin', target: 'camera', skip: true, tip: <>At the house: open your shoot. Check-in opens <b>{s.checkinBefore} minutes</b> before your time. Take a photo of the set. (Practice: it stays on your phone.)</> },
    { id: 'report', scene: 'checkin', target: 'report', next: 'Next', tip: <>Did the slot before you run over, or leave a mess? Tap one to report it (you'd add photos). The team reviews every report.</> },
    { id: 'checkin', scene: 'checkin', target: 'checkin', tip: <>Tap <b>Check in</b>. That's how the team knows you filmed.</> },
    { id: 'wrap', scene: 'wrap', target: 'wrap', tip: <>Done filming? Type what you shot, then tap <b>Wrap</b>.</> },
    { id: 'retphoto', scene: 'return', target: 'camera', skip: true, tip: <>Bringing props back: one photo of <b>everything</b> together, where you leave it. Gear works the same (with the batteries plugged in to charge).</> },
    { id: 'returned', scene: 'return', target: 'returned', tip: <>Tap <b>Confirm return</b>. The team then checks in each item.</> },
    { id: 'ai', scene: 'ai', target: 'ai', tip: <>Stuck? <b>✦ AI</b> is at the top of every screen. Tap it.</> },
    { id: 'aiask', scene: 'chat', target: 'composer', tip: <>Try it: type a video idea (e.g. "a cooking show that goes wrong") and tap <b>↑</b>.</> },
    { id: 'aishow', scene: 'chat', target: 'answer', next: 'Next', tip: <>It suggests real props from our closet, and it can find free times too. You still tick, book and send yourself. (Practice: this answer comes from your words, not the AI.)</> },
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
  const addProp = (id: string) => {
    if (step.id !== 'search' && step.id !== 'add2') return
    const next = added.includes(id) ? added.filter(x => x !== id) : [...added, id]
    setAdded(next)
    if ((step.id === 'search' && next.length >= 1) || (step.id === 'add2' && next.length >= 2)) advance()
  }
  const pickFriend = (p: { email: string; name: string }) => { if (step.id !== 'friendname') return; setFriend(p); setFriendQ(''); advance() }
  const pickDay = (d: string) => { if (step.id !== 'days') return; setPickedDay(d); advance() }
  const addBuild = () => { if (step.id !== 'makeform' || !buildDesc.trim()) return; setBuilds(b => [...b, { description: buildDesc.trim(), qty: buildQty }]); setShowBuild(false); setBuildDesc(''); advance() }
  const askAi = () => { if (step.id !== 'aiask' || idea.trim().length < 3) return; setAsked(idea.trim()); setIdea(''); advance() }

  // "Book it" glows gold for a moment, like the real one, before the shoot opens.
  const [flash, setFlash] = useState(false)
  const bookIt = () => { if (step.target !== 'bookit' || flash) return; setFlash(true); setTimeout(() => { setFlash(false); advance() }, 650) }

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
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const allTicked = pieceLines.every(l => ticked.has(l.key) || missing.has(l.key))
  useEffect(() => { if (step.id === 'pieces' && allTicked) { const t = setTimeout(advance, 400); return () => clearTimeout(t) } }, [step.id, allTicked])   // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n }
  const finish = () => { markTourDone(profile.email); onFinish() }

  // ── Pieces copied from the real screens ──
  const thumb = (i: Item | undefined) => i?.photos?.[0] ? thumbOf(i, i.photos[0]) : undefined
  const aiPill = (t?: string) => (
    <button {...(t ? T(t) : {})} onClick={t ? tap(t) : undefined} aria-label="Ask the AI"
      className="shrink-0 h-11 rounded-full pl-3 pr-4 flex items-center gap-1.5 text-[14px] font-bold text-[#140f22] bg-[#BF9DFF] shadow-violet">
      <span className="text-[16px] leading-none">✦</span>AI
    </button>
  )
  const roundHelp = <span className="w-11 h-11 rounded-full grid place-items-center bg-pt-surface shadow-hairline text-pt-muted text-lg">?</span>
  const backBar = (right?: ReactNode, mid?: string) => (
    <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 py-3 flex items-center justify-between">
      <button {...T('back')} onClick={tap('back')} className="text-pt-text text-base font-medium py-1">‹ Back</button>
      {mid && <h1 className="font-display text-xl text-pt-text">{mid}</h1>}
      {right ?? <div className="w-12" />}
    </div>
  )
  const banner = (tone: 'green' | 'amber', heading: string, body: ReactNode) => (
    <div className={`border rounded-xl px-4 py-3 ${tone === 'green' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>
      <p className="font-medium">{heading}</p><p className="text-pt-text/80 text-sm mt-0.5">{body}</p>
    </div>
  )
  const statusPill = (st: ReservationStatus, label: string) => <span className={`text-xs px-3 py-1 rounded-full ${STATUS_STYLES[st]}`}>{label}</span>
  const journey = (st: ReservationStatus) => {
    const at = JOURNEY.findIndex(j => j.status === st)
    return (
      <div {...T('journey')} className="flex items-start">
        {JOURNEY.map((j, i) => (
          <div key={j.status} className="flex-1 flex flex-col items-center text-center">
            <div className="flex items-center w-full">
              <div className={`flex-1 h-0.5 ${i === 0 ? 'opacity-0' : i <= at ? 'bg-pt-accent' : 'bg-pt-border'}`} />
              <div className={`w-3.5 h-3.5 rounded-full shrink-0 ${i < at ? 'bg-pt-accent' : i === at ? 'bg-pt-accent ring-4 ring-pt-accent/30' : 'bg-pt-border'}`} />
              <div className={`flex-1 h-0.5 ${i === JOURNEY.length - 1 ? 'opacity-0' : i < at ? 'bg-pt-accent' : 'bg-pt-border'}`} />
            </div>
            <span className={`text-[10px] mt-1 leading-tight ${i === at ? 'text-pt-accent font-semibold' : 'text-pt-muted'}`}>{j.label}</span>
          </div>
        ))}
      </div>
    )
  }
  // The request page's "Props" list (ContentsList).
  const contents = (done: boolean) => (
    <div><p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Props</p>
      <div className="space-y-2">
        {picked.map((p, n) => (
          <div key={n} className="w-full flex items-center gap-3 bg-pt-surface border border-pt-border rounded-2xl p-3 text-left">
            <div className="w-12 h-12 rounded-xl bg-pt-border overflow-hidden shrink-0">{thumb(p) && <img src={thumb(p)} alt="" className="w-full h-full object-cover" />}</div>
            <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate text-pt-text">{propName(p, n)}</p>{done && <p className="text-green-400 text-xs">✓ Picked</p>}</div>
            <span className="text-pt-text font-semibold">×1</span>
          </div>
        ))}
      </div>
    </div>
  )
  const shootLink = (other: 'gear' | 'props') => (
    <div className="w-full flex items-center justify-between bg-pt-surface rounded-2xl px-4 py-3 text-[15px]">
      <span className="text-pt-text">Also in this shoot: {other} (1)</span><span className="text-pt-accent">Open ›</span>
    </div>
  )
  // The tile from ItemCard (the real Browse grid), with its + quick add.
  const tile = (i: Item | undefined, n: number) => {
    const on = !!i && added.includes(i.id)
    return (
      <div key={i?.id ?? n} className="relative w-full h-full">
        <div className="w-full h-full flex flex-col text-left bg-pt-surface shadow-card rounded-[20px] overflow-hidden">
          <div className="relative aspect-square bg-pt-border flex items-center justify-center">
            {thumb(i) ? <img src={thumb(i)} alt={i?.name} className="w-full h-full object-cover" /> : <span className="text-3xl">🎭</span>}
            <span className={`absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full ${FREE}`}>Free</span>
            {!!i && i.quantity > 1 && <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-semibold px-2 py-0.5 rounded-md">×{i.quantity}</span>}
          </div>
          <div className="px-3 pt-2 pb-3">
            <p className="text-pt-text text-[15px] font-semibold tracking-heading leading-snug line-clamp-2">{i?.name ?? ['Police costume', 'Candles', 'Diner sign', 'Old phone'][n] ?? 'Prop'}</p>
          </div>
        </div>
        <button onClick={() => i && addProp(i.id)} aria-label={`${on ? 'Remove' : 'Add'} ${i?.name ?? 'prop'}`}
          className={`absolute top-2 right-2 min-w-11 h-11 px-3 rounded-full grid place-items-center font-bold backdrop-blur-md shadow-hairline ${on ? 'bg-pt-accent text-stone-900 text-sm' : 'bg-black/55 text-pt-text text-[22px] leading-none pb-0.5'}`}>{on ? '✓' : '+'}</button>
      </div>
    )
  }
  const browseHeader = (gear: boolean) => (
    <>
      <h1 className="font-display text-[34px] text-pt-text py-2 flex items-center gap-3"><BrandMark className="w-10 text-pt-text" title="" /><span className="flex-1">Browse</span>{aiPill()}</h1>
      <div className="mb-3 flex bg-pt-surface rounded-xl p-0.5 gap-0.5">
        <span className={`flex-1 py-2 rounded-lg text-sm text-center ${!gear ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>Props &amp; costumes</span>
        <button {...T('geartab')} onClick={tap('geartab')} className={`flex-1 py-2 rounded-lg text-sm ${gear ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>Gear</button>
      </div>
      <div className="relative">{searchIcon}{gear
        ? <div className={`${input} pl-10 text-pt-muted`}>Search cameras, lights, sound…</div>
        : <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search props, costumes, set dressing…" enterKeyHint="search" className={`${input} pl-10 pr-10 text-base`} />}
        {!gear && query && <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-pt-muted text-xl leading-none">×</button>}
      </div>
    </>
  )
  const addingTo = (kind: 'props' | 'gear' | 'shoot') => (
    <div className="w-full min-h-[52px] flex items-center gap-3 py-3 px-4 rounded-2xl text-left text-sm bg-pt-accent/10 shadow-[inset_0_0_0_0.5px_rgba(201,169,97,0.45)]">
      <span className="flex-1 min-w-0">
        <span className="block text-pt-muted text-[11px] uppercase tracking-wider">Adding to</span>
        <span className="block text-pt-text truncate">{shootLabel}</span>
        <span className="block text-xs text-pt-muted">{kind === 'shoot' ? `Props by ${formatDay(cut.props)} · new props by ${formatDay(cut.builds)} · gear by ${formatDay(cut.gear)}` : `Add ${kind} by ${formatDay(kind === 'props' ? cut.props : cut.gear)}`}</span>
      </span>
      <span className="text-pt-accent text-xs shrink-0 tap">Change</span>
    </div>
  )
  const chips = (list: string[]) => (
    <div className="flex gap-2 mt-3 overflow-hidden">
      {list.map((c, n) => <span key={c} className={`shrink-0 px-3 py-1 rounded-full text-sm ${n === 0 ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>{c}</span>)}
    </div>
  )
  const nProps = added.length + builds.length, nGear = past('addgear') ? 1 : 0
  const basket = (nProps + nGear > 0) && (
    <div className="sticky bottom-3 px-4">
      <button {...T('reviewbar')} onClick={tap('reviewbar')} className="w-full flex items-center justify-between bg-pt-accent text-stone-900 rounded-2xl px-4 py-4 font-semibold shadow-gold">
        <span>Your shoot · {[nProps && `${nProps} prop${nProps !== 1 ? 's' : ''}`, nGear && `${nGear} gear`].filter(Boolean).join(' · ')}</span><span>Review →</span>
      </button>
    </div>
  )
  // The Schedule screen behind the booking sheets.
  const scheduleBehind = (
    <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-2">
      <div className="flex items-end justify-between py-2 gap-2"><h1 className="font-display text-[34px] text-pt-text">Schedule</h1><div className="flex gap-2 pb-0.5">{aiPill()}{roundHelp}</div></div>
      <div className="flex bg-pt-surface rounded-xl p-0.5 gap-0.5">
        {[house.name, s.houses.cliff2.name, 'Offsite'].map((h, n) => <span key={h} className={`flex-1 py-2 rounded-[10px] text-sm text-center ${n === 0 ? 'bg-pt-border text-pt-text font-semibold' : 'text-pt-muted'}`}>{h}</span>)}
      </div>
    </div>
  )
  const homeHeader = (
    <div className="pt-safe px-5">
      <div className="flex items-center justify-between py-3">
        <span className="flex items-center gap-2 text-pt-text"><BrandMark className="w-9" title="Prime Capitol" /><b className="text-xs font-extrabold tracking-[0.28em]">PRIME CAPITOL</b></span>
        <span className="flex items-center gap-3">{aiPill(step.scene === 'ai' ? 'ai' : undefined)}{roundHelp}<Avatar email={profile.email} name={name} size={34} /></span>
      </div>
      <p className="text-pt-muted text-xs font-semibold uppercase tracking-wider mt-1">{formatDay(today, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
      <h1 className="font-display text-[34px] leading-tight font-extrabold tracking-tight">{first ? `Hey ${first}` : 'Home'}</h1>
    </div>
  )
  const searchAndAi = (
    <>
      <div className="flex items-center gap-2 bg-pt-surface rounded-[14px] pl-4 pr-2 py-2">
        <span className="flex-1 flex items-center gap-3 py-2 text-pt-muted text-left min-w-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="shrink-0"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <span className="truncate">Search props, costumes, gear</span>
        </span>
      </div>
      <div className="w-full flex items-center gap-2 rounded-full px-4 min-h-[44px] text-left text-[14px] bg-[#BF9DFF]/[0.07] text-[#CDB8FF]">
        <span className="text-[#BF9DFF]">✦</span><span className="flex-1 min-w-0 truncate">Ask AI: props for an idea, or a time to film</span><span className="text-pt-muted">›</span>
      </div>
    </>
  )
  const homeStep = (t: string, doneText: string) => (
    <div className="bg-black/35 rounded-2xl p-3 flex flex-col gap-1 min-w-0">
      <span className="w-[26px] h-[26px] rounded-full grid place-items-center text-sm font-extrabold bg-pt-accent text-stone-900">✓</span>
      <b className="text-sm">{t}</b><span className="text-xs text-pt-muted truncate">{doneText}</span>
    </div>
  )
  const nextShootCard = (
    <div className="relative overflow-hidden w-full text-left rounded-[28px] p-5 border border-pt-accent/35"
      style={{ background: 'radial-gradient(120% 90% at 100% 0%, rgba(235,211,153,.28), transparent 55%), linear-gradient(160deg, #2b2416, #141210 70%)' }}>
      <BrandMark className="absolute -right-10 top-4 w-56 text-white/[0.06] pointer-events-none" title="" />
      <span className="relative flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#EBD399]">Next shoot</span>
        <span className="text-xs font-semibold rounded-full px-3 py-2 bg-pt-accent/20 text-[#EBD399]">soon</span>
      </span>
      <span className="relative block font-display text-[44px] leading-[0.95] font-extrabold tracking-tighter mt-2">{formatDay(day)}</span>
      <span className="relative block text-[17px] font-semibold mt-1">{house.name} · {fmtSlot(START, SLOT)}</span>
      <span className="relative grid grid-cols-3 gap-2 my-4">{homeStep('Time', 'Booked')}{homeStep('Props', 'Requested')}{homeStep('Gear', 'Held')}</span>
      <span className="relative block w-full text-center rounded-2xl py-4 font-bold text-[17px] text-stone-900 bg-pt-accent shadow-gold">Open this shoot</span>
    </div>
  )
  // The top of the real "Your shoot" sheet (ShootSheet): who, when, where, and the Booked → Filmed line.
  const shootTop = (stage: number) => (
    <>
      <div className="flex items-start gap-3">
        <Avatar email={profile.email} name={name} size={44} ring />
        <div className="min-w-0">
          <p className="text-pt-text font-semibold">{longDay} · {fmtSlot(START, SLOT)}</p>
          <p className="text-pt-muted text-sm">{house.name} · {house.address}</p>
          <div className="flex gap-2 mt-2"><Pill tone="free">Booked</Pill></div>
        </div>
      </div>
      <div>
        <div className="flex gap-1">{[1, 2, 3].map(n => <span key={n} className={`flex-1 h-1 rounded-full ${stage >= n ? 'bg-pt-accent' : 'bg-pt-border'}`} />)}</div>
        <div className="flex justify-between text-[11px] text-pt-muted mt-1"><span>Booked</span><span>Checked in</span><span>Filmed</span></div>
      </div>
    </>
  )
  // ProofPhotos' camera tile (the real one uploads; this one keeps the photo on the phone).
  const camTile = (photo: string, label: string, hint?: string) => (
    <div className="space-y-2">
      <p className="text-pt-text text-sm font-medium">{label}</p>
      {hint && <p className="text-pt-muted text-xs">{hint}</p>}
      <div className="grid grid-cols-3 gap-2">
        {photo ? <div className="relative aspect-square rounded-xl overflow-hidden bg-pt-border"><img src={photo} alt="" className="w-full h-full object-cover" /></div>
          : <button {...T('camera')} onClick={() => step.target === 'camera' && cam.current?.click()}
              className="aspect-square rounded-xl border-2 border-dashed border-pt-accent/60 text-pt-accent text-sm flex flex-col items-center justify-center gap-1">
              <span className="text-2xl leading-none">📷</span>Take photo</button>}
      </div>
      <p className="text-pt-muted text-xs">{photo ? 'Practice: this photo stays on your phone and is never uploaded.' : 'Opens your camera: take the photo now, on the spot.'}</p>
    </div>
  )
  const sheet = (heading: string, body: ReactNode) => <>{scheduleBehind}<BottomSheet open onClose={() => {}} title={heading}>{body}</BottomSheet></>

  const scenes: Record<Scene, () => ReactNode> = {
    welcome: () => (
      <div className="min-h-full grid place-items-center text-center px-6 pt-safe">
        <div className="space-y-5">
          <BrandMark className="w-20 mx-auto text-white" title="" />
          <h1 className="font-display text-[30px] font-extrabold leading-tight">Welcome to Prime Capitol{first ? `, ${first}` : ''}!</h1>
          <p className="text-pt-muted text-[15px]">Let's practise booking a shoot, start to finish. About 3 minutes.</p>
          <p className="rounded-2xl bg-pt-surface shadow-hairline px-4 py-3 text-sm text-pt-text">🧪 This is a <b>practice run</b> on the app's real screens. Nothing gets booked, nobody gets a request, and no photos are uploaded.</p>
          <button onClick={advance} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Let's go</button>
          {!required && <button onClick={onFinish} className="tap text-pt-muted text-sm">Not now</button>}
        </div>
      </div>
    ),
    home: () => (
      <div className="pb-10">
        {homeHeader}
        <div className="px-5 mt-4 space-y-4">
          <div className="bg-pt-surface rounded-[28px] p-5 text-center space-y-3">
            <p className="text-pt-text text-lg font-semibold">No shoots booked</p>
            <p className="text-pt-muted text-sm">Book a time at {house.name}, {s.houses.cliff2.name} or somewhere else, then add props and gear to it.</p>
            <button {...T('book')} onClick={tap('book')} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">Book a shoot</button>
          </div>
          {searchAndAi}
        </div>
      </div>
    ),
    find: () => {
      const withFriend = past('friend1')
      const term = friendQ.trim().toLowerCase()
      const matches = term ? (people ?? []).filter(p => p.name.toLowerCase().includes(term)).slice(0, 6) : []
      return sheet('Book a shoot', (
        <>
          <p className="text-pt-muted text-xs mb-2">Who's filming?</p>
          <div {...T('who')} className="flex bg-pt-bg rounded-full p-1 gap-1">
            {['Just me', '+ 1 friend', '+ 2 friends'].map((l, n) => {
              const on = withFriend ? n === 1 : n === 0
              return <button key={l} onClick={n === 1 ? tap('who') : undefined} className={`flex-1 rounded-full min-h-[40px] text-sm ${on ? 'bg-pt-accent text-stone-900 font-semibold shadow-gold' : 'text-pt-text'}`}>{l}</button>
            })}
          </div>
          {withFriend && (
            <div className="mt-3 space-y-2">
              {friend ? (
                <div className="flex flex-wrap gap-2">
                  <span className="flex items-center gap-2 bg-pt-raised rounded-full pl-1 pr-3 min-h-[40px] text-sm text-pt-text shadow-hairline"><Avatar email={friend.email} name={friend.name} size={32} />{friendFirst}<span className="text-pt-muted">×</span></span>
                </div>
              ) : (
                <div {...T('friendsearch')} className="bg-pt-bg rounded-xl p-2">
                  <input type="search" value={friendQ} onChange={e => setFriendQ(e.target.value)} placeholder="Search by name or channel" className={field} />
                  <div className="max-h-48 overflow-y-auto mt-1">
                    {term && people === null && <p className="text-pt-muted text-sm p-2">Loading…</p>}
                    {term && people !== null && matches.length === 0 && <p className="text-pt-muted text-sm p-2">No one called "{friendQ.trim()}".</p>}
                    {matches.map(p => (
                      <button key={p.email} onClick={() => pickFriend(p)} className="w-full flex items-center gap-3 p-2 rounded-lg text-left">
                        <Avatar email={p.email} name={p.name} size={32} />
                        <span className="flex-1 min-w-0"><span className="block text-pt-text text-sm truncate">{p.name}</span></span>
                      </button>
                    ))}
                    {term && people !== null && matches.length === 0 && (
                      <button onClick={() => pickFriend({ email: 'practice-friend', name: 'Sam (practice)' })} className="w-full text-left p-2 text-pt-accent text-sm">Practise with "Sam" instead ›</button>
                    )}
                  </div>
                </div>
              )}
              <p className="text-pt-muted text-xs">{friend ? `You book your slot; theirs is held for 20 minutes for them to confirm.` : 'Each of you gets a 2-hour slot, back to back. Pick who, or they can book the next slot themselves.'}</p>
            </div>
          )}
          <div {...T('days')} className="mt-5 -mx-6 px-6 flex gap-2 overflow-x-auto no-scrollbar">
            <span className={`shrink-0 rounded-2xl px-4 min-h-[56px] grid place-items-center text-sm font-semibold ${pickedDay ? 'bg-pt-bg text-pt-text' : 'bg-pt-accent text-stone-900 shadow-gold'}`}>Soonest</span>
            {strip.map((d, n) => (
              <button key={d} onClick={n === 0 ? undefined : () => pickDay(d)} aria-label={formatDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}
                className={`shrink-0 w-12 rounded-2xl min-h-[56px] flex flex-col items-center justify-center ${pickedDay === d ? 'bg-pt-accent text-stone-900 shadow-gold' : n === 0 ? 'bg-pt-bg text-pt-muted/50' : 'bg-pt-bg text-pt-text'}`}>
                <span className="text-[11px] leading-none">{formatDay(d, { weekday: 'short' })}</span><span className="text-[17px] font-semibold leading-tight mt-1">{Number(d.slice(8))}</span>
              </button>
            ))}
          </div>
          <div className="mt-5">
            <p className="text-pt-text text-[19px] font-semibold tracking-heading mb-3">{longDay}</p>
            <div className="space-y-2">
              {[START, START + SLOT * 2, START + SLOT * 3].map((t, n) => (
                <div key={t} {...(n === 0 ? T('slot') : {})} className="flex items-center gap-2 bg-pt-bg rounded-xl p-3">
                  <span className="flex-1 min-w-0">
                    <span className="block text-pt-text font-semibold">{fmtSlot(t, (friend ? 2 : 1) * SLOT)}</span>
                    {friend && <span className="block text-pt-muted text-xs truncate">You {fmtSlot(t, SLOT)} · then {friendFirst}</span>}
                  </span>
                  {[house.name, s.houses.cliff2.name].map(h => <button key={h} onClick={n === 0 ? tap('slot') : undefined} className="bg-pt-accent text-stone-900 font-semibold rounded-full px-4 min-h-[40px] text-sm shadow-gold shrink-0">{h}</button>)}
                </div>
              ))}
            </div>
          </div>
        </>
      ))
    },
    bookit: () => sheet('Book back to back', (
      <>
        <p className="text-pt-muted text-sm">{longDay} · {house.name}</p>
        <div className="mt-4 space-y-2">
          {[{ email: profile.email, name: 'You', note: 'Booked', who: name }, { email: friend?.email ?? 'friend', name: friend?.name ?? 'Friend', note: 'Held 20 min', who: friend?.name ?? 'Friend' }].map((p, i) => (
            <div key={i} className="flex items-center gap-3 bg-pt-bg rounded-xl p-3">
              <Avatar email={p.email} name={p.who} size={36} />
              <span className="flex-1 min-w-0"><span className="block text-pt-text font-semibold truncate">{p.name}</span><span className="block text-pt-muted text-xs">{fmtSlot(START + i * SLOT, SLOT)}</span></span>
              <span className={`text-xs ${i === 0 ? 'text-pt-accent' : 'text-amber-300'}`}>{p.note}</span>
            </div>
          ))}
        </div>
        <p className="text-pt-muted text-xs mt-4">{friendFirst} gets a notification to confirm. If they don't within 20 minutes, the slot opens to everyone.</p>
        <button {...T('bookit')} onClick={bookIt} className={`mt-5 ${btnGold} ${flash ? 'booked-flash' : ''}`}>{flash ? 'Booked ✓' : `Book + invite ${friendFirst}`}</button>
      </>
    )),
    shoot: () => sheet('Your shoot', (
      <div className="space-y-3">
        {shootTop(1)}
        <div className="space-y-2">
          <p className="text-pt-muted text-xs uppercase tracking-wider">For this shoot</p>
          {([['Props & costumes', cut.props, `new props by ${formatDay(cut.builds)}`, 'addprops'], ['Gear', cut.gear, '', '']] as const).map(([t, by, extra, tg]) => (
            <div key={t} className="bg-pt-bg rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0"><p className="text-pt-text font-semibold">{t}</p><p className="text-pt-muted text-xs">Add by {formatDay(by)}{extra ? ` · ${extra}` : ''}</p></div>
                <button {...(tg ? T(tg) : {})} onClick={tg ? tap(tg) : undefined} className="shrink-0 bg-pt-accent text-stone-900 font-semibold rounded-lg px-3 py-2 text-sm">+ Add</button>
              </div>
              <p className="text-pt-muted text-xs">Nothing yet.</p>
            </div>
          ))}
        </div>
      </div>
    )),
    browse: () => (
      <div {...T('browsezone')}>
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
          {browseHeader(false)}
          {chips(['All', 'Prop', 'Costume', 'Set Dressing', 'Tech props'])}
          <div className="flex items-center justify-between gap-3 mt-2">
            <span className="bg-pt-surface border border-pt-border rounded-lg px-3 py-2 text-sm text-pt-muted">Any status ▾</span>
            <span className="text-pt-muted text-xs">{query.trim() ? found(query).length : all.length} props</span>
          </div>
          <div className="mt-3">{addingTo('props')}</div>
        </div>
        <div className="px-4 pt-1">
          {query.trim() && shown.length === 0 && <p className="text-pt-muted text-sm text-center py-6">Nothing called "{query.trim()}". Try another word, like mask, hat or phone.</p>}
          <div className="grid grid-cols-2 gap-3">{(shown.length || query.trim() ? shown : [undefined, undefined, undefined, undefined]).map(tile)}</div><div className="h-20" />
        </div>
        {basket}
      </div>
    ),
    gear: () => (
      <>
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
          {browseHeader(true)}
          <div className="mt-3 space-y-2">
            {addingTo('gear')}
            <div className="bg-pt-surface rounded-2xl p-3"><div className="grid gap-2 grid-cols-2">
              {[['Gear from', fmtTime(START)], ['Until', fmtTime(START + SLOT)]].map(([l, v]) => <span key={l} className="space-y-1 min-w-0"><span className="block text-pt-muted text-[11px] uppercase tracking-wider">{l}</span><span className="block w-full bg-pt-bg border border-pt-border rounded-xl px-2.5 py-2 text-pt-text text-[15px]">{v}</span></span>)}
            </div></div>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-baseline justify-between"><h2 className="text-pt-text text-xl font-semibold tracking-tight">Bundles</h2><span className="text-pt-muted text-xs">Booked as a whole</span></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="relative w-full h-full">
              <div className="w-full h-full flex flex-col text-left bg-pt-surface shadow-card rounded-[20px] overflow-hidden">
                <div className="relative aspect-square">
                  <GearArt photo={kit?.photos?.[0]} category={kit?.category} className="w-full h-full" />
                  <span className={`absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full ${FREE}`}>Free</span>
                  <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-semibold px-2 py-0.5 rounded-md">{pcs} pcs</span>
                </div>
                <div className="px-3 pt-2 pb-3">
                  <p className="text-pt-text text-[15px] font-semibold tracking-heading leading-snug line-clamp-2">{kitName}</p>
                  <p className="text-pt-muted text-xs truncate mt-0.5">{kit?.category ?? 'Camera'} · free {fmtHours(START, START + SLOT)}</p>
                </div>
              </div>
              <button {...T('gear-add')} onClick={tap('gear-add')} aria-label={`${nGear ? 'Remove' : 'Add'} ${kitName}`}
                className={`absolute top-2 right-2 min-w-11 h-11 px-3 rounded-full grid place-items-center font-bold backdrop-blur-md shadow-hairline ${nGear ? 'bg-pt-accent text-stone-900 text-sm' : 'bg-black/55 text-pt-text text-[22px] leading-none pb-0.5'}`}>{nGear ? '✓' : '+'}</button>
            </div>
          </div>
          <div className="h-20" />
        </div>
        {basket}
      </>
    ),
    review: () => (
      <div className="pb-[calc(9rem+env(safe-area-inset-bottom))]">
        {backBar(undefined, 'Your shoot')}
        <div className="px-4 pt-4 pb-8 space-y-6">
          {addingTo('shoot')}
          <div {...T('name')} className="space-y-3">
            <input value={video} onChange={e => setVideo(e.target.value.slice(0, 120))} placeholder="Shoot or video name *" className={input} />
            <div className={`${input} text-pt-muted min-h-[72px]`}>Anything the arts department should know (optional)</div>
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-2"><p className="text-pt-muted text-xs uppercase tracking-wider">Props ({picked.length}) · arts department</p><span className="text-pt-accent text-sm">+ Add props</span></div>
            <div className="space-y-2">
              {picked.map((p, n) => (
                <div key={n} className="flex items-center gap-3 bg-pt-surface border border-pt-border rounded-2xl p-3">
                  <span className="w-14 h-14 rounded-xl bg-pt-border overflow-hidden shrink-0">{thumb(p) && <img src={thumb(p)} alt="" className="w-full h-full object-cover" />}</span>
                  <div className="flex-1 min-w-0"><p className="text-pt-text text-sm font-medium truncate">{propName(p, n)}</p><p className="text-green-400 text-xs">Free</p></div>
                  <span className="text-pt-muted text-2xl px-2">×</span>
                </div>
              ))}
            </div>
          </div>
          <div {...T('make')}>
            <p className="text-pt-muted text-xs uppercase tracking-wider mb-2">To build or source ({builds.length})</p>
            <div className="space-y-2">
              {builds.map((b, n) => (
                <div key={n} className="flex items-center gap-3 bg-pt-surface border border-violet-500/40 rounded-2xl p-3">
                  <div className="w-14 h-14 rounded-xl bg-violet-500/10 shrink-0 flex items-center justify-center text-2xl">🛠️</div>
                  <div className="flex-1 min-w-0"><p className="text-pt-text text-sm">{b.description}</p><p className="text-violet-300 text-xs">To build or source · ×{b.qty}</p></div>
                  <span className="text-pt-muted text-2xl px-2">×</span>
                </div>
              ))}
            </div>
            {showBuild || step.id === 'makeform' ? (
              <div className="mt-2 bg-pt-surface shadow-hairline rounded-2xl p-3 space-y-3">
                <textarea value={buildDesc} onChange={e => setBuildDesc(e.target.value.slice(0, 500))} rows={2} placeholder="What do you need? e.g. Half-eaten birthday cake, chocolate" className={`${input} resize-none`} />
                <div className="flex items-center gap-3">
                  <span className="text-pt-muted text-sm">How many?</span>
                  <button onClick={() => setBuildQty(q => Math.max(1, q - 1))} className="w-9 h-9 rounded-full bg-pt-bg shadow-hairline text-pt-text">−</button>
                  <span className="text-pt-text w-6 text-center">{buildQty}</span>
                  <button onClick={() => setBuildQty(q => Math.min(20, q + 1))} className="w-9 h-9 rounded-full bg-pt-bg shadow-hairline text-pt-text">+</button>
                </div>
                <div className="flex gap-2">
                  <span className="flex-1 grid place-items-center py-3 rounded-xl shadow-hairline text-pt-muted text-sm">Cancel</span>
                  <button onClick={addBuild} disabled={!buildDesc.trim()} className="flex-1 py-3 rounded-xl bg-violet-500 text-white text-sm font-semibold disabled:opacity-40">Add request</button>
                </div>
              </div>
            ) : (
              <button onClick={() => { if (step.id === 'make') { setShowBuild(true); advance() } }} className="mt-2 w-full py-3 rounded-2xl border border-dashed border-violet-500/60 text-violet-300 text-sm font-medium">+ Request something we don't have</button>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between"><p className="text-pt-muted text-xs uppercase tracking-wider">Gear (1) · equipment team</p><span className="text-pt-accent text-sm">+ Add gear</span></div>
            <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
              <div className="flex items-center gap-3 px-3 py-3">
                <GearArt photo={kit?.photos?.[0]} category={kit?.category} className="w-12 h-12 rounded-xl shrink-0" />
                <div className="min-w-0 flex-1"><p className="text-pt-text text-sm font-medium truncate">{kitName}</p><p className="text-pt-muted text-xs">Bundle · {fmtHours(START, START + SLOT)}</p></div>
                <span className="text-pt-muted text-2xl px-2">×</span>
              </div>
            </div>
            <p className="text-pt-muted text-xs leading-snug px-1">Gear: pick up {formatDay(day)} at {fmtTime(START)} from the equipment cage; back by {fmtTime(START + SLOT)}. Return photo required.</p>
          </div>
        </div>
        <div className="fixed bottom-0 inset-x-0 px-4 pt-3 pb-safe bg-pt-bg border-t border-pt-border">
          <button {...T('send')} onClick={tap('send')} className="w-full bg-pt-accent text-stone-900 py-4 rounded-2xl font-semibold text-lg mb-3 shadow-gold">Book props + gear</button>
        </div>
      </div>
    ),
    sent: () => (
      <div className="pb-12">
        {backBar(statusPill('requested', 'Requested'))}
        <div className="px-4 pt-4 pb-8 space-y-6">
          {banner('green', "You're booked ✓", "These props are held for your dates. You'll see the status change here as the arts department gets them ready.")}
          <div><h1 className="font-display text-2xl text-pt-text leading-tight">{title}</h1><p className="text-pt-text mt-1">📅 {formatDay(day)}</p></div>
          {shootLink('gear')}
          {journey('requested')}
          {contents(false)}
          <div className="flex gap-2"><span className="flex-1 grid place-items-center bg-pt-surface rounded-xl py-3 font-semibold">Change</span><span className="flex-1 grid place-items-center bg-pt-surface rounded-xl py-3 font-semibold">+ Add more</span></div>
        </div>
      </div>
    ),
    home2: () => (
      <div className="pb-10">{homeHeader}<div className="px-5 mt-4 space-y-4">{nextShootCard}{searchAndAi}</div></div>
    ),
    me: () => (
      <div className="pb-6">
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
          <h1 className="font-display text-[34px] text-pt-text py-2 flex items-center gap-3"><span className="flex-1">Me</span>{aiPill()}</h1>
        </div>
        <div className="px-4 pt-4 pb-8 space-y-6">
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 flex items-center gap-4">
            <span className="relative"><Avatar email={profile.email} name={name} size={72} /><span className="absolute -bottom-1 -right-1 bg-pt-accent text-stone-900 rounded-full w-7 h-7 grid place-items-center text-sm">✎</span></span>
            <span className="min-w-0"><b className="block text-pt-text truncate">{name}</b><span className="block text-pt-muted text-xs truncate">{profile.email}</span><span className="block text-pt-accent text-sm">Creator</span></span>
          </div>
          <div className="rounded-2xl p-4 text-sm bg-pt-surface shadow-hairline"><p className="text-pt-text font-semibold">No strikes</p><p className="text-pt-muted">Strikes come from no-shows, late cancels and upheld reports.</p></div>
          <div className="bg-pt-surface shadow-hairline rounded-2xl divide-y divide-white/[0.06]">
            {[['My requests', 'Props and gear for each shoot, and where they are'], ['Help', 'How do I…? Booking, props, gear, check-in, sign-in'], ['App tour', 'Practise booking a shoot again, step by step'], ['How it works', 'Slots, cutoffs, check-ins, strikes']].map(([t, d], n) => (
              <button key={t} {...(n === 0 ? T('myrequests') : {})} onClick={n === 0 ? tap('myrequests') : undefined} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <span className="flex-1 min-w-0"><span className="block text-pt-text">{t}</span><span className="block text-pt-muted text-xs">{d}</span></span><span className="text-pt-muted">›</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    ),
    requests: () => {
      const packed = idx >= I('packed')
      return (
        <div className="pb-6">
          <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
            <span className="block text-pt-accent text-[17px] py-1">‹ Me</span>
            <h1 className="font-display text-[34px] text-pt-text py-1">My requests</h1>
            <div className="flex gap-2"><span className="px-3 py-1 rounded-full text-sm bg-pt-accent text-stone-900 font-medium">Upcoming (1)</span><span className="px-3 py-1 rounded-full text-sm bg-pt-surface shadow-hairline text-pt-muted">Past</span></div>
          </div>
          <div className="px-4 space-y-3">
            <div {...T('card')} className="bg-pt-surface shadow-card rounded-[20px] p-3 space-y-2">
              <div className="w-full flex items-center gap-3 text-left px-1">
                <span className="w-12 shrink-0 text-center"><span className="block text-[11px] font-semibold text-pt-accent">{formatDay(day, { weekday: 'short' }).toUpperCase()}</span><span className="block text-[24px] font-bold leading-none text-pt-text">{Number(day.slice(8))}</span></span>
                <span className="flex-1 min-w-0"><b className="block text-pt-text text-[15px] truncate">{shootLabel}</b><span className="block text-pt-muted text-xs truncate">{title}</span></span>
                <span className="text-pt-muted">›</span>
              </div>
              <div {...T('propsrow')}>
                <RequestRow className="bg-pt-bg" label="🎬 Props & costumes" onOpen={tap('propsrow')} l={{ id: 'p', kind: 'props', title, status: packed ? 'packed' : 'requested', count: picked.length + builds.length }} />
              </div>
              <RequestRow className="bg-pt-bg" label={`🎥 Gear · ${fmtSlot(START, SLOT)}`} onOpen={() => {}} l={{ id: 'g', kind: 'gear', title, status: 'held', count: 1 }} />
              <div className="w-full rounded-lg py-3 text-sm font-semibold text-pt-accent bg-pt-accent/10 text-center">+ Add props or gear <span className="font-normal text-pt-muted">· by {formatDay(cut.gear)}</span></div>
            </div>
          </div>
        </div>
      )
    },
    pickup: () => (
      <div className="pb-12">
        {backBar(statusPill('packed', 'Packed & ready'))}
        <div className="px-4 pt-4 pb-8 space-y-6">
          <div><h1 className="font-display text-2xl text-pt-text leading-tight">{title}</h1><p className="text-pt-text mt-1">📅 {formatDay(day)}</p></div>
          {journey('packed')}
          {contents(true)}
          {props.length > 0 && <div><p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Packed · {formatDay(today)}</p><PhotoStrip urls={picked.flatMap(p => { const t = thumb(p); return t ? [t] : [] })} title="What was packed" /></div>}
          <div className="bg-pt-accent/10 border border-pt-accent/50 rounded-2xl p-4 space-y-3">
            <p className="text-pt-accent font-semibold text-lg">Ready for pickup!</p>
            <p className="text-pt-text text-sm">When you collect, check you have everything below, then sign off. This confirms what you took.</p>
            <ul className="space-y-1">{picked.map((p, n) => <li key={n} className="text-pt-text text-sm">☐ {propName(p, n)} <strong>×1</strong></li>)}</ul>
            <div className="space-y-2">
              <button {...T('sign')} onClick={tap('sign')} className="w-full py-4 rounded-xl bg-pt-accent text-stone-900 font-semibold shadow-gold">✓ I've got everything</button>
              <span className="block w-full py-3 rounded-xl shadow-hairline text-pt-text text-sm text-center">Something's missing or wrong</span>
            </div>
          </div>
        </div>
      </div>
    ),
    gearpickup: () => (
      <div className="pb-10">
        <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-2 py-2 flex items-center"><span className="text-pt-accent text-[17px] px-2 py-1">‹ Back</span></div>
        <div className="px-4 space-y-4">
          <div className="space-y-1">
            <div className="flex gap-2"><Pill tone="info">Held</Pill></div>
            <h1 className="font-display text-[34px] text-pt-text leading-tight">{title}</h1>
            <p className="text-pt-muted">{formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' })} · {fmtHours(START, START + SLOT)}</p>
          </div>
          <div className="space-y-1">
            <div className="grid grid-cols-4 gap-1">{[0, 1, 2, 3].map(i => <div key={i} className={`h-1.5 rounded-full ${i === 0 ? 'bg-pt-accent' : 'bg-pt-border'}`} />)}</div>
            <div className="grid grid-cols-4 gap-1 text-[11px] text-center">{['Held', 'Picked up', 'Returned', 'Checked in'].map((x, i) => <span key={x} className={i === 0 ? 'text-pt-accent' : 'text-pt-muted'}>{x}</span>)}</div>
          </div>
          {shootLink('props')}
          <div className="bg-pt-surface rounded-2xl divide-y divide-white/[0.06]">
            {[['Pick up', `${formatDay(day)} · ${fmtTime(START)}`], ['Back by', fmtTime(START + SLOT)], ['Where', 'Equipment cage']].map(([a, b]) => <div key={a} className="flex justify-between px-4 py-3 text-[15px]"><span className="text-pt-muted">{a}</span><span className="text-pt-text">{b}</span></div>)}
          </div>
          <section className="space-y-3">
            <div><h2 className="text-pt-text text-xl font-semibold tracking-tight">Pick up</h2><p className="text-pt-muted text-sm">Open the case and tick what's there. Tap "Missing?" for anything that isn't.</p></div>
            <div {...T('pieces')}>
              <PieceChecklist lines={pieceLines} ticked={ticked} missing={missing}
                onTick={k => { if (step.id !== 'pieces') return; setTicked(t => toggle(t, k)); setMissing(m => { const n = new Set(m); n.delete(k); return n }) }}
                onMissing={k => { if (step.id === 'pieces') setMissing(m => toggle(m, k)) }} />
            </div>
            {missing.size > 0 && <p className="text-red-200 text-sm bg-red-500/10 rounded-xl px-4 py-3">{missing.size} piece{missing.size > 1 ? 's' : ''} reported missing <b>before you took it</b>. The equipment team will see it, and it goes on the record of whoever had it last.</p>}
            <p className="text-amber-200 text-sm">Report anything missing now. Once you sign, the gear is your responsibility until it's back.</p>
            <button {...T('gearsign')} onClick={tap('gearsign')} disabled={!allTicked} className="w-full py-4 rounded-2xl bg-pt-accent text-stone-900 font-semibold disabled:opacity-40 shadow-gold">Sign: I've got it</button>
            {!allTicked && <p className="text-pt-muted text-xs text-center">Tick every piece, or mark it missing, to sign.</p>}
          </section>
        </div>
      </div>
    ),
    checkin: () => sheet('Your shoot', (
      <div className="space-y-3">
        {shootTop(1)}
        <div className="bg-pt-bg rounded-xl p-3 space-y-3">
          <p className="text-pt-text font-semibold">You're up: check in</p>
          {camTile(setPhoto, 'Photo of the set', 'Opens your camera')}
          <div {...T('report')} className="space-y-2">
            <p className="text-pt-muted text-sm">The slot before you: <b className="text-pt-text">another creator</b>. Anything wrong? The team reviews every report.</p>
            <div className="flex flex-wrap gap-2">
              {([['Ran over into my time', over, setOver], ['House left a mess', mess, setMess]] as const).map(([x, on, set]) => (
                <button key={x} onClick={() => step.id === 'report' && set(!on)} className={`px-3 py-2 rounded-full text-sm border ${on ? 'border-pt-accent text-pt-accent bg-pt-accent/10' : 'border-transparent bg-pt-surface text-pt-text'}`}>{x}</button>
              ))}
            </div>
          </div>
          <button {...T('checkin')} onClick={tap('checkin')} className={btnGold}>{over || mess ? 'Check in and send report' : 'Check in'}</button>
        </div>
      </div>
    )),
    wrap: () => sheet('Your shoot', (
      <div className="space-y-3">
        {shootTop(2)}
        <div className="bg-pt-bg rounded-xl p-3 space-y-2">
          <p className="text-pt-text text-sm">Checked in {fmtTime(START - 5)}</p>
          {setPhoto && <div><p className="text-pt-muted text-xs uppercase tracking-wider mb-2">Set photo</p><img src={setPhoto} alt="" className="w-24 h-24 rounded-xl object-cover" /></div>}
          <div {...T('wrap')} className="flex gap-2">
            <input value={wrapText} onChange={e => setWrapText(e.target.value.slice(0, 120))} placeholder="What did you film?" className={field} />
            <button onClick={tap('wrap')} className="shrink-0 bg-pt-accent text-stone-900 font-semibold rounded-xl px-4">Wrap</button>
          </div>
        </div>
      </div>
    )),
    return: () => (
      <div className="pb-12">
        {backBar(statusPill('collected', 'Collected'))}
        <div className="px-4 pt-4 pb-8 space-y-6">
          <div><h1 className="font-display text-2xl text-pt-text leading-tight">{title}</h1><p className="text-pt-text mt-1">📅 {formatDay(day)}</p></div>
          {journey('collected')}
          {banner('amber', 'Bring these back the night of the shoot', 'They count as late after 10 AM the next open day.')}
          <div className="bg-pt-surface shadow-hairline rounded-2xl p-4 space-y-3">
            <p className="text-pt-text font-semibold">Returning</p>
            {camTile(retPhoto, "📷 Photo of everything you're returning (required)", "Show all the props together where you're leaving them. This protects you if anything is questioned later.")}
            <div className="w-full bg-pt-bg border border-pt-border rounded-xl px-3 py-2 text-sm text-pt-muted min-h-[56px]">Where did you leave them? Anything to flag? (optional)</div>
            <div className="flex gap-2">
              <span className="flex-1 grid place-items-center py-3 rounded-xl shadow-hairline text-pt-muted text-sm">Back</span>
              <button {...T('returned')} onClick={tap('returned')} className="flex-[2] py-3 rounded-xl bg-pt-accent text-stone-900 font-semibold shadow-gold">Confirm return</button>
            </div>
          </div>
        </div>
      </div>
    ),
    ai: () => (
      <div className="pb-10">{homeHeader}<div className="px-5 mt-4 space-y-4">{nextShootCard}{searchAndAi}</div></div>
    ),
    chat: () => {
      const hits = asked ? found(asked.split(/\s+/).filter(w => w.length > 3).slice(0, 4).join(' ')) : []
      const words4 = asked.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3)
      const loose = words4.length ? all.filter(i => words4.some(w => hay(i).includes(w))) : []
      const answer = [...new Set([...hits, ...loose, ...all.slice(2)])].slice(0, 3)
      return (
        <div className="min-h-full flex flex-col">
          <div className="pt-safe px-5 shrink-0">
            <div className="flex items-center justify-between py-3"><span className="text-pt-accent text-[17px]">‹ Back</span></div>
            <h1 className="font-display text-[28px] font-extrabold tracking-tight flex items-center gap-2"><span className="text-[#BF9DFF]">✦</span>AI helper</h1>
            <p className="text-pt-muted text-[13px]">Ideas from our real props and gear, and times that are actually free.</p>
          </div>
          <div className="flex-1 px-5 py-4 space-y-3">
            <p className="max-w-[86%] w-fit rounded-[20px] rounded-bl-md px-4 py-3 text-[15px] bg-[#BF9DFF]/10 border border-[#BF9DFF]/25">Hi{first ? ` ${first}` : ''}! Tell me your video idea, or when you want to film, or both. I'll find the props we have and the times that are free.</p>
            {asked && (
              <>
                <p className="ml-auto max-w-[86%] w-fit rounded-[20px] rounded-br-md px-4 py-3 text-[15px] text-stone-900 bg-pt-accent shadow-gold">{asked}</p>
                <div {...T('answer')} className="space-y-2">
                  <p className="max-w-[86%] w-fit rounded-[20px] rounded-bl-md px-4 py-3 text-[15px] bg-[#BF9DFF]/10 border border-[#BF9DFF]/25">Here's what we have that could work for that.</p>
                  {answer.map(p => (
                    <div key={p.id} className="flex items-center gap-3 bg-pt-surface rounded-2xl p-3">
                      <span className="w-[52px] h-[52px] rounded-xl bg-pt-border overflow-hidden shrink-0">{thumb(p) && <img src={thumb(p)} alt="" className="w-full h-full object-cover" />}</span>
                      <span className="flex-1 min-w-0"><b className="block text-sm truncate">{p.name}</b><span className="block text-xs text-[#CDB8FF]">Could fit your idea</span><span className="block text-xs text-pt-muted">Free · check it ›</span></span>
                      <span className="w-11 h-11 rounded-full grid place-items-center font-bold shrink-0 bg-pt-border text-pt-text text-xl">+</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="shrink-0 border-t border-pt-border px-5 pt-3 pb-safe bg-pt-bg">
            <div {...T('composer')} className="flex items-center gap-2 pb-2">
              <input value={idea} onChange={e => setIdea(e.target.value.slice(0, 200))} onKeyDown={e => { if (e.key === 'Enter') askAi() }} placeholder="Your video idea, or when to film…"
                className="flex-1 min-w-0 bg-pt-surface border border-pt-border rounded-2xl px-4 py-3 text-base focus:outline-none focus:border-[#BF9DFF]" />
              <button onClick={askAi} disabled={idea.trim().length < 3} aria-label="Send" className="w-12 h-12 rounded-full grid place-items-center shrink-0 bg-pt-accent text-stone-900 text-xl font-bold disabled:opacity-40">↑</button>
            </div>
          </div>
        </div>
      )
    },
    rules: () => (
      <div className="pt-safe px-4 pb-8 space-y-4">
        <h1 className="font-display text-[34px] text-pt-text pt-2">Good to know</h1>
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
        <div className="space-y-5">
          <p className="text-7xl">🎉</p>
          <h1 className="font-display text-[30px] font-extrabold">You're ready!</h1>
          <p className="text-pt-muted text-[15px]">That's the whole thing: book a time, add props and gear, pick up, check in, bring it back.</p>
          <button onClick={finish} className="w-full rounded-2xl py-4 font-bold text-stone-900 bg-pt-accent shadow-gold">{required ? 'Start using the app' : 'Done'}</button>
        </div>
      </div>
    ),
  }

  // Which tab is lit (as in the real app). Full-screen pages (Your shoot review, request pages, AI) have no tab bar.
  const TAB: Partial<Record<Scene, string>> = { home: 'Home', home2: 'Home', ai: 'Home', find: 'Book', bookit: 'Book', shoot: 'Book', checkin: 'Book', wrap: 'Book', browse: 'Browse', gear: 'Browse', me: 'Me', requests: 'Me' }
  const lit = TAB[step.scene]
  const tipCount = STEPS.filter(x => x.tip).length
  const tipNo = STEPS.slice(0, idx + 1).filter(x => x.tip).length

  return (
    <div className="fixed inset-0 z-[60] bg-pt-bg flex flex-col" role="dialog" aria-label="App tour (practice)">
      <div className="flex-1 overflow-y-auto">{scenes[step.scene]()}</div>
      {lit && (
        <nav className="shrink-0 flex bg-black/80 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.1)] pb-tabbar">
          {['Home', 'Book', 'Browse', 'Me'].map(t => (
            <button key={t} {...(t === 'Me' ? T('nav-me') : {})} onClick={t === 'Me' ? tap('nav-me') : undefined}
              className={`flex-1 flex flex-col items-center gap-0.5 pt-2 pb-0 text-xs ${lit === t ? 'text-pt-accent' : 'text-pt-muted'}`}>
              {TAB_ICONS[t]}<span>{t}</span>
            </button>
          ))}
        </nav>
      )}
      {step.id === 'packed' && (
        <div className="fixed top-3 inset-x-3 z-[80] rounded-[20px] bg-pt-raised/95 shadow-float px-4 py-3 flex items-center gap-3" style={{ marginTop: 'env(safe-area-inset-top)' }}>
          <span className="w-9 h-9 rounded-xl bg-black grid place-items-center"><BrandMark className="w-6 text-white" title="" /></span>
          <span className="flex-1 min-w-0"><b className="block text-sm">Prime Capitol <span className="font-normal text-pt-muted">· now</span></b><span className="block text-sm truncate">Your props for {title} are packed and ready ✓</span></span>
        </div>
      )}
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { shot(e.target.files?.[0]); e.target.value = '' }} />
      {step.tip && <Spotlight key={step.id} target={step.target} tip={step.tip} step={tipNo} total={tipCount} next={step.next} onNext={advance} nextDisabled={step.id === 'name' && video.trim().length < 2} onSkip={step.skip ? advance : undefined} onClose={required ? undefined : onFinish} />}
    </div>
  )
}
