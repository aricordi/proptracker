import type { VideoChecklistProp, PropManifestType } from '../types'

export interface ParsedManifest {
  version: string
  videoTitle: string
  props: VideoChecklistProp[]
  parseWarnings: string[]   // e.g., "1 prop couldn't be read"
}

export interface ManifestParseError {
  type: 'wrong-version' | 'malformed'
  message: string
}

// Stable ID for a prop: normalized name slug used for re-sync identity.
export function propId(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

// Returns ParsedManifest on success, or ManifestParseError if the file is
// structurally invalid or uses an unsupported version.
export function parseManifest(text: string): ParsedManifest | ManifestParseError {
  // ── Version check ──────────────────────────────────────────────────────────
  const versionMatch = text.match(/machine-readable\s*·[^·]*·\s*(v\S+)/i)
  if (!versionMatch) {
    return { type: 'malformed', message: 'No version marker found in manifest header.' }
  }
  const version = versionMatch[1].trim()
  if (version !== 'v1') {
    return {
      type: 'wrong-version',
      message: `This manifest uses format ${version}, which the app doesn't support yet. Generate a fresh manifest in Cowork to update it.`,
    }
  }

  // ── Video title ────────────────────────────────────────────────────────────
  const videoTitleMatch = text.match(/^VIDEO:\s*(.+)$/m)
  const videoTitle = videoTitleMatch?.[1].trim() ?? 'Untitled Video'

  // ── Prop blocks ────────────────────────────────────────────────────────────
  // Split on lines starting with "- name:"
  const sections = text.split(/(?=^- name:)/m).filter(s => s.trim().startsWith('- name:'))

  const props: VideoChecklistProp[] = []
  let skipped = 0
  const warnings: string[] = []

  for (const block of sections) {
    // Stop at END marker
    if (block.includes('END PROP MANIFEST')) break

    try {
      const prop = parsePropBlock(block)
      if (prop) props.push(prop)
      else skipped++
    } catch {
      skipped++
    }
  }

  if (skipped > 0) {
    warnings.push(`${skipped} prop${skipped !== 1 ? 's' : ''} couldn't be read and were skipped.`)
  }

  return { version, videoTitle, props, parseWarnings: warnings }
}

function parsePropBlock(block: string): VideoChecklistProp | null {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
  const kv: Record<string, string> = {}

  for (const line of lines) {
    const m = line.match(/^-?\s*(\w+):\s*(.*)$/)
    if (m) {
      const [, key, val] = m
      kv[key.toLowerCase()] = val.trim()
    }
  }

  const name = kv['name']
  if (!name) return null

  const rawType = kv['type']?.toLowerCase()
  const type: PropManifestType =
    rawType === 'ai' ? 'ai' :
    rawType === 'handmade' ? 'handmade' :
    'physical' // default for missing or unrecognized type

  const qty = kv['qty'] ? parseInt(kv['qty'], 10) || 1 : 1
  const scene = kv['scene'] ?? ''
  const notes = kv['notes'] || undefined
  const physical_output = kv['physical_output']?.toLowerCase() === 'true' ? true : undefined

  return {
    id: propId(name),
    name,
    type,
    qty,
    scene,
    notes,
    physical_output,
    checked: false,
  }
}
