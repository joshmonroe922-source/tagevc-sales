'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NormalizationStatus } from '@/lib/data/normalization-status';
import {
  createRollbackRehearsalAction,
  reviewRollbackRehearsalAction,
} from '@/app/(app)/admin/normalization/actions';

export function NormalizationHealthPanel({
  status,
}: {
  status: NormalizationStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const gates = status.write_cutover.snapshot_write_gates;
  const ready = status.write_cutover.archive_ready_collections;
  const pendingRollbackRehearsal = status.rollback_rehearsals.find(
    (rehearsal) => rehearsal.status === 'awaiting_review',
  );

  function archiveReady() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/snapshot-archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            only_cutover: true,
            note: 'admin UI soft-archive',
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          error?: string;
          results?: Array<{ collection: string; ok: boolean; skipped?: boolean }>;
        };
        if (!res.ok || !data.ok) {
          setError(data.error ?? 'Archive failed');
          return;
        }
        const summary = (data.results ?? [])
          .map((r) => `${r.collection}:${r.skipped ? 'skipped' : 'archived'}`)
          .join(', ');
        setMessage(summary || 'Archive complete');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Archive failed');
      }
    });
  }

  function createRollbackRehearsal() {
    if (
      !status.soak_epoch?.epoch_id ||
      !status.soak_epoch.config_fingerprint
    ) {
      setError('An active correlated soak epoch is required');
      return;
    }
    const retiredTable = window.prompt(
      'Retired relation name from the offline rehearsal:',
      '',
    );
    const artifactUri = window.prompt(
      'External evidence artifact URI (https://, s3://, or gs://):',
      '',
    );
    const artifactSha = window.prompt('Artifact SHA-256:', '');
    const procedureSha = window.prompt('Reviewed procedure SHA-256:', '');
    const manifestText = window.prompt(
      'Paste the offline rehearsal manifest JSON. It must include production_relation_mutated=false, restore_validation_result="passed", application_smoke_result="passed", and code_revision.',
      JSON.stringify({
        isolated_environment: 'required',
        manifest_version: 'phase36-v1',
        production_access_disabled: true,
        production_relation_mutated: false,
        restore_validation_result: 'passed',
        application_smoke_result: 'passed',
        before_row_count: 0,
        after_row_count: 0,
        before_schema_sha256: '',
        after_schema_sha256: '',
        code_revision: 'required',
      }),
    );
    if (!retiredTable || !artifactUri || !artifactSha || !procedureSha || !manifestText) {
      return;
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const manifest = JSON.parse(manifestText) as Record<string, unknown>;
        const result = await createRollbackRehearsalAction({
          epoch_id: status.soak_epoch!.epoch_id,
          retired_table_name: retiredTable.trim(),
          config_fingerprint: status.soak_epoch!.config_fingerprint!,
          artifact_uri: artifactUri.trim(),
          artifact_sha256: artifactSha.trim().toLowerCase(),
          procedure_sha256: procedureSha.trim().toLowerCase(),
          manifest,
        });
        if (result.ok) {
          setMessage(result.message);
          router.refresh();
        } else setError(result.error);
      } catch {
        setError('Manifest must be valid JSON');
      }
    });
  }

  function reviewRollbackRehearsal(decision: 'attest' | 'reject') {
    const rehearsal = pendingRollbackRehearsal;
    if (!rehearsal) return;
    if (!rehearsal.evidence_bundle_sha256) {
      setError('This legacy rehearsal has no Phase 36 evidence bundle.');
      return;
    }
    const evidenceBundleSha256 = rehearsal.evidence_bundle_sha256;
    const statement = window.prompt(
      decision === 'attest'
        ? 'Independent reviewer statement (minimum 20 characters):'
        : 'Rejection reason (minimum 20 characters):',
      '',
    );
    if (!statement) return;
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await reviewRollbackRehearsalAction({
        drill_run_id: rehearsal.drill_run_id,
        manifest_sha256: rehearsal.manifest_sha256,
        evidence_bundle_sha256: evidenceBundleSha256,
        decision,
        statement,
        expected_row_version: rehearsal.row_version,
      });
      if (result.ok) {
        setMessage(result.message);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Stage · {status.cutover_hints.stage}</Badge>
        <Badge variant="secondary">
          Sync failures · {status.sync_failure_count}
        </Badge>
        <Badge
          variant={status.fk_orphan_total > 0 ? 'outline' : 'secondary'}
          className={
            status.fk_orphan_total > 0 ? 'border-destructive text-destructive' : ''
          }
        >
          FK orphans · {status.fk_orphan_total}
        </Badge>
        <Badge variant="outline">
          Master · {status.master_data_source}
        </Badge>
        <Badge
          variant={
            status.write_cutover.sql_only_hydrate_active
              ? 'secondary'
              : 'outline'
          }
        >
          SQL-only hydrate ·{' '}
          {status.write_cutover.sql_only_hydrate_active ? 'on' : 'off'}
        </Badge>
        <Badge variant="outline">
          Null-entity · {status.pipeline_null_entity_mode}
        </Badge>
        <Badge
          variant={status.stage4_ready ? 'secondary' : 'outline'}
          className={
            status.stage4_ready ? 'border-emerald-600 text-emerald-800' : ''
          }
        >
          Stage 4 drills · {status.stage4_ready ? 'pass' : 'pending'}
        </Badge>
        <Badge variant="outline">Evidence contract · Phase 38</Badge>
        <Badge variant={status.sentry_configured ? 'secondary' : 'outline'}>
          Sentry · {status.sentry_configured ? 'on' : 'off'}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Fetched {new Date(status.fetched_at).toLocaleString()}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">{status.cutover_hints.next}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Last soak run</CardTitle>
            <CardDescription>
              Updated when cron or admin hits{' '}
              <code className="text-xs">/api/admin/soak-health</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {status.last_soak ? (
              <>
                <Row
                  label="Status"
                  value={status.last_soak.healthy ? 'healthy' : 'degraded'}
                />
                <Row
                  label="Fetched"
                  value={new Date(status.last_soak.fetched_at).toLocaleString()}
                />
                <Row label="Source" value={status.last_soak.source} />
                <Row label="Stage" value={status.last_soak.stage} />
                <Row
                  label="Issues"
                  value={
                    status.last_soak.issues.length
                      ? status.last_soak.issues.join('; ')
                      : '—'
                  }
                />
              </>
            ) : (
              <p className="text-muted-foreground">
                No soak run recorded in this process yet.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                setMessage(null);
                setError(null);
                startTransition(async () => {
                  try {
                    const res = await fetch('/api/admin/soak-health');
                    const data = (await res.json()) as {
                      ok: boolean;
                      healthy?: boolean;
                      error?: string;
                    };
                    if (!res.ok || !data.ok) {
                      setError(data.error ?? 'Soak failed');
                      return;
                    }
                    setMessage(
                      data.healthy ? 'Soak healthy' : 'Soak degraded — see card',
                    );
                    router.refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Soak failed');
                  }
                });
              }}
            >
              {pending ? 'Running…' : 'Run soak now'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Stage 4e soft-rename evidence
            </CardTitle>
            <CardDescription>
              Soft-rename verification plus legacy destructive gates. The app
              never drops{' '}
              <code className="text-xs">os_store_snapshots</code>. Retention
              target ≥90 days after ARCHIVE_EXPORT_CONFIRMED_AT.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="mb-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Retention: {status.snapshot_retention.detail}
            </div>
            {status.stage4e_checklist.ready ? (
              <div className="mb-2 rounded-md border border-emerald-600/40 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                Verified soft rename and soak gates are complete. The app has no
                destructive execution path. Offline rename/rollback guidance:{' '}
                <code className="text-[10px]">
                  phase36_operational_health_guide.sql
                </code>
                .
              </div>
            ) : (
              <div className="mb-2 rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
                Soft-rename evidence or soak is incomplete. Legacy destructive
                approval remains separate:{' '}
                {status.stage4e_checklist.drop_gate?.detail ??
                  'set SNAPSHOT_DROP_APPROVED_AT + BY'}
              </div>
            )}
            {status.stage4e_checklist.items.map((item) => (
              <div
                key={item.id}
                className="border-b border-border/40 py-1.5 last:border-0"
              >
                <div className="flex justify-between gap-2">
                  <span>{item.label}</span>
                  <span
                    className={
                      item.ok ? 'text-emerald-700' : 'text-muted-foreground'
                    }
                  >
                    {item.ok ? '✓' : '○'}
                  </span>
                </div>
                {item.detail ? (
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                ) : null}
              </div>
            ))}
            {status.soak_epoch ? (
              <div className="mt-3 rounded-md border border-border/60 p-3 text-xs">
                <p className="font-medium">
                  Durable epoch: {status.soak_epoch.status}
                </p>
                <p className="text-muted-foreground">
                  {status.soak_epoch.healthy_count} healthy observations ·
                  started {status.soak_epoch.streak_started_at ?? 'pending'} ·
                  last {status.soak_epoch.last_observed_at ?? 'pending'}
                </p>
                {status.soak_epoch.reset_reason ? (
                  <p className="text-destructive">
                    Reset: {status.soak_epoch.reset_reason}
                  </p>
                ) : null}
              </div>
            ) : null}
            {status.latest_drill_evidence ? (
              <div className="mt-3 rounded-md border border-border/60 p-3 text-xs">
                <p className="font-medium">
                  Structured drill: {status.latest_drill_evidence.status}
                </p>
                <p className="text-muted-foreground">
                  {status.latest_drill_evidence.trigger_source} · run{' '}
                  {status.latest_drill_evidence.drill_run_id} · revision{' '}
                  {status.latest_drill_evidence.code_revision ?? 'unknown'}
                </p>
                <p className="break-all font-mono text-[10px] text-muted-foreground">
                  config {status.latest_drill_evidence.config_fingerprint} ·
                  evidence{' '}
                  {status.latest_drill_evidence.evidence_sha256 ?? 'pending'}
                </p>
              </div>
            ) : null}
            {status.latest_evidence_cycle ? (
              <div className="mt-3 rounded-md border border-border/60 p-3 text-xs">
                <p className="font-medium">
                  Canonical evidence cycle: {status.latest_evidence_cycle.status}{' '}
                  ·{' '}
                  {status.latest_evidence_cycle.evidence_valid
                    ? 'valid'
                    : 'invalidated'}
                </p>
                <p className="text-muted-foreground">
                  {status.latest_evidence_cycle.operation} ·{' '}
                  {status.latest_evidence_cycle.source} · observed exactly{' '}
                  {status.latest_evidence_cycle.observed_at} · contract{' '}
                  {status.latest_evidence_cycle.contract_version}
                </p>
                <p className="break-all font-mono text-[10px] text-muted-foreground">
                  canonical {status.latest_evidence_cycle.canonical_sha256} ·
                  conflicts {status.latest_evidence_cycle.conflict_count}
                </p>
                <p className="text-muted-foreground">
                  Requested actor:{' '}
                  {JSON.stringify(status.latest_evidence_cycle.requested_actor)}
                </p>
                {status.latest_evidence_cycle.invalidation_reason ? (
                  <p className="text-destructive">
                    Invalidated: {status.latest_evidence_cycle.invalidation_reason}
                  </p>
                ) : null}
                {status.evidence_cycle_events.length ? (
                  <div className="mt-2 space-y-1">
                    {status.evidence_cycle_events.slice(0, 6).map((event) => (
                      <p
                        key={String(event.event_id)}
                        className="font-mono text-[10px] text-muted-foreground"
                      >
                        {String(event.occurred_at)} · {String(event.event_type)}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-3 space-y-2 rounded-md border border-border/60 p-3 text-xs">
              <p className="font-medium">Offline rollback rehearsal evidence</p>
              <p className="text-muted-foreground">
                Evidence capture only—this workflow cannot execute rollback or
                snapshot relation DDL.
              </p>
              {status.rollback_rehearsal ? (
                <>
                  <p>
                    {status.rollback_rehearsal.status} · operator{' '}
                    {status.rollback_rehearsal.operator_id} · reviewer{' '}
                    {status.rollback_rehearsal.reviewer_id ?? 'pending'}
                  </p>
                  <p className="break-all font-mono text-[10px] text-muted-foreground">
                    manifest {status.rollback_rehearsal.manifest_sha256} ·
                    artifact {status.rollback_rehearsal.artifact_sha256}
                  </p>
                </>
              ) : null}
              {pendingRollbackRehearsal ? (
                <div className="space-y-2 rounded border p-2">
                  <p>
                    Pending independent review · expires{' '}
                    {pendingRollbackRehearsal.expires_at}
                  </p>
                  <p className="break-all font-mono text-[10px]">
                    bundle{' '}
                    {pendingRollbackRehearsal.evidence_bundle_sha256 ??
                      'schema pending'}{' '}
                    · procedure {pendingRollbackRehearsal.procedure_sha256}
                  </p>
                  <a
                    className="break-all underline"
                    href={pendingRollbackRehearsal.artifact_uri}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {pendingRollbackRehearsal.artifact_uri}
                  </a>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[10px]">
                    {JSON.stringify(
                      pendingRollbackRehearsal.manifest,
                      null,
                      2,
                    )}
                  </pre>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      onClick={() => reviewRollbackRehearsal('attest')}
                    >
                      Reviewer attest exact bundle
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => reviewRollbackRehearsal('reject')}
                    >
                      Reject evidence
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending || !status.soak_epoch?.config_fingerprint}
                  onClick={createRollbackRehearsal}
                >
                  Record operator attestation
                </Button>
              )}
              {status.rollback_rehearsal_error ? (
                <p className="text-destructive">
                  Evidence query: {status.rollback_rehearsal_error}
                </p>
              ) : null}
              {status.rollback_rehearsal_events.length > 0 ? (
                <div className="space-y-1">
                  <p className="font-medium">Attestation lifecycle</p>
                  {status.rollback_rehearsal_events.slice(0, 8).map((event) => (
                    <p
                      key={String(event.event_id)}
                      className="font-mono text-[10px] text-muted-foreground"
                    >
                      {String(event.occurred_at)} · {String(event.event_type)} ·{' '}
                      {String(event.from_status ?? 'new')} →{' '}
                      {String(event.to_status)}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
            {status.retirement_timeline.length > 0 ? (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium">Retirement evidence timeline</p>
                {status.retirement_timeline.slice(0, 8).map((event) => (
                  <p
                    className="font-mono text-[10px] text-muted-foreground"
                    key={`${event.occurred_at}-${event.stage}`}
                  >
                    {event.occurred_at} · {event.stage} ·{' '}
                    {event.retired_table_name ?? 'no table'} ·{' '}
                    {event.approved_by ?? 'unknown approver'}
                  </p>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Snapshot write gates</CardTitle>
            <CardDescription>
              allow=false means SQL-first (snapshot writes suppressed).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {Object.entries(gates).map(([domain, gate]) => (
              <div
                key={domain}
                className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 last:border-0"
              >
                <span className="font-medium">{domain}</span>
                <span
                  className={
                    gate.allow
                      ? 'text-amber-700'
                      : 'text-emerald-700'
                  }
                >
                  {gate.allow ? 'writing' : 'skipped'} · {gate.reason}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Snapshot read gates (4b)</CardTitle>
            <CardDescription>
              allow=false means SQL-only hydrate (payload not adopted). Rollback
              with SNAPSHOT_READ_FORCE=1.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {Object.entries(status.write_cutover.snapshot_read_gates).map(
              ([domain, gate]) => (
                <div
                  key={domain}
                  className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 last:border-0"
                >
                  <span className="font-medium">{domain}</span>
                  <span
                    className={
                      gate.allow ? 'text-amber-700' : 'text-emerald-700'
                    }
                  >
                    {gate.allow ? 'loading' : 'sql-only'} · {gate.reason}
                  </span>
                </div>
              ),
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cutover flags</CardTitle>
            <CardDescription>Current process env (Vercel).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row
              label="WRITE_CUTOVER_MATURE"
              value={String(status.write_cutover.write_cutover_mature)}
            />
            <Row
              label="WRITE_CUTOVER_ALL"
              value={String(status.write_cutover.write_cutover_all)}
            />
            <Row
              label="READ_CUTOVER_ALL"
              value={String(status.write_cutover.read_cutover_all)}
            />
            <Row
              label="WRITE_SNAPSHOTS"
              value={
                status.write_cutover.write_snapshots_enabled ? 'on' : 'off'
              }
            />
            <Row
              label="PIPELINE_NULL_ENTITY_MODE"
              value={status.pipeline_null_entity_mode}
            />
            <Row
              label="Archive table"
              value={
                status.write_cutover.archive_table_ready ? 'ready' : 'missing'
              }
            />
            <Row
              label="Ready to archive"
              value={ready.length ? ready.join(', ') : '—'}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Archive export (4d)</CardTitle>
            <CardDescription>
              Download archive metadata JSON for offsite retention (≥90 days).
              After storing, confirm here or set ARCHIVE_EXPORT_CONFIRMED_AT. Does
              not drop tables.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <a
              href="/api/admin/archive-export"
              className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent"
            >
              Export archive metadata
            </a>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                setMessage(null);
                setError(null);
                startTransition(async () => {
                  try {
                    const res = await fetch('/api/admin/archive-export', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        note: 'Offsite retention confirmed from Admin UI',
                      }),
                    });
                    const json = (await res.json()) as {
                      ok?: boolean;
                      error?: string;
                      durable_hint?: string;
                    };
                    if (!res.ok || !json.ok) {
                      setError(json.error ?? 'Confirm failed');
                      return;
                    }
                    setMessage(
                      `Export confirmed. ${json.durable_hint ?? ''}`.trim(),
                    );
                    window.location.reload();
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : 'Confirm failed',
                    );
                  }
                });
              }}
            >
              Confirm offsite store
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Empty-snapshot drills</CardTitle>
          <CardDescription>
            Read-only checks: write cutover, empty live payload, normalized
            rows, and archive presence. {status.empty_snapshot_drills.summary}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {status.empty_snapshot_drills.results.map((r) => (
            <div
              key={r.collection}
              className="border-b border-border/40 py-2 last:border-0"
            >
              <div className="flex justify-between gap-2 font-medium">
                <span>{r.collection}</span>
                <span
                  className={
                    r.pass ? 'text-emerald-700' : 'text-destructive'
                  }
                >
                  {r.pass ? 'pass' : 'fail'}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {r.checks.map((c) => (
                  <li key={c.name}>
                    {c.ok ? '✓' : '✗'} {c.name}
                    {c.detail ? ` · ${c.detail}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              setMessage(null);
              setError(null);
              startTransition(async () => {
                try {
                  const res = await fetch('/api/admin/snapshot-drill');
                  const data = (await res.json()) as {
                    ok: boolean;
                    summary?: string;
                    error?: string;
                  };
                  if (!res.ok || !data.ok) {
                    setError(data.error ?? 'Drill failed');
                    return;
                  }
                  setMessage(data.summary ?? 'Drills complete');
                  router.refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Drill failed');
                }
              });
            }}
          >
            {pending ? 'Running…' : 'Re-run drills'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Soft-archive snapshots</CardTitle>
          <CardDescription>
            Copies live payload into{' '}
            <code className="text-xs">os_store_snapshot_archive</code>, then
            clears the live row to {'{}'}. Only collections with write cutover
            active. Reversible via SQL restore from archive.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            type="button"
            disabled={pending || ready.length === 0}
            onClick={archiveReady}
          >
            {pending
              ? 'Archiving…'
              : ready.length
                ? `Archive ${ready.length} cut-over collection(s)`
                : 'Enable cutover env first'}
          </Button>
          {message ? (
            <p className="text-sm text-emerald-700" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {status.sync_failures.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sync failures</CardTitle>
            <CardDescription>
              Dual-write / SQL sync errors in this process. Check Sentry when
              configured.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {status.sync_failures.map((f) => (
              <div
                key={f.key}
                className="flex justify-between gap-2 border-b border-border/40 py-1"
              >
                <span>
                  {f.key}
                  <span className="ml-2 text-xs text-destructive">
                    ×{f.fail}
                    {f.lastError ? ` · ${f.lastError}` : ''}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {f.lastFailAt
                    ? new Date(f.lastFailAt).toLocaleString()
                    : '—'}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {status.fk_integrity ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">FK integrity</CardTitle>
            <CardDescription>
              Orphan counts after Phase 17 validate. Zero is healthy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {status.fk_integrity.map((r) => (
              <div
                key={r.check_name}
                className="flex justify-between gap-2 border-b border-border/40 py-1"
              >
                <span>{r.check_name}</span>
                <span
                  className={
                    r.orphan_count > 0
                      ? 'font-medium text-destructive'
                      : 'text-muted-foreground'
                  }
                >
                  {r.orphan_count}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">FK integrity</CardTitle>
            <CardDescription>
              Apply <code className="text-xs">phase17_validate_fks.sql</code>{' '}
              to enable the integrity view.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Row counts</CardTitle>
          </CardHeader>
          <CardContent className="max-h-72 space-y-1 overflow-auto text-sm">
            {Object.entries(status.row_counts)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([domain, count]) => (
                <div
                  key={domain}
                  className="flex justify-between gap-2 border-b border-border/40 py-1"
                >
                  <span>{domain}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live snapshots</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {status.snapshots.length === 0 ? (
              <p className="text-muted-foreground">No snapshot rows</p>
            ) : (
              status.snapshots.map((s) => (
                <div
                  key={s.collection}
                  className="flex justify-between gap-2 border-b border-border/40 py-1"
                >
                  <span>
                    {s.collection}
                    {s.payload_empty ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        empty
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(s.updated_at).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {status.recent_archives && status.recent_archives.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent archives</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {status.recent_archives.map((a) => (
              <div
                key={a.id}
                className="flex justify-between gap-2 border-b border-border/40 py-1"
              >
                <span>
                  {a.collection}
                  {a.note ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {a.note}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">
                  {new Date(a.archived_at).toLocaleString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/50 py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate text-right font-medium">{value}</span>
    </div>
  );
}
