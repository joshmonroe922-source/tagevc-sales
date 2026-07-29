import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money } from '@/components/af/af-ui';
import {
  bucketBalances,
  getAfStore,
  type EntityCode,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function CommissionsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, qs } = await resolveAfEntityParam(searchParams);
  const store = getAfStore();
  const liability = entityId
    ? (store.openingBalances[entityId]?.['2250'] ?? 0)
    : Object.values(store.openingBalances).reduce(
        (s, b) => s + (b['2250'] ?? 0),
        0,
      );
  const buckets = bucketBalances(
    store.allocationLedger,
    entityId as EntityCode | undefined,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · Commissions"
        title="Protected commission liability"
        description="Account 2250 is credited on invoice.paid and is not free operating cash."
        secondaryActions={
          <AfBackLink href={`/shared-services/af/accounting${qs}`} label="Accounting" />
        }
      />
      <div className="rounded-xl border border-border bg-gradient-to-br from-[#f7f6f3] to-white px-5 py-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          GL 2250 balance
        </p>
        <p className="font-heading text-3xl font-semibold text-[#3a414f]">
          <Money value={liability} />
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(buckets).map(([code, amt]) => (
          <div key={code} className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">{code}</p>
            <p className="font-medium">
              <Money value={amt} />
            </p>
          </div>
        ))}
        {Object.keys(buckets).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Mark an invoice paid to populate waterfall + 2250.
          </p>
        )}
      </div>
    </div>
  );
}
