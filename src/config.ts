// ============================================================
// PropTracker Configuration
// All tweakable values live here. Edit freely.
// ============================================================

// AI models now live on the server: see functions/src/gemini.ts.

// "Similar, might work too" results must be at least this close a match
// (0 = unrelated, 1 = identical meaning). Raise it if suggestions feel random.
export const SIMILAR_MIN_SCORE = 0.55;

// Health page "possible duplicate props": names this similar (0–1) are flagged.
export const DUPLICATE_NAME_SIMILARITY = 0.8;

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
  { id: 'gear',         label: 'Tech props' },   // was "Gear"; real gear now has its own Gear tab
];

// Props whose replacement cost is at or above this (CAD) get a prominent
// "high-value" warning on their page.
export const HIGH_VALUE_THRESHOLD = 500;
