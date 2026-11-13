// Friendly date labels for 'YYYY-MM-DD' days (always treated as local calendar days).
// Takes a day ('YYYY-MM-DD') or a stamp ('YYYY-MM-DDTHH:MM'). A stamp with a real time (props cutoffs, Nov 13)
// also shows it: "Thu, Nov 13, 5 PM"; '…T23:59' means "any time that day" and shows the day only.
export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const out = new Date(`${day.slice(0, 10)}T12:00:00`).toLocaleDateString('en-CA', opts)
  const t = day.length >= 16 ? day.slice(11, 16) : ''
  if (!t || t === '23:59') return out
  const h = Number(t.slice(0, 2)), m = t.slice(3, 5)
  return `${out}, ${h % 12 || 12}${m === '00' ? '' : ':' + m} ${h < 12 ? 'AM' : 'PM'}`
}

export function formatRange(start: string, end: string) {
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`
}

// "Today" / "Tomorrow" / "In 3 days" / "In 2 weeks" for a shoot day.
export function whenLabel(day: string, today: string) {
  const n = Math.round((new Date(`${day}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000)
  return n < 0 ? formatDay(day) : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 7 ? `In ${n} days` : `In ${Math.round(n / 7)} week${Math.round(n / 7) === 1 ? '' : 's'}`
}

// 'YYYY-MM-DD' in studio time (Toronto) for a saved ISO time (UTC). Never cut the day straight off the ISO text:
// from about 7–8 PM in Toronto the UTC date is already tomorrow.
export function studioDayOf(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso ?? '').slice(0, 10)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
}
