import { NextResponse } from 'next/server';
import { getNormalizationStatus } from '@/lib/data/normalization-status';
import { runEmptySnapshotDrills } from '@/lib/data/snapshot-drills';
import { captureException, captureMessage } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

async function authorize(request: Request): Promise<
  | { ok: true }
  | { ok: false; status: number; error: string }
> {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('x-tagevc-digest-secret');
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const bearer = request.headers.get('authorization');
  const bearerOk =
    Boolean(secret) &&
    Boolean(bearer) &&
    bearer === `Bearer ${secret}`;

  if ((secret && header === secret) || bearerOk) {
    return { ok: true };
  }

  const gate = await guardPermission('admin:users');
  if (gate.ok) return { ok: true };

  if (secret) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: false, status: 403, error: gate.error };
}

/**
 * Soak / system health check for cron or admin.
 * Alerts Sentry when sync failures, FK orphans, or empty-snapshot drills fail.
 */
async function runSoak(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const [status, drills] = await Promise.all([
      getNormalizationStatus(),
      runEmptySnapshotDrills(),
    ]);

    const issues: string[] = [];
    if (status.sync_failure_count > 0) {
      issues.push(`sync_failures=${status.sync_failure_count}`);
    }
    if (status.fk_orphan_total > 0) {
      issues.push(`fk_orphans=${status.fk_orphan_total}`);
    }
    if (status.master_data_hydrate_error) {
      issues.push(`master_hydrate=${status.master_data_hydrate_error}`);
    }
    if (!drills.ok) {
      issues.push(`drills=${drills.summary}`);
    }

    const healthy = issues.length === 0;
    if (!healthy) {
      captureMessage(`Soak health degraded: ${issues.join('; ')}`, 'warning', {
        route: 'soak-health',
        stage: status.cutover_hints.stage,
        sync_failure_count: status.sync_failure_count,
        fk_orphan_total: status.fk_orphan_total,
        stage4_ready: drills.stage4_ready,
        issues,
      });
    }

    return NextResponse.json({
      ok: true,
      healthy,
      issues,
      stage: status.cutover_hints.stage,
      sync_failure_count: status.sync_failure_count,
      fk_orphan_total: status.fk_orphan_total,
      stage4_ready: drills.stage4_ready,
      drill_summary: drills.summary,
      sentry_configured: status.sentry_configured,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    captureException(e, { route: 'soak-health' });
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'soak failed',
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return runSoak(request);
}

export async function POST(request: Request) {
  return runSoak(request);
}
