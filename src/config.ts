// ============================================================
// PropTracker Configuration
// All tweakable values live here. Edit freely.
// ============================================================

// Gemini AI models — free tier only. Never change to Pro models.
export const GEMINI_TAGGING_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_EMBEDDING_MODEL = 'text-embedding-004';

// Items checked out longer than this many days appear as
// "possibly forgotten" on the Health screen.
export const CHECKOUT_OVERDUE_DAYS = 5;

// Approximate free-tier monthly limits (for the Health screen usage meter).
// Update if Google changes their free tier limits.
export const FREE_TIER_MONTHLY_TAGGING_CALLS = 45000;   // ~1500/day × 30
export const FREE_TIER_MONTHLY_EMBEDDING_CALLS = 45000;

// Tags whose names are within this edit-distance are flagged as
// near-duplicates on the Health screen.
export const TAG_SIMILARITY_THRESHOLD = 3;

// ─────────────────────────────────────────────────────────────
// OWNER EMAIL — the full admin. This person can always sign in,
// even before any users are set up. Everyone else is invited from
// the Users screen. Keep in sync with firestore.rules and storage.rules.
// ─────────────────────────────────────────────────────────────
export const OWNER_EMAIL = 'alexisricordi@gmail.com';

// Categories created automatically the first time an admin opens the app.
// IDs match the old "type" values so existing props land in the right place.
export const DEFAULT_CATEGORIES = [
  { id: 'prop',         label: 'Prop' },
  { id: 'costume',      label: 'Costume' },
  { id: 'set-dressing', label: 'Set Dressing' },
  { id: 'gear',         label: 'Gear' },
];

// Props whose replacement cost is at or above this (CAD) get a prominent
// "high-value" warning on their page.
export const HIGH_VALUE_THRESHOLD = 500;
