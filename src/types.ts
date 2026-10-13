import type { PropCollection } from '../functions/src/collections'
export type ItemType = 'prop' | 'costume' | 'set-dressing' | 'gear';
// 'damaged' is a legacy status from before condition was its own field;
// items are normalized on read so the app only ever sees available/checked-out.
export type ItemStatus = 'available' | 'damaged' | 'checked-out';
export type Condition = 'good' | 'fair' | 'damaged';

export interface CheckedOutInfo {
  label: string;
  checkedOutAt: string; // ISO date string
}

// The shape the app works with. Older records in the database may be missing
// the newer fields; services/items.ts fills sensible defaults when reading.
export interface Item {
  id: string;
  name: string;
  photos: string[];         // photo URLs, first one is the cover
  photoUrl?: string;        // legacy single photo — kept in sync with photos[0]
  description?: string;     // short "what it looks like" line (AI can suggest)
  searchWords?: string[];   // hidden extra search words (AI suggests; staff can edit)
  searchWordsAt?: string;   // when the one-off "Improve search words" top-up did this prop
  notes?: string;           // "Notes for creators": visible to everyone
                            // (internal notes live in item_private/{id}, staff only)
  tags: string[];           // tag IDs from the master tag list
  characters?: string[];    // character IDs (arts department only)
  character?: string;       // legacy single-string field (migrated on edit)
  categoryId: string;       // ID in the categories collection
  itemType?: ItemType;      // legacy — old records used this as the category
  quantity: number;         // how many identical units exist (1 = one-of-a-kind)
  missingQty?: number;      // units reported missing at a return; not bookable until found
  condition: Condition;
  locationId?: string;
  binId?: string;
  status: ItemStatus;
  checkedOutInfo?: CheckedOutInfo;
  replacementCost?: number; // what it would cost to replace one unit
  cost?: number;            // legacy — read as replacementCost when that is missing
  whereToRebuy?: string;    // e.g. "Dollarama" or "Amazon: search 'fake eyeballs'"
  archived: boolean;        // archived props are hidden, never deleted
  importedFrom?: { driveFileId: string; fileName: string; folder: string; mergedPhotos?: number }; // set on props from the batch import
  collection: PropCollection; // 'company' = Prime Capitol (everyone); 'personal' = the owner's own (owner only)
  embedding?: number[];     // legacy: from a retired AI model, no longer used or written
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface Category {
  id: string;
  label: string;
  order: number;
  active: boolean;          // hidden categories stay on old props but can't be picked
  turnaroundDays?: number;  // days before a prop in this category can go out again (blank = default)
}

export type Role = 'owner' | 'arts' | 'creator';

export interface AppUser {
  email: string;            // lowercase; also the document ID
  name?: string;
  role: Role;
  active: boolean;
  invitedBy?: string;
  invitedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
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
  photoAnalyses?: number;   // AI filling in a new prop from its photo
  smartSearches?: number;   // "Similar, might work too" lookups
  indexUpdates?: number;    // props (re)fingerprinted for smart search
  taggingCalls?: number;    // legacy counters from before Phase 2
  embeddingCalls?: number;
}
