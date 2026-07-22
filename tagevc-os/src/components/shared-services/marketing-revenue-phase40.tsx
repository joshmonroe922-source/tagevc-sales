import type { Phase40RevenueReport } from '@/lib/shared-services/marketing-revenue-contracts';

function money(micros: string, currency: string) {
  const value = BigInt(micros);
  const scale = BigInt(1_000_000);
  return `${currency} ${(value / scale).toLocaleString()}.${(value % scale)
    .toString()
    .padStart(6, '0')
    .slice(0, 2)}`;
}

export function MarketingRevenuePhase40({
  report,
  error,
}: {
  report: Phase40RevenueReport;
  error?: string;
}) {
  const grouped = new Map<
    string,
    Phase40RevenueReport['model_comparisons']
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

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">Authoritative revenue ingestion</h2>
          <p className="text-xs text-muted-foreground">
            Canonical source receipts, corrections, and aligned model allocations
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
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {report.sources.map((source) => (
          <div className="rounded border p-2 text-xs" key={source.source_id}>
            <p className="font-medium">{source.display_name}</p>
            <p className="text-muted-foreground">
              {source.config_status} · authenticity {source.authenticity_status}
            </p>
            <p>
              {source.observed_records}/{source.expected_records} observed ·{' '}
              {source.reconciliation_status} · {source.failed_runs} failed runs
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
                {rows[0]?.cohort_window_start.slice(0, 10)}–{rows[0]?.cohort_window_end.slice(0, 10)}
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
