// Friendly date labels for 'YYYY-MM-DD' days (always treated as local calendar days).
export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-CA', opts)
}

export function formatRange(start: string, end: string) {
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`
}
