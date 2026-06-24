// ============================================================
// PropTracker Configuration
// All tweakable values live here. Edit freely.
// ============================================================

// Gemini AI models — free tier only. Never change to Pro models.
export const GEMINI_TAGGING_MODEL = 'gemini-2.0-flash-lite';
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
  // 'PASTE_KEANU_UID_HERE',
];
