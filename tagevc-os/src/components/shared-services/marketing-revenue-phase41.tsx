'use client';

import { useState, useTransition } from 'react';
import type { Phase41RevenueReport } from '@/lib/shared-services/marketing-revenue-contracts';
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

export function MarketingRevenuePhase41({
  report,
  error,
  canWrite = false,
}: {
  report: Phase41RevenueReport;
  error?: string;
  canWrite?: boolean;
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
            Authenticity modes, correction queue, and settlement-lag summary over
            authoritative evidence
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
