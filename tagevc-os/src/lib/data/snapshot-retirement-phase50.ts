import { createPersistClient } from '@/lib/supabase/persist-client';
import { getSnapshotPhase49OpsDashboard } from '@/lib/data/snapshot-retirement-phase49';

export const PHASE50_SNAPSHOT_CONTRACT_VERSION = 'phase50-v1';

/** Allowlisted paging destination for protected_branch_cutover_blocked
 * alerts. Visibility only — actual webhook delivery is best-effort and the
 * outcome (sent/failed/skipped) is always recorded via
 * recordSnapshotPhase50PageReceipt, never silently dropped. */
export function snapshotPhase50PageWebhookUrl(): string | null {
  const raw = process.env.SNAPSHOT_PHASE50_PAGE_WEBHOOK_URL?.trim();
  return raw ? raw : null;
}

export function snapshotPhase50PageDestinationKey(): string {
  return (
    process.env.SNAPSHOT_PHASE50_PAGE_DESTINATION_KEY?.trim() || 'oncall'
  );
}

/** Best-effort webhook delivery for a blocked-cutover alert, then always
 * records the outcome via the RPC (sent/failed/skipped). Never throws. */
export async function pageSnapshotProtectedBranchCutoverBlockedPhase50(input: {
  actorId?: string | null;
  alertId: string;
  destinationKey?: string;
}) {
  const destinationKey =
    input.destinationKey?.trim() || snapshotPhase50PageDestinationKey();
  const webhookUrl = snapshotPhase50PageWebhookUrl();
  let deliveryStatus: 'sent' | 'failed' | 'skipped' = 'skipped';
  let responseCode: number | null = null;

  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contract_version: PHASE50_SNAPSHOT_CONTRACT_VERSION,
          alert_kind: 'protected_branch_cutover_blocked',
          alert_id: input.alertId,
        }),
      });
      responseCode = response.status;
      deliveryStatus = response.ok ? 'sent' : 'failed';
    } catch {
      deliveryStatus = 'failed';
    }
  }

  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'page_snapshot_protected_branch_cutover_blocked_phase50',
    {
      p_actor_id: input.actorId ?? null,
      p_alert_id: input.alertId,
      p_destination_key: destinationKey,
      p_delivery_status: deliveryStatus,
      p_response_code: responseCode,
      p_detail: {},
    },
  );
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, receipt: data as Record<string, unknown> };
}

export async function recordSnapshotPhase50SoakStatus(input?: {
  actorId?: string | null;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('record_snapshot_phase50_soak_status', {
    p_actor_id: input?.actorId ?? null,
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, soak: data as Record<string, unknown> };
}

export async function listSnapshotPhase50CriticalWindows(input?: {
  windowHours?: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'list_snapshot_phase50_critical_windows',
    { p_window_hours: input?.windowHours ?? 24 },
  );
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, windows: data as Record<string, unknown> };
}

export async function getSnapshotPhase50OpsReport() {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('get_snapshot_phase50_ops_report');
  if (error) {
    console.error('snapshot phase50 ops report unavailable', error.message);
    return null;
  }
  return data as Record<string, unknown> | null;
}

/** Read-only ops tick: continues the Stage 4e soak rollup, then pages any
 * unpaged protected_branch_cutover_blocked alerts. Never auto-completes or
 * mutates any cutover; enforcement stays inside
 * complete_snapshot_ed25519_cutover_phase49. */
export async function runSnapshotPhase50OpsTick(input?: {
  actorId?: string | null;
}) {
  const soak = await recordSnapshotPhase50SoakStatus({
    actorId: input?.actorId ?? null,
  });

  const windows = await listSnapshotPhase50CriticalWindows();
  const unpaged =
    windows.ok
      ? ((windows.windows as { unpaged_blocked_alerts?: Array<{ alert_id: string }> } | null)
          ?.unpaged_blocked_alerts ?? [])
      : [];

  let paged = 0;
  let pageErrors = 0;
  for (const alert of unpaged.slice(0, 20)) {
    const result = await pageSnapshotProtectedBranchCutoverBlockedPhase50({
      actorId: input?.actorId ?? null,
      alertId: alert.alert_id,
    });
    if (result.ok) paged += 1;
    else pageErrors += 1;
  }

  const report = await getSnapshotPhase50OpsReport();

  return {
    ok: soak.ok && windows.ok,
    error: !soak.ok ? soak.error : !windows.ok ? windows.error : undefined,
    soak: soak.ok ? soak.soak : null,
    unpagedBlockedCount: unpaged.length,
    paged,
    pageErrors,
    report,
    qualification_eligible: false,
    attestation_eligible: false,
    production_relation_mutated: false,
  };
}

export async function getSnapshotPhase50OpsDashboard() {
  const [phase49, pageReceipts, ciCheckEvents, soakSnapshots, opsAlerts, report] =
    await Promise.all([
      getSnapshotPhase49OpsDashboard(),
      (async () => {
        const sb = await createPersistClient();
        return sb
          .from('os_snapshot_phase50_page_receipts')
          .select('receipt_id,alert_id,destination_key,delivery_status,created_at')
          .order('created_at', { ascending: false })
          .limit(12);
      })(),
      (async () => {
        const sb = await createPersistClient();
        return sb
          .from('os_snapshot_phase50_ci_check_enforcement_events')
          .select('event_id,run_key,cutover_adjacent,check_passed,created_at')
          .order('created_at', { ascending: false })
          .limit(12);
      })(),
      (async () => {
        const sb = await createPersistClient();
        return sb
          .from('os_snapshot_phase50_soak_status_snapshots')
          .select(
            'snapshot_id,enforcement_events_7d,allowed_7d,blocked_7d,blocked_rate,soak_health,created_at',
          )
          .order('created_at', { ascending: false })
          .limit(14);
      })(),
      (async () => {
        const sb = await createPersistClient();
        return sb
          .from('os_snapshot_phase50_ops_alerts')
          .select('alert_id,alert_kind,reference_id,severity,created_at,qualification_eligible')
          .order('created_at', { ascending: false })
          .limit(12);
      })(),
      getSnapshotPhase50OpsReport(),
    ]);

  return {
    ...phase49,
    ok: true as const,
    phase50PageReceipts: pageReceipts.error ? [] : (pageReceipts.data ?? []),
    phase50CiCheckEvents: ciCheckEvents.error ? [] : (ciCheckEvents.data ?? []),
    phase50SoakSnapshots: soakSnapshots.error ? [] : (soakSnapshots.data ?? []),
    phase50OpsAlerts: opsAlerts.error ? [] : (opsAlerts.data ?? []),
    phase50Report: report,
  };
}
