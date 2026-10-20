// Friendly date labels for 'YYYY-MM-DD' days (always treated as local calendar days).
export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-CA', opts)
}

export function formatRange(start: string, end: string) {
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`
}

// "Today" / "Tomorrow" / "In 3 days" / "In 2 weeks" for a shoot day.
export function whenLabel(day: string, today: string) {
  const n = Math.round((new Date(`${day}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000)
  return n < 0 ? formatDay(day) : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 7 ? `In ${n} days` : `In ${Math.round(n / 7)} week${Math.round(n / 7) === 1 ? '' : 's'}`
}
