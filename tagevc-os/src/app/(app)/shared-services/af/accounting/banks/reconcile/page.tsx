import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import { getAfStore } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function ReconcilePage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs } = await resolveAfEntityParam(searchParams);
  const store = getAfStore();
  const matched = store.feedTxns.filter((t) => t.status === 'Matched');
  const exceptions = store.feedTxns.filter((t) => t.status === 'Unmatched');

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Banks · Reconcile"
        title="Bank reconciliation"
        description="Matched feed txns link to Payment records only — AP is never double-cleared."
        secondaryActions={<AfBackLink href={`/shared-services/af/accounting/banks${qs}`} label="Banks" />}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <h2 className="font-heading font-semibold text-[#3a414f]">Matched ({matched.length})</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {matched.map((t) => (
              <li key={t.id} className="flex justify-between gap-2 border-b border-border/50 py-2">
                <span>{t.description}</span>
                <span className="flex items-center gap-2"><Money value={t.amount} /><StatusPill status="Matched" /></span>
              </li>
            ))}
            {matched.length === 0 && <li className="text-muted-foreground">None yet</li>}
          </ul>
        </div>
        <div className="rounded-xl border border-border p-4">
          <h2 className="font-heading font-semibold text-[#3a414f]">Exceptions ({exceptions.length})</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {exceptions.map((t) => (
              <li key={t.id} className="flex justify-between gap-2 border-b border-border/50 py-2">
                <span>{t.description}</span>
                <StatusPill status="Unmatched" />
              </li>
            ))}
            {exceptions.length === 0 && <li className="text-muted-foreground">Clear — exception-only review</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
