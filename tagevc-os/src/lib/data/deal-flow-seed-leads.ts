import type { Lead, LeadTask } from '@/lib/types';

/**
 * VC lead seeds intentionally empty after 2026-07-27 cleanup.
 * Prelaunch demo leads LD-001..LD-007 (Acme AI, Nova Health, Beacon Robotics,
 * Ledgerly, Orbit Data, Instant NDA origin, Instant NDA Enterprise Upsell)
 * were hard-deleted from prod so Lead Intake → Recent intake stays clear.
 * Soft-archive alone left them visible on intake history.
 */
export const INITIAL_LEADS: Lead[] = [];

/** No seed lead tasks — paired with empty INITIAL_LEADS. */
export const INITIAL_LEAD_TASKS: LeadTask[] = [];
