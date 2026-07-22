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
};

type ApiResult = {
  ok?: boolean;
  error?: string;
  package?: Record<string, unknown>;
  receipt?: Record<string, unknown>;
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
        <p className="font-medium">Phase 40/41 signed retention evidence</p>
        <Badge variant="outline">Synthetic · non-qualifying</Badge>
      </div>
      <p className="text-muted-foreground">
        HMAC-signed metadata packages bind the current Phase 39 manifest and
        external artifact hashes. Phase 41 adds ed25519 externally verifiable
        receipts and warm/cold retention tiers. Canaries never qualify soak or
        attestation.
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
