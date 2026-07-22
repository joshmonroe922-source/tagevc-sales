'use client';

import { useState, useTransition } from 'react';
import type {
  Phase41RevenueReport,
  Phase42RevenueSloReport,
  Phase43RevenueOpsReport,
} from '@/lib/shared-services/marketing-revenue-contracts';
import {
  reviewMarketingRevenueCorrectionAction,
} from '@/app/(app)/shared-services/marketing/actions';

function money(micros: string, currency: string) {
  const value = BigInt(micros || '0');
  const scale = BigInt(1_000_000);
  return `${currency} ${(value / scale).toLocaleString()}.${(value % scale)
    .toString()
    .padStart(6, '0')
    .slice(0, 2)}`;
}

function percent(rate: number | null | undefined) {
  if (rate == null || Number.isNaN(Number(rate))) return 'n/a';
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

function severityClass(severity: string) {
  if (severity === 'critical') return 'border-destructive text-destructive';
  if (severity === 'warning') return 'border-amber-600 text-amber-800';
  if (severity === 'healthy') return 'border-emerald-600 text-emerald-800';
  return 'border-muted-foreground/40 text-muted-foreground';
}

function deliveryClass(status: string) {
  if (status === 'delivered') return 'border-emerald-600 text-emerald-800';
  if (status === 'failed') return 'border-destructive text-destructive';
  if (status === 'skipped_no_webhook') return 'border-amber-600 text-amber-800';
  return 'border-muted-foreground/40 text-muted-foreground';
}

export function MarketingRevenuePhase41({
  report,
  error,
  canWrite = false,
  sloReport,
  sloError,
  opsReport,
  opsError,
}: {
  report: Phase41RevenueReport;
  error?: string;
  canWrite?: boolean;
  sloReport?: Phase42RevenueSloReport;
  sloError?: string;
  opsReport?: Phase43RevenueOpsReport;
  opsError?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const grouped = new Map<
    string,
    Phase41RevenueReport['model_comparisons']
  >();
  for (const row of report.model_comparisons) {
    const key = [
      row.cohort_key,
      row.cohort_window_start,
      row.cohort_window_end,
      row.currency,
      row.attribution_window_days,
    ].join(':');
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  function reviewCorrection(
    correctionId: string,
    decision: 'approved' | 'rejected',
  ) {
    const reason = window.prompt(
      decision === 'approved'
        ? 'Approval reason (min 10 characters):'
        : 'Rejection reason (min 10 characters):',
    );
    if (!reason?.trim()) return;
    setActionError(null);
    setActionMessage(null);
    startTransition(async () => {
      const result = await reviewMarketingRevenueCorrectionAction(
        correctionId,
        decision,
        reason.trim(),
      );
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setActionMessage(result.message ?? `Correction ${decision}`);
    });
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">Production ledger revenue</h2>
          <p className="text-xs text-muted-foreground">
            Authenticity modes, correction queue, settlement-lag summary, and
            production SLO badges over authoritative evidence
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {report.observed_records}/{report.expected_records} records ·{' '}
          {report.completeness_percent == null
            ? 'no denominator'
            : `${report.completeness_percent}% complete`}{' '}
          · {report.late_records} late · {report.pending_corrections} corrections
          pending
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {actionError ? (
        <p className="text-sm text-destructive">{actionError}</p>
      ) : null}
      {actionMessage ? (
        <p className="text-sm text-emerald-700">{actionMessage}</p>
      ) : null}

      {sloReport ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium">Production SLOs</p>
            <span
              className={`rounded border px-2 py-0.5 text-[11px] ${severityClass(sloReport.overall_severity)}`}
            >
              overall {sloReport.overall_severity}
            </span>
            <span
              className={`rounded border px-2 py-0.5 text-[11px] ${severityClass(sloReport.authenticity_severity)}`}
            >
              authenticity {sloReport.authenticity_severity}
            </span>
            <span
              className={`rounded border px-2 py-0.5 text-[11px] ${severityClass(sloReport.settlement_severity)}`}
            >
              settlement {sloReport.settlement_severity}
            </span>
            {opsReport ? (
              <>
                <span
                  className={`rounded border px-2 py-0.5 text-[11px] ${severityClass(opsReport.binding_health)}`}
                >
                  credential binding {opsReport.binding_health}
                </span>
                <span
                  className={`rounded border px-2 py-0.5 text-[11px] ${deliveryClass(opsReport.alert_delivery)}`}
                >
                  critical alerts {opsReport.alert_delivery}
                  {opsReport.critical_alert_count > 0
                    ? ` (${opsReport.critical_alert_count})`
                    : ''}
                </span>
              </>
            ) : null}
          </div>
          {sloError ? (
            <p className="text-xs text-destructive">{sloError}</p>
          ) : null}
          {opsError ? (
            <p className="text-xs text-destructive">{opsError}</p>
          ) : null}
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded border p-2 text-xs">
              <p className="font-medium">Authenticity probe fail rate</p>
              <p className="text-muted-foreground">
                warn ≥{' '}
                {percent(sloReport.thresholds.authenticity_fail_rate.warning)} ·
                crit ≥{' '}
                {percent(sloReport.thresholds.authenticity_fail_rate.critical)}
              </p>
              {(sloReport.authenticity_snapshots ?? []).slice(0, 6).map((row) => (
                <p key={row.snapshot_id} className="mt-1">
                  <span className={severityClass(row.severity)}>{row.severity}</span>
                  {' · '}
                  {row.authenticity_mode} · {row.fail_count}/{row.probe_count}{' '}
                  failed ({percent(row.fail_rate)})
                </p>
              ))}
              {(sloReport.authenticity_snapshots ?? []).length === 0 ? (
                <p className="mt-1 text-muted-foreground">
                  No authenticity SLO snapshots yet for production_v1 sources.
                </p>
              ) : null}
            </div>
            <div className="rounded border p-2 text-xs">
              <p className="font-medium">Settlement overdue / late rate</p>
              <p className="text-muted-foreground">
                warn ≥ {percent(sloReport.thresholds.settlement_rate.warning)} ·
                crit ≥ {percent(sloReport.thresholds.settlement_rate.critical)}
              </p>
              {(sloReport.settlement_snapshots ?? []).slice(0, 6).map((row) => (
                <p key={row.snapshot_id} className="mt-1">
                  <span className={severityClass(row.severity)}>{row.severity}</span>
                  {' · '}
                  {row.overdue_count} overdue ({percent(row.overdue_rate)}) ·{' '}
                  {row.settled_late_count} late ({percent(row.late_rate)}) ·{' '}
                  {row.evidence_count} evidence
                </p>
              ))}
              {(sloReport.settlement_snapshots ?? []).length === 0 ? (
                <p className="mt-1 text-muted-foreground">
                  No settlement SLO snapshots yet for production_v1 sources.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-medium">Authenticity modes</p>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {report.authenticity_modes.map((mode) => (
            <div
              className="rounded border p-2 text-xs"
              key={mode.authenticity_mode}
            >
              <p className="font-medium">{mode.authenticity_mode}</p>
              <p className="text-muted-foreground">
                {mode.source_count} sources · {mode.verified_count} verified ·{' '}
                {mode.failed_count} failed · {mode.unchecked_count} unchecked
              </p>
            </div>
          ))}
          {report.authenticity_modes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No authenticity modes configured in this scope.
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">Settlement lag</p>
        {report.settlement_lag.available ? (
          <div className="rounded border p-2 text-xs">
            <p>
              {report.settlement_lag.overdue_count} overdue ·{' '}
              {report.settlement_lag.settled_late_count} settled late · max lag{' '}
              {report.settlement_lag.max_lag_days ?? 'n/a'}d · avg{' '}
              {report.settlement_lag.average_lag_days ?? 'n/a'}d
            </p>
            <p className="text-muted-foreground">
              {(report.settlement_lag.by_status ?? [])
                .map(
                  (row) =>
                    `${row.lag_status}: ${row.evidence_count} (max ${row.max_lag_days ?? 'n/a'}d)`,
                )
                .join(' · ') || 'No settlement evidence in window'}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Settlement lag is unavailable until Phase 39 revenue evidence exists.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">Pending correction queue</p>
        {report.pending_correction_queue.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No pending corrections in this scope.
          </p>
        ) : (
          report.pending_correction_queue.map((correction) => (
            <div
              className="flex flex-wrap items-start justify-between gap-2 rounded border p-2 text-xs"
              key={correction.correction_id}
            >
              <div>
                <p className="font-medium">
                  {correction.source_key} · rev {correction.proposed_revision}
                </p>
                <p className="text-muted-foreground">
                  {correction.revenue_event_id || 'event'} ·{' '}
                  {correction.attribution_model || 'model'} ·{' '}
                  {money(
                    correction.amount_micros,
                    correction.currency || 'USD',
                  )}
                </p>
                <p>{correction.reason}</p>
              </div>
              {canWrite ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded border px-2 py-1"
                    disabled={pending}
                    onClick={() =>
                      reviewCorrection(correction.correction_id, 'approved')
                    }
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="rounded border px-2 py-1"
                    disabled={pending}
                    onClick={() =>
                      reviewCorrection(correction.correction_id, 'rejected')
                    }
                  >
                    Reject
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {report.sources.map((source) => (
          <div className="rounded border p-2 text-xs" key={source.source_id}>
            <p className="font-medium">{source.display_name}</p>
            <p className="text-muted-foreground">
              {source.config_status} · {source.authenticity_mode ?? 'mode'} ·{' '}
              {source.ledger_profile ?? 'profile'} ·{' '}
              {source.ledger_kind ?? 'kind'}
            </p>
            <p>
              authenticity {source.authenticity_status} ·{' '}
              {source.observed_records}/{source.expected_records} observed ·{' '}
              {source.reconciliation_status}
            </p>
            <p className="text-muted-foreground">
              Checkpoint {source.checkpoint_at ?? 'not established'}
            </p>
          </div>
        ))}
        {report.sources.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No authoritative revenue sources are configured for this scope.
          </p>
        ) : null}
      </div>

      {grouped.size > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium">Aligned attribution models</p>
          <p className="text-xs text-muted-foreground">
            {report.comparison_semantics}
          </p>
          {[...grouped.entries()].slice(0, 50).map(([key, rows]) => (
            <div className="rounded border p-2 text-xs" key={key}>
              <p className="font-medium">
                {rows[0]?.cohort_key} · {rows[0]?.currency} ·{' '}
                {rows[0]?.attribution_window_days}d
              </p>
              <p className="text-muted-foreground">
                {rows[0]?.cohort_window_start.slice(0, 10)}–
                {rows[0]?.cohort_window_end.slice(0, 10)}
                {' · '}
                {rows[0]?.event_count} aligned events
              </p>
              <p>
                {rows
                  .map(
                    (row) =>
                      `${row.attribution_model}: ${money(
                        row.amount_micros,
                        row.currency,
                      )}`,
                  )
                  .join(' · ')}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Model comparisons appear only when cohort, window, currency, and
          attribution window align.
        </p>
      )}
    </section>
  );
}
