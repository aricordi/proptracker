// Which inventory a prop belongs to. Shared by the server and the app.
//  • 'company'  = Prime Capitol's props: everyone in the app can see them.
//  • 'personal' = the owner's own props at home: only the owner sees them.
// Props saved before collections existed have no field and count as personal
// (they were all the owner's), so no existing data had to change.
export type PropCollection = 'personal' | 'company'

export const COLLECTION_LABELS: Record<PropCollection, string> = {
  company: 'Prime Capitol',
  personal: 'Personal',
}

export function collectionOf(item: { collection?: unknown } | undefined | null): PropCollection {
  return item?.collection === 'company' ? 'company' : 'personal'
}
