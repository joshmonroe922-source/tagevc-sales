'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Dashboard = {
  manifests: Array<{
    manifest_id: string;
    entity_id: string | null;
    manifest_version: number;
    manifest_sha256: string;
    lifecycle_status: string;
    valid_until: string;
  }>;
  packages: Array<{
    package_id: string;
    entity_id: string | null;
    package_sha256: string;
    signature_key_id: string;
    destination_key: string;
    retained_until: string;
    retention_tier?: string;
    created_at: string;
    qualification_eligible?: boolean;
    attestation_eligible?: boolean;
  }>;
  checks: Array<{
    check_id: string;
    package_id: string;
    status: string;
    checked_at: string;
    evidence_sha256: string;
    error_code: string | null;
  }>;
  orchestrations: Array<{
    orchestration_id: string;
    package_id: string;
    status: string;
    scheduled_for: string;
    deadline_at: string;
    next_step_at: string;
    expected_step_count: number;
    completed_step_count: number;
    heartbeat_at: string | null;
    abort_reason: string | null;
    qualification_eligible: boolean;
    attestation_eligible: boolean;
  }>;
  slo: Record<string, unknown> | null;
  receipts?: Array<{
    receipt_id: string;
    package_id: string;
    retention_tier: string;
    receipt_sha256: string;
    verify_key_id: string;
    created_at: string;
    qualification_eligible: boolean;
    attestation_eligible: boolean;
  }>;
  phase41Slo?: Record<string, unknown> | null;
  verifyMaterial?: Array<{
    material_id: string;
    key_id: string;
    public_key_spki_sha256: string;
    published_at: string;
    active: boolean;
  }>;
  coldRuns?: Array<{
    run_id: string;
    package_id: string;
    status: string;
    cadence_hours: number;
    checked_at: string;
  }>;
  phase42Slo?: Record<string, unknown> | null;
  firmWideVerifyMaterial?: Array<{
    material_id: string;
    key_id: string;
    public_key_spki_sha256: string;
    published_at?: string;
    active?: boolean;
  }>;
  productionColdSchedules?: Array<{
    schedule_id: string;
    status: string;
    cadence_hours: number;
    due_package_count: number;
    checked_package_count: number;
    skipped_package_count: number;
    scheduled_at: string;
  }>;
  phase43Slo?: Record<string, unknown> | null;
  integrityChecks?: Array<{
    check_id: string;
    package_id: string;
    check_status: string;
    key_id: string | null;
    created_at: string;
    qualification_eligible?: boolean;
  }>;
  retentionAlerts?: Array<Record<string, unknown>>;
  phase44CanarySchedules?: Array<{
    schedule_id: string;
    definition_id: string | null;
    package_id: string | null;
    cadence_hours: number;
    last_run_at: string | null;
    status: string;
    created_at: string;
  }>;
  phase44Slo?: Record<string, unknown> | null;
  ed25519Rotations?: Array<{
    rotation_id: string;
    previous_key_id: string;
    next_key_id: string;
    status: string;
    cutover_started_at: string;
    cutover_completed_at: string | null;
    created_at: string;
  }>;
  consecutiveFailureCounters?: Array<{
    counter_kind: string;
    consecutive_count: number;
    last_failure_at: string | null;
    last_success_at: string | null;
    updated_at: string;
  }>;
  phase45OpsAlerts?: Array<Record<string, unknown>>;
  phase45Slo?: Record<string, unknown> | null;
  cutoverAcceptances?: Array<{
    acceptance_id: string;
    rotation_id: string;
    verifier_kind: string;
    acceptance_sha256: string;
    previous_key_id: string;
    next_key_id: string;
    dual_acceptance_complete: boolean;
    created_at: string;
  }>;
  oncallRoutes?: Array<{
    route_id: string;
    destination_key: string;
    route_status: string;
    last_paged_at: string | null;
    updated_at: string;
  }>;
  oncallDeliveries?: Array<Record<string, unknown>>;
  phase46Slo?: Record<string, unknown> | null;
  oncallAckSnapshots?: Array<Record<string, unknown>>;
  oncallAckAlerts?: Array<Record<string, unknown>>;
  phase47Slo?: Record<string, unknown> | null;
};

type ApiResult = {
  ok?: boolean;
  error?: string;
  package?: Record<string, unknown>;
  receipt?: Record<string, unknown>;
  bundle?: Record<string, unknown>;
  material?: Record<string, unknown>;
  run?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  check?: Record<string, unknown>;
  skipped?: boolean;
  rotation?: Record<string, unknown>;
  acceptance?: Record<string, unknown>;
};

function downloadSignedPackage(value: Record<string, unknown>) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `snapshot-export-package-${String(value.package_id ?? Date.now())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function SnapshotRetirementPhase40Admin() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const response = await fetch('/api/admin/snapshot-retirement', {
      cache: 'no-store',
    });
    const result = (await response.json()) as ApiResult & Dashboard;
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? 'Phase 40 dashboard is unavailable');
    }
    setDashboard(result);
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => {
      setError(cause instanceof Error ? cause.message : 'Phase 40 dashboard failed');
    });
  }, [refresh]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch('/api/admin/snapshot-retirement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as ApiResult;
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? 'Phase 40 operation failed');
    }
    return result;
  }, []);

  function createPackage() {
    const manifest = dashboard?.manifests[0];
    if (!manifest) {
      setError('Create a Phase 39 manifest before signing a Phase 40 package.');
      return;
    }
    const destinationKey = window.prompt(
      'Allowlisted retention destination key (configured on the server):',
      '',
    );
    const artifactSha256 = window.prompt('External artifact SHA-256:', '');
    const artifactSize = window.prompt('External artifact size in bytes:', '');
    const retainedUntil = window.prompt(
      'Retention deadline (ISO timestamp):',
      new Date(Date.now() + 365 * 86_400_000).toISOString(),
    );
    const retentionTier = window.prompt('Retention tier (warm|cold):', 'warm');
    if (!destinationKey || !artifactSha256 || !artifactSize || !retainedUntil) return;
    if (retentionTier !== 'warm' && retentionTier !== 'cold') {
      setError('retention_tier must be warm or cold');
      return;
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await post({
          action: 'create_package',
          entity_id: manifest.entity_id,
          phase39_manifest_id: manifest.manifest_id,
          idempotency_key: `phase40-ui-package-${Date.now()}`,
          destination_key: destinationKey.trim(),
          artifact_sha256: artifactSha256.trim().toLowerCase(),
          artifact_size_bytes: Number(artifactSize),
          content_type: 'application/json',
          retained_until: retainedUntil.trim(),
          retention_tier: retentionTier,
        });
        if (result.package) downloadSignedPackage(result.package);
        setMessage('Signed metadata-only export package created and downloaded.');
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Package creation failed');
      }
    });
  }

  function checkRetention() {
    const packageRow = dashboard?.packages[0];
    if (!packageRow) {
      setError('Create a signed package before checking retention.');
      return;
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        await post({ action: 'check_retention', package_id: packageRow.package_id });
        setMessage('Read-only external HEAD retention check recorded.');
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Retention check failed');
      }
    });
  }

  function createExternalReceipt() {
    const packageRow = dashboard?.packages[0];
    if (!packageRow) {
      setError('Create a signed package before issuing an external receipt.');
      return;
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await post({
          action: 'create_external_receipt',
          package_id: packageRow.package_id,
          idempotency_key: `phase41-ui-receipt-${Date.now()}`,
        });
        if (result.receipt) {
          const blob = new Blob([JSON.stringify(result.receipt, null, 2)], {
            type: 'application/json',
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `snapshot-external-receipt-${String(result.receipt.receipt_id ?? Date.now())}.json`;
          link.click();
          URL.revokeObjectURL(url);
        }
        setMessage('Ed25519 external receipt created (non-qualifying).');
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'External receipt failed');
      }
    });
  }

  function publishVerifyMaterial() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        await post({ action: 'publish_firm_wide_verify' });
        setMessage('Firm-wide public verify material published (no private keys).');
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Verify material publish failed');
      }
    });
  }

  function downloadVerifyBundle() {
    const receipt = dashboard?.receipts?.[0];
    if (!receipt) {
      setError('Issue an ed25519 receipt before downloading a verify bundle.');
      return;
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await post({
          action: 'export_verify_bundle',
          receipt_id: receipt.receipt_id,
        });
        if (result.bundle) {
          const blob = new Blob([JSON.stringify(result.bundle, null, 2)], {
            type: 'application/json',
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `snapshot-verify-bundle-${receipt.receipt_id}.json`;
          link.click();
          URL.revokeObjectURL(url);
        }
        setMessage('Offline verify bundle downloaded (public keys only).');
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Verify bundle failed');
      }
    });
  }

  function runColdHeadCadence() {
    const coldPackage =
      dashboard?.packages.find((row) => row.retention_tier === 'cold') ??
      dashboard?.packages[0];
    if (!coldPackage || coldPackage.retention_tier !== 'cold') {
      setError('Create a cold-tier package before running cold HEAD cadence.');
      return;
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await post({
          action: 'check_cold_retention',
          package_id: coldPackage.package_id,
          idempotency_key: `phase42-cold-head-${Date.now()}`,
        });
        setMessage(
          result.skipped
            ? 'Cold HEAD cadence not due; skip evidence recorded.'
            : 'Cold HEAD cadence check recorded (non-qualifying).',
        );
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Cold HEAD cadence failed');
      }
    });
  }

  function runProductionColdHead() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await post({
          action: 'check_production_cold_retention',
          idempotency_key: `phase43-prod-cold-${Date.now()}`,
        });
        setMessage(
          result.schedule
            ? `Production cold HEAD · ${String(result.schedule.status ?? 'recorded')} (non-qualifying).`
            : 'Production cold HEAD schedule recorded (non-qualifying).',
        );
        await refresh();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Production cold HEAD failed',
        );
      }
    });
  }

  function verifyPackageIntegrity() {
    const packageRow = dashboard?.packages[0];
    if (!packageRow) {
      setError('Create a signed package before verifying integrity.');
      return;
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await post({
          action: 'verify_package_integrity',
          package_id: packageRow.package_id,
        });
        setMessage(
          result.check
            ? `Package integrity · ${String(result.check.check_status ?? 'recorded')} (non-qualifying).`
            : 'Package integrity check recorded (non-qualifying).',
        );
        await refresh();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Package integrity check failed',
        );
      }
    });
  }

  function schedulePhase44Canary() {
    const packageRow = dashboard?.packages[0];
    if (!packageRow) {
      setError('Create a signed package before scheduling a Phase 44 canary.');
      return;
    }
    const cadence = window.prompt('Cadence hours (1–168):', '6');
    if (!cadence) return;
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        await post({
          action: 'schedule_phase44_canary',
          package_id: packageRow.package_id,
          cadence_hours: Number(cadence),
        });
        setMessage(
          'Phase 44 recurring canary schedule recorded (non-qualifying).',
        );
        await refresh();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Phase 44 canary schedule failed',
        );
      }
    });
  }

  function announceEd25519Rotation() {
    const previous = window.prompt(
      'Previous ed25519 key id:',
      'snapshot-ed25519-2026-01',
    );
    if (!previous) return;
    const next = window.prompt('Next ed25519 key id:', 'snapshot-ed25519-2026-07');
    if (!next) return;
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await post({
          action: 'announce_ed25519_rotation',
          previous_key_id: previous,
          next_key_id: next,
        });
        setMessage(
          result.rotation
            ? `Ed25519 rotation announced · ${String(result.rotation.status ?? 'announced')} (public metadata only).`
            : 'Ed25519 rotation announced (public metadata only).',
        );
        await refresh();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Ed25519 rotation announce failed',
        );
      }
    });
  }

  function activateDualKey() {
    const open = (dashboard?.ed25519Rotations ?? []).find(
      (row) => row.status === 'announced',
    );
    if (!open) {
      setError('Announce an ed25519 rotation before activating dual-key.');
      return;
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await post({
          action: 'activate_dual_key',
          rotation_id: open.rotation_id,
        });
        setMessage(
          result.rotation
            ? `Dual-key active · ${String(result.rotation.status ?? 'dual_active')} (non-qualifying).`
            : 'Dual-key activated (non-qualifying).',
        );
        await refresh();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Dual-key activation failed',
        );
      }
    });
  }

  function completeEd25519Cutover() {
    const open = (dashboard?.ed25519Rotations ?? []).find(
      (row) => row.status === 'dual_active',
    );
    if (!open) {
      setError('Activate dual-key before completing cutover.');
      return;
    }
    const acceptances = (dashboard?.cutoverAcceptances ?? []).filter(
      (row) => row.rotation_id === open.rotation_id,
    );
    const hasOfflineScript = acceptances.some(
      (row) => row.verifier_kind === 'offline_script',
    );
    const distinctKinds = new Set(acceptances.map((row) => row.verifier_kind));
    if (!hasOfflineScript || distinctKinds.size < 2) {
      setError(
        'Cutover requires offline_script acceptance plus one other verifier kind.',
      );
      return;
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await post({
          action: 'complete_ed25519_cutover',
          rotation_id: open.rotation_id,
        });
        setMessage(
          result.rotation
            ? `Ed25519 cutover complete · ${String(result.rotation.status ?? 'cutover_complete')} (offline_script dual-acceptance; non-qualifying).`
            : 'Ed25519 cutover completed (offline_script dual-acceptance; non-qualifying).',
        );
        await refresh();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Ed25519 cutover failed',
        );
      }
    });
  }

  function recordCutoverAcceptance(verifierKind: 'offline_script' | 'admin' = 'offline_script') {
    const open = (dashboard?.ed25519Rotations ?? []).find(
      (row) => row.status === 'dual_active' || row.status === 'cutover_complete',
    );
    if (!open) {
      setError('Announce and activate a dual-key rotation before recording acceptance.');
      return;
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await post({
          action: 'record_cutover_acceptance',
          rotation_id: open.rotation_id,
          verifier_kind: verifierKind,
          previous_key_id: open.previous_key_id,
          next_key_id: open.next_key_id,
        });
        setMessage(
          result.acceptance
            ? `Cutover acceptance recorded · ${String(result.acceptance.verifier_kind ?? verifierKind)} · dual=${String(result.acceptance.dual_acceptance_complete ?? false)} (public key ids only).`
            : 'Cutover acceptance recorded (public key ids only).',
        );
        await refresh();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Cutover acceptance failed',
        );
      }
    });
  }

  function scheduleCanary() {
    const packageRow = dashboard?.packages[0];
    if (!packageRow) {
      setError('Create a signed package before scheduling a canary.');
      return;
    }
    const duration = window.prompt('Duration in minutes (120–1440):', '240');
    const interval = window.prompt('Step interval in minutes (15–120):', '30');
    if (!duration || !interval) return;
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        await post({
          action: 'schedule_phase40_canary',
          entity_id: packageRow.entity_id,
          package_id: packageRow.package_id,
          idempotency_key: `phase40-ui-canary-${Date.now()}`,
          scheduled_for: new Date().toISOString(),
          duration_minutes: Number(duration),
          step_interval_minutes: Number(interval),
        });
        setMessage('Durable multi-hour canary scheduled. Cron advances due steps.');
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Canary schedule failed');
      }
    });
  }

  function abortCanary(orchestrationId: string) {
    const reason = window.prompt(
      'Abort reason (recorded immutably; minimum 8 characters):',
      '',
    );
    if (!reason) return;
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        await post({
          action: 'abort_phase40_canary',
          orchestration_id: orchestrationId,
          reason,
        });
        setMessage('Canary aborted with immutable governance evidence.');
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Canary abort failed');
      }
    });
  }

  const active = dashboard?.orchestrations.find((run) =>
    ['scheduled', 'running'].includes(run.status),
  );

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border/60 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">Phase 40/41/42/43/44/45 signed retention evidence</p>
        <Badge variant="outline">Synthetic · non-qualifying</Badge>
      </div>
      <p className="text-muted-foreground">
        HMAC-signed metadata packages bind the current Phase 39 manifest and
        external artifact hashes. Phase 41 adds ed25519 externally verifiable
        receipts and warm/cold retention tiers. Phase 42 publishes public verify
        material and cold HEAD cadence evidence. Phase 43 publishes the firm-wide
        verify catalog and schedules production cold HEAD against retention
        destinations. Phase 44 adds package integrity evidence, retention ops
        alerts, and recurring multi-hour canary schedules. Phase 45 adds dual-key
        ed25519 rotation and consecutive failure paging. Canaries never qualify
        soak or attestation.
      </p>
      {dashboard?.packages[0] ? (
        <div>
          <p>
            Latest package · {dashboard.packages[0].destination_key} · tier{' '}
            {dashboard.packages[0].retention_tier ?? 'warm'} · key{' '}
            {dashboard.packages[0].signature_key_id} · retained until{' '}
            {dashboard.packages[0].retained_until}
          </p>
          <p className="break-all font-mono text-[10px] text-muted-foreground">
            {dashboard.packages[0].package_sha256}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground">No Phase 40 package recorded.</p>
      )}
      {(dashboard?.receipts ?? []).slice(0, 4).map((receipt) => (
        <p key={receipt.receipt_id} className="font-mono text-[10px] text-muted-foreground">
          {receipt.created_at} · ed25519 receipt · {receipt.retention_tier} · key{' '}
          {receipt.verify_key_id} · qualifying={String(receipt.qualification_eligible)}
        </p>
      ))}
      {dashboard?.phase41Slo ? (
        <p className="text-muted-foreground">
          Phase 41 receipts 30d · {String(dashboard.phase41Slo.receipts_30d ?? 0)} · cold{' '}
          {String(dashboard.phase41Slo.cold_receipts_30d ?? 0)} · warm{' '}
          {String(dashboard.phase41Slo.warm_receipts_30d ?? 0)} · packages cold{' '}
          {String(dashboard.phase41Slo.packages_cold ?? 0)}
        </p>
      ) : null}
      {(dashboard?.verifyMaterial ?? []).slice(0, 3).map((material) => (
        <p key={material.material_id} className="font-mono text-[10px] text-muted-foreground">
          VERIFY · {material.key_id} · {material.public_key_spki_sha256}
        </p>
      ))}
      {(dashboard?.coldRuns ?? []).slice(0, 3).map((run) => (
        <p key={run.run_id} className="font-mono text-[10px] text-muted-foreground">
          COLD HEAD · {run.checked_at} · {run.status} · cadence {run.cadence_hours}h
        </p>
      ))}
      {dashboard?.phase42Slo ? (
        <p className="text-muted-foreground">
          Phase 42 verify keys · {String(dashboard.phase42Slo.active_verify_keys ?? 0)} · cold
          runs 30d {String(dashboard.phase42Slo.cold_runs_30d ?? 0)} · verified{' '}
          {String(dashboard.phase42Slo.cold_verified_30d ?? 0)}
        </p>
      ) : null}
      {(dashboard?.firmWideVerifyMaterial ?? []).slice(0, 3).map((material) => (
        <p key={material.material_id} className="font-mono text-[10px] text-muted-foreground">
          FIRM-WIDE VERIFY · {material.key_id} · {material.public_key_spki_sha256}
        </p>
      ))}
      {(dashboard?.productionColdSchedules ?? []).slice(0, 3).map((schedule) => (
        <p key={schedule.schedule_id} className="font-mono text-[10px] text-muted-foreground">
          PROD COLD · {schedule.scheduled_at} · {schedule.status} · due{' '}
          {schedule.due_package_count} · checked {schedule.checked_package_count} · cadence{' '}
          {schedule.cadence_hours}h
        </p>
      ))}
      {dashboard?.phase43Slo ? (
        <p className="text-muted-foreground">
          Phase 43 firm-wide keys ·{' '}
          {String(dashboard.phase43Slo.firm_wide_verify_keys ?? 0)} · prod cold schedules 30d{' '}
          {String(dashboard.phase43Slo.production_cold_schedules_30d ?? 0)} · completed{' '}
          {String(dashboard.phase43Slo.production_cold_completed_30d ?? 0)}
        </p>
      ) : null}
      {(dashboard?.integrityChecks ?? []).slice(0, 3).map((check) => (
        <p key={check.check_id} className="font-mono text-[10px] text-muted-foreground">
          INTEGRITY · {check.created_at} · {check.check_status} · key {check.key_id ?? 'n/a'}
        </p>
      ))}
      {(dashboard?.retentionAlerts ?? []).slice(0, 3).map((alert) => (
        <p
          key={String(alert.alert_id)}
          className="font-mono text-[10px] text-muted-foreground"
        >
          RETENTION ALERT · {String(alert.created_at)} · {String(alert.alert_kind)} ·{' '}
          {String(alert.window_key)}
        </p>
      ))}
      {(dashboard?.phase44CanarySchedules ?? []).slice(0, 3).map((schedule) => (
        <p
          key={schedule.schedule_id}
          className="font-mono text-[10px] text-muted-foreground"
        >
          P44 CANARY · {schedule.status} · cadence {schedule.cadence_hours}h · last{' '}
          {schedule.last_run_at ?? 'never'}
        </p>
      ))}
      {dashboard?.phase44Slo ? (
        <p className="text-muted-foreground">
          Phase 44 integrity 30d ·{' '}
          {String(dashboard.phase44Slo.integrity_checks_30d ?? 0)} · verified{' '}
          {String(dashboard.phase44Slo.integrity_verified_30d ?? 0)} · alerts{' '}
          {String(dashboard.phase44Slo.retention_alerts_30d ?? 0)} · active canaries{' '}
          {String(dashboard.phase44Slo.active_canary_schedules ?? 0)}
        </p>
      ) : null}
      {(dashboard?.ed25519Rotations ?? []).slice(0, 3).map((rotation) => (
        <p
          key={rotation.rotation_id}
          className="font-mono text-[10px] text-muted-foreground"
        >
          ED25519 ROT · {rotation.status} · {rotation.previous_key_id} →{' '}
          {rotation.next_key_id}
        </p>
      ))}
      {(dashboard?.consecutiveFailureCounters ?? []).map((counter) => (
        <p
          key={counter.counter_kind}
          className="font-mono text-[10px] text-muted-foreground"
        >
          CONSEC · {counter.counter_kind} · {counter.consecutive_count}
        </p>
      ))}
      {(dashboard?.phase45OpsAlerts ?? []).slice(0, 3).map((alert) => (
        <p
          key={String(alert.alert_id)}
          className="font-mono text-[10px] text-muted-foreground"
        >
          P45 ALERT · {String(alert.created_at)} · {String(alert.alert_kind)} · n=
          {String(alert.consecutive_count ?? 0)}
        </p>
      ))}
      {dashboard?.phase45Slo ? (
        <p className="text-muted-foreground">
          Phase 45 rotations 365d ·{' '}
          {String(dashboard.phase45Slo.rotations_365d ?? 0)} · open{' '}
          {String(dashboard.phase45Slo.open_rotations ?? 0)} · cold consec{' '}
          {String(dashboard.phase45Slo.cold_head_consecutive ?? 0)} · integrity consec{' '}
          {String(dashboard.phase45Slo.integrity_consecutive ?? 0)}
        </p>
      ) : null}
      {(dashboard?.cutoverAcceptances ?? []).slice(0, 4).map((acceptance) => (
        <p
          key={acceptance.acceptance_id}
          className="font-mono text-[10px] text-muted-foreground"
        >
          ACCEPT · {acceptance.verifier_kind} · {acceptance.previous_key_id}→
          {acceptance.next_key_id} · dual={String(acceptance.dual_acceptance_complete)}
        </p>
      ))}
      {(dashboard?.oncallRoutes ?? []).map((route) => (
        <p
          key={route.route_id}
          className="font-mono text-[10px] text-muted-foreground"
        >
          ONCALL · {route.destination_key} · {route.route_status} · last{' '}
          {route.last_paged_at ?? 'never'}
        </p>
      ))}
      {(dashboard?.oncallDeliveries ?? []).slice(0, 3).map((delivery) => (
        <p
          key={String(delivery.delivery_id)}
          className="font-mono text-[10px] text-muted-foreground"
        >
          PAGE · {String(delivery.created_at)} · {String(delivery.delivery_status)} ·{' '}
          {String(delivery.window_key)}
        </p>
      ))}
      {dashboard?.phase46Slo ? (
        <p className="text-muted-foreground">
          Phase 46 cutover acceptances 365d ·{' '}
          {String(dashboard.phase46Slo.cutover_acceptances_365d ?? 0)} · dual ready{' '}
          {String(dashboard.phase46Slo.dual_acceptance_ready ?? 0)} · oncall delivered 30d{' '}
          {String(dashboard.phase46Slo.oncall_delivered_30d ?? 0)}
        </p>
      ) : null}
      {(dashboard?.oncallAckSnapshots ?? []).slice(0, 3).map((snapshot) => (
        <p
          key={String(snapshot.snapshot_id)}
          className="font-mono text-[10px] text-muted-foreground"
        >
          ACK SLO · {String(snapshot.severity)} · overdue={String(snapshot.overdue)} · within{' '}
          {String(snapshot.ack_within_minutes)}m · ack{' '}
          {String(snapshot.acknowledged_at ?? 'pending')}
        </p>
      ))}
      {(dashboard?.oncallAckAlerts ?? []).slice(0, 2).map((alert) => (
        <p
          key={String(alert.alert_id)}
          className="font-mono text-[10px] text-muted-foreground"
        >
          ACK ALERT · {String(alert.alert_kind)} · consec{' '}
          {String(alert.consecutive_ack_overdue)} · {String(alert.severity)}
        </p>
      ))}
      {dashboard?.phase47Slo ? (
        <p className="text-muted-foreground">
          Phase 47 offline_script ready ·{' '}
          {String(dashboard.phase47Slo.offline_script_dual_ready ?? 0)} · ack overdue 30d{' '}
          {String(dashboard.phase47Slo.oncall_ack_overdue_30d ?? 0)} · consec ack alerts{' '}
          {String(dashboard.phase47Slo.consecutive_ack_overdue_alerts_30d ?? 0)}
        </p>
      ) : null}
      {dashboard?.checks.slice(0, 4).map((check) => (
        <p key={check.check_id} className="font-mono text-[10px] text-muted-foreground">
          {check.checked_at} · retention {check.status}
          {check.error_code ? ` · ${check.error_code}` : ''}
        </p>
      ))}
      {dashboard?.slo ? (
        <p className="text-muted-foreground">
          SLO 30d · packages {String(dashboard.slo.packages_30d ?? 0)} · retention
          verified {String(dashboard.slo.retention_verified_30d ?? 0)} · failures{' '}
          {String(dashboard.slo.retention_failures_30d ?? 0)} · unavailable{' '}
          {String(dashboard.slo.retention_unavailable_30d ?? 0)} · canaries passed{' '}
          {String(dashboard.slo.canaries_passed_30d ?? 0)} · failed{' '}
          {String(dashboard.slo.canaries_failed_30d ?? 0)} · active{' '}
          {String(dashboard.slo.canaries_active ?? 0)}
        </p>
      ) : null}
      {dashboard?.orchestrations.slice(0, 4).map((run) => (
        <div key={run.orchestration_id} className="rounded border p-2">
          <p>
            Canary {run.status} · steps {run.completed_step_count}/
            {run.expected_step_count} · deadline {run.deadline_at}
          </p>
          <p className="text-muted-foreground">
            next {run.next_step_at} · heartbeat {run.heartbeat_at ?? 'not leased'} ·
            qualifying={String(run.qualification_eligible)} · attestation=
            {String(run.attestation_eligible)}
          </p>
          {run.abort_reason ? <p className="text-destructive">{run.abort_reason}</p> : null}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={createPackage}>
          Sign export package
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={checkRetention}>
          Check external retention
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={createExternalReceipt}>
          Issue ed25519 receipt
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={publishVerifyMaterial}>
          Publish firm-wide verify
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={downloadVerifyBundle}>
          Download verify bundle
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={runColdHeadCadence}>
          Run cold HEAD cadence
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={runProductionColdHead}>
          Run production cold HEAD
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={verifyPackageIntegrity}>
          Verify package integrity
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={schedulePhase44Canary}>
          Schedule Phase 44 canary
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={announceEd25519Rotation}>
          Announce ed25519 rotation
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={activateDualKey}>
          Activate dual-key
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => recordCutoverAcceptance('offline_script')}>
          Record offline_script acceptance
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => recordCutoverAcceptance('admin')}>
          Record admin acceptance
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={completeEd25519Cutover}>
          Complete cutover
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={scheduleCanary}>
          Schedule multi-hour canary
        </Button>
        {active ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => abortCanary(active.orchestration_id)}
          >
            Abort active canary
          </Button>
        ) : null}
      </div>
      {message ? <p className="text-emerald-700">{message}</p> : null}
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}
