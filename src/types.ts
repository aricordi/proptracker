export type ItemType = 'prop' | 'costume' | 'set-dressing' | 'gear';
export type ItemStatus = 'available' | 'used' | 'damaged' | 'checked-out';

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
}
