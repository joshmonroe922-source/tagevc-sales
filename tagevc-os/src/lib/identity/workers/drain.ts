/**
 * Drain identity worker jobs — thin wrapper over dispatch (canonical).
 */

import { runIdentityWorkerBatch } from '@/lib/identity/workers/dispatch';

export type DrainSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  blocked: number;
  results: Array<{ job_id: string; command: string; ok: boolean; detail: string }>;
};

export async function drainIdentityWorkerJobs(
  limit = 10,
): Promise<DrainSummary> {
  const out = await runIdentityWorkerBatch({ limit });
  return {
    ...out,
    results: [],
  };
}
