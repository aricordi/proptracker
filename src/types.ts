export type ItemType = 'prop' | 'costume' | 'set-dressing' | 'gear';
export type ItemStatus = 'available' | 'damaged' | 'checked-out';

export interface CheckedOutInfo {
  label: string;
  checkedOutAt: string; // ISO date string
}

export interface Item {
  id: string;
  name: string;
  photoUrl?: string;
  description?: string;
  tags: string[];           // tag IDs from the master tag list
  characters?: string[];    // character IDs from the master character list
  character?: string;       // legacy single-string field (migrated on edit)
  itemType: ItemType;
  locationId?: string;
  binId?: string;
  status: ItemStatus;
  checkedOutInfo?: CheckedOutInfo;
  whereToRebuy?: string;    // e.g. "Dollarama" or "Amazon: search 'fake eyeballs'"
  cost?: number;
  embedding?: number[];     // semantic fingerprint, generated once on save
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface Tag {
  id: string;
  label: string;            // canonical display form, e.g. "body-parts"
  normalizedKey: string;    // lowercased + singularized, for dedup
  usageCount: number;
}

export interface Character {
  id: string;
  label: string;
  normalizedKey: string;    // lowercased, for dedup (no pluralize — proper names)
  usageCount: number;
}

export interface Location {
  id: string;
  name: string;
  notes?: string;
}

export interface Bin {
  id: string;
  label: string;
  locationId: string;
  qrSlug: string;           // unique string encoded in the bin's QR code
}

export interface ActiveCheckout {
  id: string;
  label: string;
  startedAt: string;
  itemIds: string[];
}

export interface AiUsageRecord {
  id: string;
  month: string;            // "YYYY-MM"
  taggingCalls: number;
  embeddingCalls: number;
  shoppingCalls: number;    // on-demand "where to get it" suggestions
}

// ─── Video / Pre-production checklist ───────────────────────────────────────

export type PropManifestType = 'physical' | 'ai' | 'handmade';
export type PropDecision = 'confirmed' | 'alternative' | 'buy' | 'make' | 'cut' | 'rejected';
export type MatchStatus = 'confident' | 'possible' | 'none';

export interface PropAlternative {
  itemId: string;
  score: number;
}

export interface VideoChecklistProp {
  id: string;               // normalized name slug, stable across re-syncs
  name: string;
  type: PropManifestType;
  qty: number;
  scene: string;
  notes?: string;
  physical_output?: boolean; // ai items: also needs a print

  // Match results — populated once on build, cached (never re-embedded on re-open)
  matchStatus?: MatchStatus;
  matchedItemId?: string;   // inventory item ID for confident/possible match
  matchScore?: number;
  propEmbedding?: number[]; // cached embedding for this prop's name+notes
  alternatives?: PropAlternative[]; // top candidates when matchStatus==='none'

  // User decisions
  decision?: PropDecision;
  alternativeItemId?: string; // if decision==='alternative'
  aiGenerated?: boolean;      // for ai-type props

  // Checklist state
  checked: boolean;

  // Re-sync flags (set on merge, cleared when user dismisses)
  isNew?: boolean;
  removedFromScript?: boolean;
}

export interface VideoChecklist {
  id: string;               // Drive folder ID (Firestore doc ID)
  videoTitle: string;       // from manifest "VIDEO:" line
  driveFolderName: string;  // raw Drive folder name
  manifestVersion: string;
  manifestLastRead: string; // ISO — last time manifest was fetched from Drive
  builtAt: string;          // ISO — first build time
  updatedAt: string;
  props: VideoChecklistProp[];
  checkoutId?: string;      // active checkout ID if checked out for shoot
}

export interface DriveFolderMeta {
  id: string;
  name: string;
  modifiedTime?: string;
}
