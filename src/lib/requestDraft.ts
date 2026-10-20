// A sent request being changed (owner, Oct 20): "Change your request" can open the whole closet (Browse) to add props.
// The edit in progress is kept here (this browser tab only) so Browse can add to it and the request page picks it up.
export interface RequestDraft {
  lines: Record<string, number>          // itemId → how many (the full list being edited)
  orig: Record<string, number>           // what the request had when editing started
  builds: { description: string; qty: number; refPhoto?: string }[]
}
const KEY = (id: string) => `pc.requestDraft.${id}`
export function readRequestDraft(id: string): RequestDraft | null {
  try { const d = JSON.parse(sessionStorage.getItem(KEY(id)) || 'null'); return d && d.lines ? { orig: {}, builds: [], ...d } : null } catch { return null }
}
export function writeRequestDraft(id: string, d: RequestDraft) { try { sessionStorage.setItem(KEY(id), JSON.stringify(d)) } catch { /* private mode */ } }
export function clearRequestDraft(id: string) { try { sessionStorage.removeItem(KEY(id)) } catch { /* private mode */ } }
