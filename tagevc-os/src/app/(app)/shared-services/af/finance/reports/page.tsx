import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import { MetricCardBoard } from '@/components/platform/metric-card-board';
import {
  TIME_FILTERS,
  apAging,
  arAging,
  collectionsPerformance,
  computeAllKpis,
  deferredRevenueRollforward,
  getAfStore,
  listAfEvents,
  type EntityCode,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string; range?: string }> };

function usd(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function ReportsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const params = (await searchParams) ?? {};
  const { qs, entityId } = await resolveAfEntityParam(searchParams);
  const store = getAfStore();
  let kpis = computeAllKpis({
    balances: store.openingBalances,
    invoices: store.invoices,
    bills: store.bills,
  });
  if (entityId) kpis = kpis.filter((k) => k.entityCode === entityId);
  const entity = (entityId as EntityCode) || null;
  const aging = arAging(store.invoices, entity);
  const ap = apAging(store.bills, entity);
  const collections = collectionsPerformance({
    invoices: store.invoices,
    entityCode: entity,
  });
  const deferred = deferredRevenueRollforward(store.openingBalances).filter(
    (r) => !entity || r.entityCode === entity,
  );
  const events = await listAfEvents(8);
  const range =
    TIME_FILTERS.find((t) => t.id === params.range)?.label ?? 'Current month';

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance"
        title="Reports & KPIs"
        description={`Time filter: ${range}. Cash, AR/AP aging, collections, deferred revenue — health enums only.`}
        secondaryActions={
          <AfBackLink href={`/shared-services/af/finance${qs}`} label="Finance" />
        }
      />

      <div className="flex flex-wrap gap-2">
        {TIME_FILTERS.map((t) => (
          <a
            key={t.id}
            href={`/shared-services/af/finance/reports?range=${t.id}${
              entityId ? `&entity=${entityId}` : ''
            }`}
            className={
              (params.range ?? 'current_month') === t.id
                ? 'rounded-md bg-[#3a414f] px-3 py-1.5 text-xs font-medium text-white'
                : 'rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground'
            }
          >
            {t.label}
          </a>
        ))}
      </div>

      <MetricCardBoard
        surface="af-finance-kpis"
        columns={4}
        items={[
          ...kpis.map((k) => ({
            id: k.entityCode,
            label: k.entityCode,
            value: usd(k.freeCash),
            hint: `${k.health} · Cash ${usd(k.cashOperating)} · AR ${usd(k.ar)} · AP ${usd(k.ap)}`,
          })),
          {
            id: 'collections',
            label: 'Collections',
            value: usd(collections.overdueAmount),
            hint: `${collections.health} · ${collections.overdueCount} overdue · DSO ~${collections.dsoApprox}`,
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            AR aging
          </h2>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Bucket</th>
                  <th className="px-4 py-3 text-right">Count</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {aging.map((b) => (
                  <tr key={b.label} className="border-t border-border/70">
                    <td className="px-4 py-3">{b.label}</td>
                    <td className="px-4 py-3 text-right">{b.count}</td>
                    <td className="px-4 py-3 text-right">
                      <Money value={b.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            AP aging
          </h2>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Bucket</th>
                  <th className="px-4 py-3 text-right">Count</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ap.map((b) => (
                  <tr key={b.label} className="border-t border-border/70">
                    <td className="px-4 py-3">{b.label}</td>
                    <td className="px-4 py-3 text-right">{b.count}</td>
                    <td className="px-4 py-3 text-right">
                      <Money value={b.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {deferred.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Deferred revenue rollforward
          </h2>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3 text-right">Opening</th>
                  <th className="px-4 py-3 text-right">Additions</th>
                  <th className="px-4 py-3 text-right">Releases</th>
                  <th className="px-4 py-3 text-right">Ending</th>
                </tr>
              </thead>
              <tbody>
                {deferred.map((r) => (
                  <tr key={r.entityCode} className="border-t border-border/70">
                    <td className="px-4 py-3">{r.entityCode}</td>
                    <td className="px-4 py-3 text-right">
                      <Money value={r.opening} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money value={r.additions} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money value={r.releases} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money value={r.ending} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          Recent OS ↔ A&F events
        </h2>
        <ul className="space-y-2">
          {events.length === 0 ? (
            <li className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No events yet — pay an invoice or POST /api/af/webhooks/inbound.
            </li>
          ) : (
            events.map((e) => (
              <li
                key={e.event_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-[#3a414f]">{e.event_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.entity_code ?? '—'} · {e.source_system} · {e.occurred_at}
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
