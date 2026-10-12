import pluralize from 'pluralize'

// "Chairs", "chair " and "CHAIR" all become "chair", so tags don't multiply.
export function normalizeTag(input: string): string {
  return pluralize.singular(input.trim().toLowerCase().replace(/\s+/g, '-'))
}
