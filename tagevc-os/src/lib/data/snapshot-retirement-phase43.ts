import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getSnapshotPhase42VerifyColdDashboard,
  publishSnapshotVerifyMaterial,
  runColdRetentionHeadCadence,
  snapshotColdRetentionCadenceHours,
  PHASE42_SNAPSHOT_CONTRACT_VERSION,
  PHASE42_DEFAULT_COLD_CADENCE_HOURS,
  buildOfflineVerifyBundle,
  exportSnapshotVerifyBundle,
} from '@/lib/data/snapshot-retirement-phase42';

export const PHASE43_SNAPSHOT_CONTRACT_VERSION = 'phase43-v1';

export {
  snapshotColdRetentionCadenceHours,
  PHASE42_SNAPSHOT_CONTRACT_VERSION,
  PHASE42_DEFAULT_COLD_CADENCE_HOURS,
  buildOfflineVerifyBundle,
  exportSnapshotVerifyBundle,
  publishSnapshotVerifyMaterial,
  runColdRetentionHeadCadence,
};

export async function listFirmWideVerifyMaterialPhase43(limit = 50) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'list_snapshot_firm_wide_verify_material_phase43',
    { p_limit: limit },
  );
  if (error) {
    return { ok: false as const, error: error.message };
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const serialized = JSON.stringify(row);
    if (/private_key|-----BEGIN/i.test(serialized)) {
      return {
        ok: false as const,
        error: 'Verify catalog contained disallowed private key material',
      };
    }
  }
  return { ok: true as const, materials: rows };
}

export async function listDueColdPackagesPhase43(input?: {
  cadenceHours?: number;
  limit?: number;
}) {
  const cadenceHours =
    input?.cadenceHours ?? snapshotColdRetentionCadenceHours();
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('list_due_cold_packages_phase43', {
    p_cadence_hours: cadenceHours,
    p_limit: input?.limit ?? 25,
  });
  if (error) {
    return { ok: false as const, error: error.message };
  }
  return {
    ok: true as const,
    packages: (data ?? []) as Array<{
      package_id: string;
      destination_key: string;
      retained_until: string;
      last_cold_check_at: string | null;
      due: boolean;
    }>,
    cadenceHours,
  };
}

/**
 * Scheduled production cold HEAD against SNAPSHOT_RETENTION_DESTINATIONS
 * for all due cold packages (non-qualifying).
 */
export async function runProductionColdHeadCadencePhase43(input: {
  actorId: string;
  idempotencyKey: string;
  limit?: number;
}) {
  const cadenceHours = snapshotColdRetentionCadenceHours();
  const due = await listDueColdPackagesPhase43({
    cadenceHours,
    limit: input.limit ?? 25,
  });
  if (!due.ok) return due;

  const destinationsConfigured = Boolean(
    process.env.SNAPSHOT_RETENTION_DESTINATIONS?.trim() &&
      process.env.SNAPSHOT_RETENTION_ALLOWED_HOSTS?.trim(),
  );
  if (!destinationsConfigured && due.packages.length > 0) {
    return {
      ok: false as const,
      error:
        'SNAPSHOT_RETENTION_DESTINATIONS and SNAPSHOT_RETENTION_ALLOWED_HOSTS are required for production cold HEAD',
    };
  }

  let checked = 0;
  let skipped = 0;
  const packageResults: Array<Record<string, unknown>> = [];

  for (const pkg of due.packages) {
    const packageKey = `${input.idempotencyKey}:${pkg.package_id}`;
    const result = await runColdRetentionHeadCadence({
      actorId: input.actorId,
      packageId: pkg.package_id,
      idempotencyKey: packageKey.slice(0, 199),
    });
    if (!result.ok) {
      skipped += 1;
      packageResults.push({
        package_id: pkg.package_id,
        ok: false,
        error: result.error,
      });
      continue;
    }
    if (result.skipped) {
      skipped += 1;
    } else {
      checked += 1;
    }
    packageResults.push({
      package_id: pkg.package_id,
      ok: true,
      skipped: Boolean(result.skipped),
      run: result.run,
    });
  }

  const status =
    due.packages.length === 0
      ? 'skipped_none_due'
      : skipped > 0 && checked > 0
        ? 'partial'
        : skipped > 0 && checked === 0
          ? 'failed'
          : 'completed';

  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'record_snapshot_production_cold_head_schedule_phase43',
    {
      p_actor_id: input.actorId,
      p_idempotency_key: input.idempotencyKey,
      p_cadence_hours: cadenceHours,
      p_due_package_count: due.packages.length,
      p_checked_package_count: checked,
      p_skipped_package_count: skipped,
      p_status: status,
      p_detail: {
        contract_version: PHASE43_SNAPSHOT_CONTRACT_VERSION,
        destination_source: 'SNAPSHOT_RETENTION_DESTINATIONS',
        package_results: packageResults.slice(0, 20).map((row) => ({
          package_id: row.package_id,
          ok: row.ok,
          skipped: row.skipped ?? false,
          error: typeof row.error === 'string' ? row.error.slice(0, 120) : null,
        })),
      },
    },
  );
  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? 'Production cold HEAD schedule RPC failed',
    };
  }
  return {
    ok: true as const,
    schedule: data as Record<string, unknown>,
    packageResults,
    cadenceHours,
  };
}

export async function publishFirmWideVerifyMaterialPhase43(input: {
  actorId: string;
}) {
  const published = await publishSnapshotVerifyMaterial({
    actorId: input.actorId,
  });
  if (!published.ok) return published;
  const catalog = await listFirmWideVerifyMaterialPhase43(12);
  return {
    ok: true as const,
    material: published.material,
    firmWideCatalog: catalog.ok ? catalog.materials : [],
  };
}

export async function getSnapshotPhase43VerifyColdDashboard() {
  const [phase42, catalog, schedules, report] = await Promise.all([
    getSnapshotPhase42VerifyColdDashboard(),
    listFirmWideVerifyMaterialPhase43(12),
    (async () => {
      const sb = await createPersistClient();
      return sb
        .from('os_snapshot_production_cold_head_schedules')
        .select(
          'schedule_id,status,cadence_hours,due_package_count,checked_package_count,skipped_package_count,scheduled_at,qualification_eligible',
        )
        .order('scheduled_at', { ascending: false })
        .limit(12);
    })(),
    (async () => {
      const sb = await createPersistClient();
      return sb.rpc('get_snapshot_phase43_verify_cold_report');
    })(),
  ]);

  return {
    ok: true as const,
    verifyMaterial: phase42.ok ? phase42.verifyMaterial : [],
    coldRuns: phase42.ok ? phase42.coldRuns : [],
    phase42Slo: phase42.ok ? phase42.phase42Slo : null,
    firmWideVerifyMaterial: catalog.ok ? catalog.materials : [],
    productionColdSchedules: schedules.error ? [] : (schedules.data ?? []),
    phase43Slo: report.error ? null : (report.data ?? null),
  };
}
