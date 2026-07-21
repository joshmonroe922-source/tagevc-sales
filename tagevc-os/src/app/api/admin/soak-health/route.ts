import { NextResponse } from 'next/server';
import { getNormalizationStatus } from '@/lib/data/normalization-status';
import { runEmptySnapshotDrills } from '@/lib/data/snapshot-drills';
import { recordSoakRun } from '@/lib/data/soak-state';
import { captureException, captureMessage } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';
import { createPersistClient } from '@/lib/supabase/persist-client';

async function authorize(request: Request): Promise<
  | { ok: true; source: 'cron' | 'admin' }
  | { ok: false; status: number; error: string }
> {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('x-tagevc-digest-secret');
  const bearer = request.headers.get('authorization');
  const bearerOk =
    Boolean(secret) &&
    Boolean(bearer) &&
    bearer === `Bearer ${secret}`;

  if ((secret && header === secret) || bearerOk) {
    return { ok: true, source: 'cron' };
  }

  const gate = await guardPermission('admin:users');
  if (gate.ok) return { ok: true, source: 'admin' };

  if (secret) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: false, status: 403, error: gate.error };
}

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

    let healthy = issues.length === 0;
    const fetched_at = new Date().toISOString();
    recordSoakRun({
      fetched_at,
      healthy,
      issues,
      stage: status.cutover_hints.stage,
      sync_failure_count: status.sync_failure_count,
      fk_orphan_total: status.fk_orphan_total,
      stage4_ready: drills.stage4_ready,
      drill_summary: drills.summary,
      source: auth.source,
    });
    const persist = await createPersistClient();
    const { error: observationError } = await persist
      .from('os_snapshot_soak_observations')
      .insert({
        healthy,
        issues,
        stage: status.cutover_hints.stage,
        sync_failure_count: status.sync_failure_count,
        fk_orphan_total: status.fk_orphan_total,
        stage4_ready: drills.stage4_ready,
        drill_summary: drills.summary,
        source: auth.source,
        retired_table_name:
          process.env.SNAPSHOT_RETIRED_TABLE_NAME?.trim() || null,
        observed_at: fetched_at,
      });
    if (
      observationError &&
      !observationError.message.includes('os_snapshot_soak_observations')
    ) {
      issues.push(`soak_persist=${observationError.message}`);
      healthy = false;
      recordSoakRun({
        fetched_at,
        healthy,
        issues,
        stage: status.cutover_hints.stage,
        sync_failure_count: status.sync_failure_count,
        fk_orphan_total: status.fk_orphan_total,
        stage4_ready: drills.stage4_ready,
        drill_summary: drills.summary,
        source: auth.source,
      });
    }

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
      fetched_at,
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
