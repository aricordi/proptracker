// Birthdays (owner, Oct 30): people save their birthday as 'MM-DD' (no year) on Me. On the day, the app throws them a
// little party, and everyone else gets a short "It's X's birthday today" pop-up. Pure helpers (unit-tested).
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export const isBirthday = (v: unknown): v is string => typeof v === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)
  && Number(v.slice(3)) <= DAYS_IN[Number(v.slice(0, 2)) - 1]
export const makeBirthday = (month: number, day: number) => `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
export const daysIn = (month: number) => DAYS_IN[month - 1] ?? 31
export const birthdayLabel = (v: string) => isBirthday(v) ? `${MONTHS[Number(v.slice(0, 2)) - 1]} ${Number(v.slice(3))}` : ''

// Whose birthday is it today ('YYYY-MM-DD' in Toronto)? Feb 29 birthdays are celebrated on Feb 28 in other years.
export function birthdaysOn<T extends { email: string; birthday?: string }>(today: string, people: T[]): T[] {
  const md = today.slice(5)
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const match = (b: string) => b === md || (b === '02-29' && md === '02-28' && !leap(Number(today.slice(0, 4))))
  return people.filter(p => isBirthday(p.birthday) && match(p.birthday))
}

// Only the first name (the pop-up is friendly, and that's all it needs).
export const firstName = (name: string, email: string) => (name || email.split('@')[0]).trim().split(/\s+/)[0]
