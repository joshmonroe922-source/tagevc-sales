/**
 * Domain module layout for future phases.
 *
 * lib/
 *   data/          — seed + repositories (swap to Supabase later)
 *   schemas/       — Zod validators
 *   portfolio/     — roll-up / health helpers
 *   types/         — enums + entities + RBAC
 *   rbac/          — session + permissions
 *
 * Future modules (keep pages thin; put logic under lib/):
 *   deal-flow/vc | ma | re
 *   shared-services/
 *   documents/
 *   firm/
 */
export {};
