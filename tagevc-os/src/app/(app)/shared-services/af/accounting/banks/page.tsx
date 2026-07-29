import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import { AF_BANKS, AF_ENTITIES, getAfStore, getNetWorthSnapshot } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';
import { MatchFeedsButton } from '@/components/af/match-feeds-button';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function BanksPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, qs } = await resolveAfEntityParam(searchParams);
  const nw = getNetWorthSnapshot();
  const store = getAfStore();
  const banks = entityId
    ? AF_BANKS.filter((b) => b.entityCode === entityId)
    : AF_BANKS;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · Banks"
        title="Banks & Cards"
        description="Simplified policy: Operating 1000 per entity · Savings 1040 (subs) · Investments 1010 (Tage VC). No per-revenue banks."
        secondaryActions={<AfBackLink href={`/shared-services/af/accounting${qs}`} label="Accounting" />}
        primaryAction={<MatchFeedsButton />}
      />

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">GL</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Feed</th>
              <th className="px-4 py-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {banks.map((b) => {
              const bal = nw.byEntity[b.entityCode]?.cashBreakdown[b.glAccount] ?? 0;
              return (
                <tr key={b.id} className="border-t border-border/70">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#3a414f]">{b.name}</p>
                    <p className="text-xs text-muted-foreground">{b.id}</p>
                  </td>
                  <td className="px-4 py-3">{AF_ENTITIES.find((e) => e.code === b.entityCode)?.legalName}</td>
                  <td className="px-4 py-3 tabular-nums">{b.glAccount}</td>
                  <td className="px-4 py-3">{b.type}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={b.feedEnabled ? 'On Track' : 'Watch'} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium"><Money value={bal} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">Feed activity</h2>
          <Link href={`/shared-services/af/accounting/banks/reconcile${qs}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            Reconcile →
          </Link>
        </div>
        {store.feedTxns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No live feed transactions yet. Connect banks in Setup, then click
            Sync live Plaid.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Bank</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {store.feedTxns.map((t) => (
                  <tr key={t.id} className="border-t border-border/70">
                    <td className="px-4 py-3">{t.date}</td>
                    <td className="px-4 py-3">{t.description}</td>
                    <td className="px-4 py-3 text-xs">{t.bankAccountId}</td>
                    <td className="px-4 py-3 text-right"><Money value={t.amount} /></td>
                    <td className="px-4 py-3"><StatusPill status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
