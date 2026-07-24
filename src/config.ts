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
// AUTHORIZED USER UIDS
// After first sign-in, the "Not authorized yet" screen shows
// each person's UID. Paste both UIDs below, then also add them
// to firestore.rules and storage.rules, and redeploy.
// To add a third user later, add their UID in all three places.
// ─────────────────────────────────────────────────────────────
export const AUTHORIZED_UIDS: string[] = [
  'JOPK1T2MkaS2BVbyS2huPzXpPWk1', // owner
  'Rg8qfcH0o1U8MxpSaNUWCIn29e73',  // keanu
  '7SNO3xpypJa6sI7p38DTJ1LXVl72', // friend #3 — rename this comment once you know their name
];

// ─────────────────────────────────────────────────────────────
// OWNER UID — used to gate Drive-dependent features (video
// pipeline, prop manifest reading) to the owner only.
// Keanu can see saved checklists but cannot re-read from Drive.
// ─────────────────────────────────────────────────────────────
export const OWNER_UID = 'JOPK1T2MkaS2BVbyS2huPzXpPWk1';

// ─────────────────────────────────────────────────────────────
// PROP MATCHING THRESHOLDS
// Cosine similarity thresholds for matching manifest props
// against inventory embeddings. Tune these if matches feel
// too loose or too strict.
// ─────────────────────────────────────────────────────────────
export const PROP_MATCH_CONFIDENT_THRESHOLD = 0.75; // auto-matched, shown to confirm
export const PROP_MATCH_POSSIBLE_THRESHOLD  = 0.55; // shown as "is this the same thing?"
