/**
 * Scheduling / automation engine stubs (Phase 22).
 * Enqueues jobs in Postgres; workers / Connectors come in Phase 23+.
 */

import type { MarketingJobStatus } from './marketing-types';

export type ScheduleEnqueueInput = {
  content_id: string;
  account_id?: string | null;
  entity_id?: string | null;
  scheduled_for: string;
};

export type ScheduleEnqueueResult = {
  ok: boolean;
  job_id?: string;
  status?: MarketingJobStatus;
  error?: string;
};

export function isMarketingSchedulerEnabled(): boolean {
  const v = process.env.MARKETING_SCHEDULER_ENABLED?.trim();
  return v === '1' || v === 'true';
}

/**
 * Validates schedule input before persistence.
 * Does not post to social networks.
 */
export function validateScheduleInput(
  input: ScheduleEnqueueInput,
): { ok: true } | { ok: false; error: string } {
  if (!input.content_id?.trim()) {
    return { ok: false, error: 'content_id required' };
  }
  const when = Date.parse(input.scheduled_for);
  if (Number.isNaN(when)) {
    return { ok: false, error: 'scheduled_for must be a valid ISO datetime' };
  }
  return { ok: true };
}
