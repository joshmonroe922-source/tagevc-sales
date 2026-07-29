import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money } from '@/components/af/af-ui';
import { AF_ENTITIES, getAfStore, parentDueFromAccount } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function IcPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs } = await resolveAfEntityParam(searchParams);
  const bals = getAfStore().openingBalances;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · Intercompany"
        title="IC hub"
        description="Parent Due From 141x ↔ Sub Due To Parent 2450. Eliminations cancel in consolidated NW."
        secondaryActions={<AfBackLink href={`/shared-services/af/accounting${qs}`} label="Accounting" />}
      />
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Subsidiary</th>
              <th className="px-4 py-3">Parent Due From</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3">Sub Due To 2450</th>
              <th className="px-4 py-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {AF_ENTITIES.filter((e) => e.code !== 'TVC').map((e) => {
              const dueFrom = parentDueFromAccount(e.code);
              return (
                <tr key={e.code} className="border-t border-border/70">
                  <td className="px-4 py-3 font-medium">{e.legalName}</td>
                  <td className="px-4 py-3 tabular-nums">{dueFrom}</td>
                  <td className="px-4 py-3 text-right"><Money value={bals.TVC?.[dueFrom] ?? 0} /></td>
                  <td className="px-4 py-3">2450</td>
                  <td className="px-4 py-3 text-right"><Money value={bals[e.code]?.['2450'] ?? 0} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
