import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money } from '@/components/af/af-ui';
import { AF_ALLOCATION_PROFILES, AF_ENTITIES, bucketBalances, getAfStore, profitSubSplit } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';
import type { EntityCode } from '@/lib/af';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function BucketsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, qs } = await resolveAfEntityParam(searchParams);
  const code = (entityId as EntityCode) || 'R619';
  const store = getAfStore();
  const balances = bucketBalances(store.allocationLedger, code);
  const profile = AF_ALLOCATION_PROFILES[code] ?? [];
  const profit = balances.PROFIT ?? 0;
  const split = profitSubSplit(profit);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance · Waterfall"
        title="Revenue split buckets"
        description="Planning envelopes by dept from invoice.paid — not separate banks. Hiring consumes DIR/SALES/TECH/GA."
        secondaryActions={<AfBackLink href={`/shared-services/af/finance${qs}`} label="Finance" />}
      />
      <div className="flex flex-wrap gap-2">
        {AF_ENTITIES.map((e) => (
          <a key={e.code} href={`/shared-services/af/finance/buckets?entity=${e.code}`}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${code === e.code ? 'bg-[#3a414f] text-white' : 'bg-muted text-muted-foreground'}`}>
            {e.legalName}
          </a>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {profile.map((b) => (
          <div key={b.bucket} className="rounded-xl border border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-heading font-semibold text-[#3a414f]">{b.bucket}</p>
              <p className="text-xs text-muted-foreground">{b.dept}</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{b.name}{b.pct != null ? ` · ${Math.round(b.pct * 1000) / 10}%` : ' · plug'}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums"><Money value={balances[b.bucket] ?? 0} /></p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border px-4 py-3 text-sm">
        <p className="font-medium text-[#3a414f]">PROFIT sub-split (group policy)</p>
        <p className="mt-1 text-muted-foreground">90% Bank for Investments planning <Money value={split.investments} /> · 10% distributions <Money value={split.distributions} /></p>
      </div>
    </div>
  );
}
