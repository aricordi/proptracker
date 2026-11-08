import { useState } from 'react'
import { useProfiles, photoOf } from '../services/profiles'

// Warm, calm colours for initials (picked from the email, so a person always gets the same one).
const TONES = ['#6E572F', '#485672', '#586548', '#724856', '#48726C', '#614872', '#726148', '#486172']

export function initials(name: string) {
  const w = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean)
  return ((w[0]?.[0] ?? '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase()
}

// A round face: their photo (uploaded, else Google's), or initials on a colour.
export default function Avatar({ email, name, size = 32, ring = false }: { email?: string; name: string; size?: number; ring?: boolean }) {
  const profiles = useProfiles()
  const [broken, setBroken] = useState(false)
  const photo = email ? photoOf(profiles[email]) : ''
  const tone = TONES[[...(email || name)].reduce((n, c) => n + c.charCodeAt(0), 0) % TONES.length]
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) }
  const cls = `shrink-0 rounded-full overflow-hidden grid place-items-center font-semibold text-white ${ring ? 'ring-2 ring-pt-accent' : ''}`
  if (photo && !broken) return <img src={photo} alt="" style={style} className={`${cls} object-cover`} onError={() => setBroken(true)} referrerPolicy="no-referrer" />
  return <span style={{ ...style, background: tone }} className={cls} aria-hidden="true">{initials(name)}</span>
}

