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
        <p className="font-medium">Phase 40/41/42/43/44 signed retention evidence</p>
        <Badge variant="outline">Synthetic · non-qualifying</Badge>
      </div>
      <p className="text-muted-foreground">
        HMAC-signed metadata packages bind the current Phase 39 manifest and
        external artifact hashes. Phase 41 adds ed25519 externally verifiable
        receipts and warm/cold retention tiers. Phase 42 publishes public verify
        material and cold HEAD cadence evidence. Phase 43 publishes the firm-wide
        verify catalog and schedules production cold HEAD against retention
        destinations. Phase 44 adds package integrity evidence, retention ops
        alerts, and recurring multi-hour canary schedules. Canaries never qualify
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
