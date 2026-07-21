import { NextResponse } from 'next/server';
import { getNormalizationStatus } from '@/lib/data/normalization-status';
import { runEmptySnapshotDrills } from '@/lib/data/snapshot-drills';
import { recordSoakRun } from '@/lib/data/soak-state';
import { captureException, captureMessage } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { persistSnapshotDrillEvidence } from '@/lib/data/snapshot-drill-evidence';

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

async function persistSoakEvidence(input: {
  healthy: boolean;
  issues: string[];
  stage: string;
  syncFailureCount: number;
  fkOrphanTotal: number;
  stage4Ready: boolean;
  drillSummary: string;
  source: 'cron' | 'admin';
  observedAt: string;
  drillRunId: string | null;
  configFingerprint: string | null;
  evidenceSha256: string | null;
}): Promise<{ error?: string; epochStatus?: string }> {
  const persist = await createPersistClient();
  const retiredTable =
    process.env.SNAPSHOT_RETIRED_TABLE_NAME?.trim() || null;
  let epochId: string | null = null;
  let continuityStatus =
    input.source === 'admin'
      ? 'manual_nonqualifying'
      : retiredTable
        ? 'not_started'
        : 'pre_rename';
  let streakCount = 0;
  let streakStartedAt: string | null = null;
  const bucket = new Date(input.observedAt);
  bucket.setUTCMinutes(0, 0, 0);
  bucket.setUTCHours(Math.floor(bucket.getUTCHours() / 6) * 6);
  const observationKey = `${input.source}:${retiredTable ?? 'live'}:${bucket.toISOString()}`;
  const { data: existingObservation } = await persist
    .from('os_snapshot_soak_observations')
    .select('continuity_status')
    .eq('observation_key', observationKey)
    .maybeSingle();
  if (existingObservation) {
    return {
      epochStatus: `${String(existingObservation.continuity_status)}:duplicate_bucket`,
    };
  }
  if (retiredTable && input.source === 'cron') {
    const { data: events } = await persist
      .from('os_snapshot_retirement_events')
      .select('event_id, stage, retired_table_name, occurred_at')
      .eq('retired_table_name', retiredTable)
      .order('occurred_at', { ascending: false })
      .limit(1);
    const latestEvent = events?.[0] as
      | {
          event_id?: string;
          stage?: string;
          occurred_at?: string;
        }
      | undefined;
    const { data: epochs } = await persist
      .from('os_snapshot_soak_epochs')
      .select('*')
      .eq('retired_table_name', retiredTable)
      .in('status', ['active', 'qualified'])
      .order('created_at', { ascending: false })
      .limit(1);
    let epoch = epochs?.[0] as
      | {
          epoch_id: string;
          status: string;
          required_hours: number;
          max_gap_hours: number;
          minimum_observations: number;
          streak_started_at: string | null;
          last_observed_at: string | null;
          healthy_count: number;
          config_fingerprint: string | null;
        }
      | undefined;
    if (
      epoch &&
      epoch.config_fingerprint &&
      epoch.config_fingerprint !== input.configFingerprint
    ) {
      await persist
        .from('os_snapshot_soak_epochs')
        .update({
          status: 'broken',
          reset_reason: 'Stage 4e configuration fingerprint changed',
          updated_at: input.observedAt,
        })
        .eq('epoch_id', epoch.epoch_id);
      epoch = undefined;
    }
    if (latestEvent?.stage === 'rollback') {
      if (epoch) {
        await persist
          .from('os_snapshot_soak_epochs')
          .update({
            status: 'rolled_back',
            reset_reason: 'Durable rollback event',
            updated_at: input.observedAt,
          })
          .eq('epoch_id', epoch.epoch_id);
      }
      epoch = undefined;
      continuityStatus = 'rolled_back';
    } else if (latestEvent?.stage !== 'rename_verified') {
      continuityStatus = 'awaiting_rename_verification';
    } else if (input.healthy && input.drillRunId) {
      const gapHours = epoch?.last_observed_at
        ? (Date.parse(input.observedAt) -
            Date.parse(epoch.last_observed_at)) /
          3_600_000
        : 0;
      if (epoch && gapHours > Number(epoch.max_gap_hours ?? 8)) {
        await persist
          .from('os_snapshot_soak_epochs')
          .update({
            status: 'broken',
            reset_reason: `Observation gap ${gapHours.toFixed(1)}h exceeded ${epoch.max_gap_hours}h`,
            updated_at: input.observedAt,
          })
          .eq('epoch_id', epoch.epoch_id);
        epoch = undefined;
      }
      if (!epoch) {
        const { data: created, error } = await persist
          .from('os_snapshot_soak_epochs')
          .insert({
            retired_table_name: retiredTable,
            rename_event_id: latestEvent?.event_id ?? null,
            status: 'active',
            streak_started_at: input.observedAt,
            last_observed_at: input.observedAt,
            healthy_count: 1,
            config_fingerprint: input.configFingerprint,
            latest_drill_run_id: input.drillRunId,
          })
          .select('*')
          .single();
        if (error) return { error: error.message };
        epoch = created;
      } else {
        const nextCount = Number(epoch.healthy_count ?? 0) + 1;
        const startedAt = epoch.streak_started_at ?? input.observedAt;
        const durationHours =
          (Date.parse(input.observedAt) - Date.parse(startedAt)) / 3_600_000;
        const qualified =
          durationHours >= Number(epoch.required_hours ?? 168) &&
          nextCount >= Number(epoch.minimum_observations ?? 21);
        await persist
          .from('os_snapshot_soak_epochs')
          .update({
            status: qualified ? 'qualified' : 'active',
            streak_started_at: startedAt,
            last_observed_at: input.observedAt,
            healthy_count: nextCount,
            qualified_at: qualified ? input.observedAt : null,
            reset_reason: null,
            latest_drill_run_id: input.drillRunId,
            updated_at: input.observedAt,
          })
          .eq('epoch_id', epoch.epoch_id);
        epoch = {
          ...epoch,
          status: qualified ? 'qualified' : 'active',
          streak_started_at: startedAt,
          last_observed_at: input.observedAt,
          healthy_count: nextCount,
        };
      }
      if (!epoch) return { error: 'Soak epoch could not be established' };
      epochId = epoch.epoch_id;
      continuityStatus = epoch.status;
      streakCount = Number(epoch.healthy_count ?? 0);
      streakStartedAt = epoch.streak_started_at;
    } else if (epoch) {
      epochId = epoch.epoch_id;
      continuityStatus = 'broken';
      await persist
        .from('os_snapshot_soak_epochs')
        .update({
          status: 'broken',
          reset_reason: input.issues.join('; ') || 'Unhealthy observation',
          last_observed_at: input.observedAt,
          updated_at: input.observedAt,
        })
        .eq('epoch_id', epoch.epoch_id);
    }
  }
  const { error } = await persist.from('os_snapshot_soak_observations').insert({
    healthy: input.healthy,
    issues: input.issues,
    stage: input.stage,
    sync_failure_count: input.syncFailureCount,
    fk_orphan_total: input.fkOrphanTotal,
    stage4_ready: input.stage4Ready,
    drill_summary: input.drillSummary,
    source: input.source,
    retired_table_name: retiredTable,
    observed_at: input.observedAt,
    epoch_id: epochId,
    continuity_status: continuityStatus,
    healthy_streak_count: streakCount,
    healthy_streak_started_at: streakStartedAt,
    observation_key: observationKey,
    observation_bucket: bucket.toISOString(),
    qualification_eligible:
      input.source === 'cron' && input.healthy && Boolean(input.drillRunId),
    drill_run_id: input.drillRunId,
    config_fingerprint: input.configFingerprint,
    code_revision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || 'local',
    evidence_sha256: input.evidenceSha256,
  });
  if (error?.code === '23505') {
    return { epochStatus: `${continuityStatus}:duplicate_bucket` };
  }
  return error
    ? { error: error.message }
    : { epochStatus: continuityStatus };
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
    const drillEvidence = await persistSnapshotDrillEvidence({
      report: drills,
      source: auth.source,
    });
    if (!drillEvidence.ok) {
      issues.push(`drill_evidence=${drillEvidence.error}`);
      healthy = false;
    }
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
    const soakEvidence = await persistSoakEvidence({
      healthy,
      issues,
      stage: status.cutover_hints.stage,
      syncFailureCount: status.sync_failure_count,
      fkOrphanTotal: status.fk_orphan_total,
      stage4Ready: drills.stage4_ready,
      drillSummary: drills.summary,
      source: auth.source,
      observedAt: fetched_at,
      drillRunId: drillEvidence.ok ? drillEvidence.drill_run_id : null,
      configFingerprint: drillEvidence.ok
        ? drillEvidence.config_fingerprint
        : null,
      evidenceSha256: drillEvidence.ok
        ? drillEvidence.evidence_sha256
        : null,
    });
    const observationError = soakEvidence.error
      ? { message: soakEvidence.error }
      : null;
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
      soak_epoch_status: soakEvidence.epochStatus ?? null,
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
