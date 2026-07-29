import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { CloseActions } from '@/components/af/close-actions';
import {
  closeProgress,
  currentPeriod,
  evaluateCloseChecklist,
  getAfStore,
  type EntityCode,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function ClosePage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs, entityId } = await resolveAfEntityParam(searchParams);
  const store = getAfStore();
  const period = currentPeriod();
  const entityCode = (entityId as EntityCode) || null;
  const tasks = evaluateCloseChecklist({
    entityCode,
    period,
    balances: store.openingBalances,
    invoices: store.invoices,
    bills: store.bills,
    journals: store.journals,
    feedTxns: store.feedTxns,
    locks: store.periodLocks,
    snapshots: store.snapshots,
  });
  const progress = closeProgress(tasks);
  const lockScope = entityCode ?? 'CONSOL';
  const activeLock = store.periodLocks.find(
    (l) => l.period === period && l.entityCode === lockScope,
  );
  const snap = store.snapshots.find(
    (s) => s.period === period && s.entityCode === lockScope,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · Close"
        title="Continuous close"
        description={`Period ${period}. Soft close warns; hard lock blocks posting. Reopen requires Controls role + audit log.`}
        secondaryActions={
          <AfBackLink href={`/shared-services/af/accounting${qs}`} label="Accounting" />
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Close progress
          </p>
          <p className="font-heading text-2xl font-semibold text-[#3a414f]">
            {progress.done}/{progress.total} · {progress.pct}%
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Lock: {activeLock?.mode ?? 'open'}
            {snap ? ` · Snapshot ${snap.id.slice(0, 18)}…` : ' · No snapshot yet'}
          </p>
        </div>
        <CloseActions
          entityCode={lockScope}
          period={period}
          readyForHardLock={progress.readyForHardLock}
        />
      </div>

      <ul className="space-y-2">
        {tasks.map((t, i) => (
          <li
            key={t.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium text-[#3a414f]">
                <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                {t.label}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.detail}</p>
            </div>
            <StatusPill status={t.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
