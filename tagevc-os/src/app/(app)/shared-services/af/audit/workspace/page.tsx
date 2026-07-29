import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import {
  currentPeriod,
  getAfStore,
  getNetWorthSnapshot,
  listAfAudit,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function AuditWorkspacePage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs } = await resolveAfEntityParam(searchParams);
  const store = getAfStore();
  const period = currentPeriod();
  const nw = getNetWorthSnapshot();
  const audit = await listAfAudit(20);
  const snaps = store.snapshots.filter((s) => s.period === period);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Audit"
        title="Auditor workspace"
        description="Read-only period snapshots, PBC evidence, and recent A&F audit trail."
        secondaryActions={
          <AfBackLink href={`/shared-services/af/audit${qs}`} label="Audit" />
        }
      />

      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Period {period} · consolidated NW
        </p>
        <p className="font-heading text-3xl font-semibold text-[#3a414f]">
          <Money value={nw.consolidated.netWorth} />
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Cash <Money value={nw.consolidated.cash} /> · personal books excluded
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Period snapshots
        </h2>
        {snaps.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
            No snapshots for {period} yet — take one from Continuous Close.
          </p>
        ) : (
          <ul className="space-y-2">
            {snaps.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-[#3a414f]">
                    {s.entityCode} · {s.period}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.takenAt} · {s.invoiceCount} inv · {s.billCount} bills ·{' '}
                    {s.journalCount} JEs
                  </p>
                </div>
                <div className="text-right">
                  {s.netWorth != null ? (
                    <p className="font-medium">
                      <Money value={s.netWorth} />
                    </p>
                  ) : null}
                  <StatusPill status="Done" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          PBC checklist
        </h2>
        <ul className="space-y-2 text-sm">
          {[
            'Trial balances by entity',
            'AR/AP aging',
            'Bank rec evidence (ENT-03)',
            'IC Due From/To + elim',
            'Period snapshot + lock status',
            'SOC2 control catalog status',
          ].map((item) => (
            <li
              key={item}
              className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
            >
              <span>{item}</span>
              <StatusPill status="In progress" />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Audit trail
        </h2>
        <ul className="space-y-2">
          {audit.length === 0 ? (
            <li className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No audit entries yet.
            </li>
          ) : (
            audit.map((a, i) => (
              <li
                key={a.id ?? `${a.action}-${i}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-[#3a414f]">{a.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.entityCode ?? '—'} · {a.refType}/{a.refId} ·{' '}
                    {a.occurredAt}
                  </p>
                </div>
                <StatusPill status="Done" />
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
