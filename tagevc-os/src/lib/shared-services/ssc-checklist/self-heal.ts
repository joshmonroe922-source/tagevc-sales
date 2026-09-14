import { after } from 'next/server';

/**
 * Cadence self-heal, moved off the render path.
 *
 * The Shared Services hub used to `await` period generation, audit seeding, and
 * overdue escalation before its first byte — roughly 40s of sequential writes
 * across every company, on every page view. All three already run on schedule
 * via `/api/ssc/cadence-worker` (see the `full` / `escalate` / `sync` crons in
 * vercel.json), and the cron covers strictly more ground: every period type and
 * scope, not just the current and next month.
 *
 * So this is a safety net for a missed cron run, not the primary path. It stays
 * because losing it would make the hub depend entirely on cron health, but it
 * runs after the response and no more than once per TTL per warm instance —
 * the same shape as Recruit 619's roster sync throttle.
 */
const SELF_HEAL_TTL_MS = 15 * 60 * 1000;

/** Warm-instance throttle. Serverless cold starts reset it, which is fine: the
 *  point is to stop every navigation from re-running the writes, not to
 *  guarantee exactly-once. */
let lastRunAt = 0;

export function sscSelfHealDue(now: number = Date.now()): boolean {
  return now - lastRunAt > SELF_HEAL_TTL_MS;
}

/** Test seam — lets the guardrail test exercise the throttle deterministically. */
export function resetSscSelfHealThrottle() {
  lastRunAt = 0;
}

export function scheduleSscSelfHeal(actorId: string | null) {
  if (!sscSelfHealDue()) return;
  lastRunAt = Date.now();

  try {
    after(async () => {
      try {
        const { ensurePeriodInstances, seedAllCompanyAudits } = await import(
          './engine'
        );
        const { escalateOverdueSscTasks } = await import('./escalate');

        await Promise.all([
          ensurePeriodInstances({
            function: 'all',
            period_type: 'monthly',
            scope_mode: 'parent_subs',
            include_next: true,
          }),
          seedAllCompanyAudits(),
        ]);
        await escalateOverdueSscTasks({ actorId });
      } catch {
        // Fail-soft: the cron is the real guarantee.
      }
    });
  } catch {
    // after() only exists inside a request scope.
  }
}
