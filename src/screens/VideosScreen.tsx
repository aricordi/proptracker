// "Videos you're in" (owner, Nov 21): invites waiting for your answer, then the videos you said yes to, soonest first, with
// the time to be there (the shoot's start). Works for creators on Props only too (they can be invited).
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth'
import { useMyVideos, isUpcoming, inviteNote } from '../services/cast'
import { useMyShoots, useScheduleSettings, isLive } from '../services/schedule'
import { todayInStudio, addDays } from '../../functions/src/booking'
import { VideoInviteCard, VideoRow, useLeaveVideo } from '../components/CastParts'

export default function VideosScreen() {
  const navigate = useNavigate()
  const { profile } = useSession()
  const rows = useMyVideos(profile.email)
  const { leave, sheet } = useLeaveVideo()
  const live = (rows ?? []).filter(r => isUpcoming(r))
  const waiting = live.filter(r => r.status === 'pending')
  const yes = live.filter(r => r.status === 'accepted')
  // What else is on each of those days (your own shoots, other videos), so you answer and plan knowing it.
  const sets = useScheduleSettings()
  const mine = (useMyShoots(profile.email, addDays(todayInStudio(), -1)) ?? []).filter(isLive)
    .map(x => ({ id: x.id, date: x.date, start: x.start, end: x.end, label: x.place === 'offsite' ? (x.where || 'Offsite') : sets.houses[x.place].name }))
  const noteOf = (r: (typeof live)[number]) => inviteNote(r, mine, yes, r.id)
  return (
    <div className="min-h-full bg-pt-bg pb-8">
      <div className="sticky top-0 bg-pt-bg pt-safe z-10 px-4 pb-3">
        <button onClick={() => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/')} className="text-pt-accent text-[17px] min-h-[44px] pr-3 inline-flex items-center">‹ Back</button>
        <h1 className="font-display text-[34px] text-pt-text py-1">Videos you're in</h1>
        <p className="text-pt-muted text-sm">When someone invites you into their video, it shows here. Say yes and you get a reminder the night before and an hour before.</p>
      </div>
      <div className="px-4 space-y-6">
        {rows === null && <p className="text-pt-muted text-sm text-center mt-10">Loading…</p>}
        {waiting.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-pt-text text-lg font-semibold">Waiting for your answer</h2>
            {waiting.map(r => <VideoInviteCard key={r.id} row={r} note={noteOf(r)} />)}
          </section>
        )}
        {rows !== null && (
          <section>
            <h2 className="text-pt-text text-lg font-semibold">Coming up</h2>
            {yes.length === 0
              ? <p className="text-pt-muted text-sm mt-2">Nothing yet. When you say yes to a video, it shows here and on your calendar.</p>
              : <div className="divide-y divide-white/[0.06]">{yes.map(r => <VideoRow key={r.id} row={r} onLeave={() => leave(r)} note={noteOf(r)} />)}</div>}
          </section>
        )}
      </div>
      {sheet}
    </div>
  )
}
