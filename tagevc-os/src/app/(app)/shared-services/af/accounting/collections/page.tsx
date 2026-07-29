import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import { MetricCardBoard } from '@/components/platform/metric-card-board';
import {
  buildCollectionsQueue,
  getAfStore,
  summarizeCollections,
  type EntityCode,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

function usd(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function CollectionsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs, entityId } = await resolveAfEntityParam(searchParams);
  const store = getAfStore();
  const queue = buildCollectionsQueue({
    invoices: store.invoices,
    entityCode: (entityId as EntityCode) || null,
  });
  const summary = summarizeCollections(queue);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · AR"
        title="Collections"
        description="Reminder cadence −3 / due / +7 / +14 / +30. Escalation queue for overdue balances."
        secondaryActions={
          <AfBackLink href={`/shared-services/af/accounting${qs}`} label="Accounting" />
        }
      />

      <MetricCardBoard
        surface="af-ar-collections"
        columns={4}
        items={[
          {
            id: 'queue',
            label: 'In queue',
            value: String(summary.queueCount),
            hint: summary.health,
          },
          {
            id: 'overdue',
            label: 'Overdue',
            value: String(summary.overdueCount),
            hint: usd(summary.overdueAmount),
          },
          {
            id: 'escalated',
            label: 'Escalated',
            value: String(summary.escalatedCount),
            hint: 'Controller hold path',
          },
          {
            id: 'health',
            label: 'Collections health',
            value: summary.health,
            hint: 'On Track · Watch · At Risk · Critical',
          },
        ]}
      />

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Next</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3">Health</th>
            </tr>
          </thead>
          <tbody>
            {queue.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No open invoices in collections.
                </td>
              </tr>
            ) : (
              queue.map((row) => (
                <tr key={row.invoiceId} className="border-t border-border/70">
                  <td className="px-4 py-3">
                    <Link
                      href={`/shared-services/af/accounting/invoices/${row.invoiceId}${qs}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {row.number}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {row.entityCode} · {row.daysPastDue}d
                    </p>
                  </td>
                  <td className="px-4 py-3">{row.customerName}</td>
                  <td className="px-4 py-3">{row.dueDate}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={row.stage} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {row.nextAction}
                    <span className="mt-0.5 block">via {row.channel}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money value={row.balance} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={row.health} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
