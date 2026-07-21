import { createHash, randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import type { EmptySnapshotDrillReport } from '@/lib/data/snapshot-drills';

export function snapshotConfigFingerprint(): string {
  const config = {
    retired_table: process.env.SNAPSHOT_RETIRED_TABLE_NAME?.trim() || null,
    soft_renamed_at: process.env.SNAPSHOT_SOFT_RENAMED_AT?.trim() || null,
    write_cutover_mature:
      process.env.WRITE_CUTOVER_MATURE?.trim() || null,
    write_cutover_all: process.env.WRITE_CUTOVER_ALL?.trim() || null,
    read_cutover_all: process.env.READ_CUTOVER_ALL?.trim() || null,
    write_snapshots: process.env.WRITE_SNAPSHOTS?.trim() || null,
  };
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

export async function persistSnapshotDrillEvidence(input: {
  report: EmptySnapshotDrillReport;
  source: 'cron' | 'admin';
  requestedBy?: string | null;
}): Promise<
  | {
      ok: true;
      drill_run_id: string;
      evidence_sha256: string;
      config_fingerprint: string;
    }
  | { ok: false; error: string }
> {
  const sb = await createPersistClient();
  const configFingerprint = snapshotConfigFingerprint();
  const evidenceSha256 = createHash('sha256')
    .update(JSON.stringify(input.report))
    .digest('hex');
  const bucket = new Date(input.report.fetched_at);
  bucket.setUTCMinutes(0, 0, 0);
  bucket.setUTCHours(Math.floor(bucket.getUTCHours() / 6) * 6);
  const idempotencyKey =
    input.source === 'cron'
      ? `readiness:${configFingerprint}:${bucket.toISOString()}`
      : `readiness:admin:${randomUUID()}`;
  const { data: run, error } = await sb
    .from('os_snapshot_drill_runs')
    .insert({
      idempotency_key: idempotencyKey,
      drill_type: 'readiness',
      trigger_source: input.source,
      status: input.report.ok ? 'passed' : 'failed',
      retired_table_name:
        process.env.SNAPSHOT_RETIRED_TABLE_NAME?.trim() || null,
      requested_by: input.requestedBy ?? null,
      config_fingerprint: configFingerprint,
      code_revision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || 'local',
      started_at: input.report.fetched_at,
      completed_at: new Date().toISOString(),
      summary: {
        text: input.report.summary,
        stage4_ready: input.report.stage4_ready,
      },
      evidence_sha256: evidenceSha256,
    })
    .select('drill_run_id')
    .single();
  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await sb
        .from('os_snapshot_drill_runs')
        .select('drill_run_id, evidence_sha256')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (existing) {
        return {
          ok: true,
          drill_run_id: String(existing.drill_run_id),
          evidence_sha256: String(existing.evidence_sha256),
          config_fingerprint: configFingerprint,
        };
      }
    }
    return { ok: false, error: error.message };
  }
  const checks = input.report.results.flatMap((result) =>
    result.checks.map((check) => ({
      drill_run_id: run.drill_run_id,
      domain: result.collection,
      check_name: check.name,
      ok: check.ok,
      expected: { ok: true },
      observed: { detail: check.detail ?? null },
      checked_at: input.report.fetched_at,
    })),
  );
  const { error: checksError } = await sb
    .from('os_snapshot_drill_checks')
    .insert(checks);
  if (checksError) return { ok: false, error: checksError.message };
  return {
    ok: true,
    drill_run_id: String(run.drill_run_id),
    evidence_sha256: evidenceSha256,
    config_fingerprint: configFingerprint,
  };
}
