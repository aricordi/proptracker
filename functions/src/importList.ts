// Import helpers for "a closet or rack, no bins" and an inventory list to check against (owner, Nov 5: the wardrobe
// closet was photographed with no bin signs, and Keith's typed list "WR List" says what's in it). PURE, unit-tested.
//  - place: every photo goes to ONE spot (e.g. "Wardrobe closet"); the AI doesn't look for bin signs.
//  - list: a team member's typed inventory (a Google Doc / Sheet / text file). The AI uses it only to CHECK itself
//    (kind of item, colour, size, how many); it names what it sees, never copies the list's wording.

export const PLACE_MAX = 40
export const LIST_MAX_CHARS = 30_000
export const DEFAULT_PLACE = 'Wardrobe closet'

/** The spot name the owner typed, tidied; '' = photos have bin signs (the normal import). */
export function cleanPlace(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PLACE_MAX)
}

/** A Drive FILE id from a Docs / Sheets / Drive link or a bare id ('' when it isn't one). Folder links are not files. */
export function fileIdFrom(link: unknown): string {
  if (typeof link !== 'string') return ''
  const s = link.trim()
  if (/^test-list$/.test(s)) return s
  if (/\/folders\//.test(s)) return ''
  const m = s.match(/\/(?:document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{10,})/)
    ?? s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/)
    ?? s.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
    ?? s.match(/^([A-Za-z0-9_-]{25,})$/)
  return m ? m[1] : ''
}

/** File types we can read as a list: Google Docs/Sheets (exported as text) and plain text / CSV files. */
export const LIST_TYPES: Record<string, string | null> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'text/plain': null,
  'text/csv': null,
  'text/markdown': null,
}
export const isListType = (mimeType: string) => mimeType in LIST_TYPES
export const WORD_TYPES = ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword']

/** The list's text, tidied: no blank-line runs, no odd characters, capped. */
export function tidyList(text: string, max = LIST_MAX_CHARS): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‍﻿]/g, '')
    .split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean)
    .join('\n')
    .slice(0, max)
}

/** Several lists (e.g. two docs in the folder) as one block, each under its name. */
export function joinLists(lists: { name: string; text: string }[], max = LIST_MAX_CHARS): string {
  const parts = lists.filter(l => l.text.trim()).map(l => `# ${l.name.slice(0, 80)}\n${tidyList(l.text, max)}`)
  return parts.join('\n\n').slice(0, max)
}

/** How many lines (entries) a list has, for the screen ("checked against WR List · 152 entries"). */
export const listEntries = (text: string) => tidyList(text).split('\n').filter(l => l && !l.startsWith('# ')).length

/** "Size XL" added to a description once (sizes matter for costumes; props have no size field). */
export function withSize(description: string, size: string | null | undefined): string {
  const s = (size ?? '').trim()
  if (!s) return description
  const d = description.trim()
  if (new RegExp(`\\bsize\\s*:?\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(d)) return d
  return `${d}${d && !/[.!?]$/.test(d) ? '.' : ''}${d ? ' ' : ''}Size ${s}.`.slice(0, 300)
}
