/** Client-safe personal credit constants (no server imports). */

export const CREDIT_PRIVATE_BUCKET = 'credit-private';

export const CREDIT_STALE_DAYS = Number(
  process.env.CREDIT_STALE_DAYS?.trim() || '45',
);
