import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { FinancialAuditSummary } from '@/lib/types';

export function FinancialAuditHistory({
  audits,
}: {
  audits: FinancialAuditSummary[] | null;
}) {
  if (audits === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Financial edit history</CardTitle>
          <CardDescription>
            Apply Phase 18 financial audit SQL to enable history.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (audits.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Financial edit history</CardTitle>
          <CardDescription>No audited edits yet for this entity.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Financial edit history</CardTitle>
        <CardDescription>
          Append-only CORE / KPI / FLEX patches (most recent first).
        </CardDescription>
      </CardHeader>
      <CardContent className="max-h-72 space-y-2 overflow-auto text-sm">
        {audits.map((a) => {
          const kind =
            typeof a.patch.kind === 'string' ? a.patch.kind : 'core_financials';
          const detail = Object.entries(a.patch)
            .filter(([k]) => k !== 'kind')
            .slice(0, 4)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(' · ');
          return (
            <div
              key={a.id}
              className="border-b border-border/40 py-2 last:border-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {a.audit_id} · {kind}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {a.period}
                {a.actor_email ? ` · ${a.actor_email}` : ''}
                {detail ? ` · ${detail}` : ''}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
