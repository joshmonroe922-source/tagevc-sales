import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money } from '@/components/af/af-ui';
import {
  SEED_LOANS,
  buildAmortization,
  compareExtraPayment,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = {
  searchParams?: Promise<{ entity?: string; loan?: string; extra?: string }>;
};

export default async function LoansPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const params = (await searchParams) ?? {};
  const { qs, entityId } = await resolveAfEntityParam(searchParams);
  const loans = entityId
    ? SEED_LOANS.filter((l) => l.entityCode === entityId)
    : SEED_LOANS;
  const activeId = params.loan || loans[0]?.id;
  const active = loans.find((l) => l.id === activeId) ?? loans[0];
  const extra = Math.max(Number(params.extra ?? active?.extraPayment ?? 0) || 0, 0);

  if (!active) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Finance"
          title="Loans"
          description="No loans for this entity."
          secondaryActions={
            <AfBackLink href={`/shared-services/af/finance${qs}`} label="Finance" />
          }
        />
      </div>
    );
  }

  const comparison = compareExtraPayment(active, extra);
  const schedule = buildAmortization({ ...active, extraPayment: extra });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance"
        title="Loans"
        description="Amortization schedules + interactive extra-payment impact on interest and payoff."
        secondaryActions={
          <AfBackLink href={`/shared-services/af/finance${qs}`} label="Finance" />
        }
      />

      <div className="flex flex-wrap gap-2">
        {loans.map((l) => (
          <a
            key={l.id}
            href={`/shared-services/af/finance/loans?loan=${l.id}${
              entityId ? `&entity=${entityId}` : ''
            }${extra ? `&extra=${extra}` : ''}`}
            className={
              l.id === active.id
                ? 'rounded-md bg-[#3a414f] px-3 py-1.5 text-xs font-medium text-white'
                : 'rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground'
            }
          >
            {l.entityCode} · {l.name}
          </a>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border px-4 py-4">
          <p className="text-xs uppercase text-muted-foreground">Payment</p>
          <p className="font-heading text-2xl font-semibold text-[#3a414f]">
            <Money value={schedule.payment} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {(active.annualRate * 100).toFixed(2)}% · {active.termMonths} mo
          </p>
        </div>
        <div className="rounded-xl border border-border px-4 py-4">
          <p className="text-xs uppercase text-muted-foreground">Interest saved</p>
          <p className="font-heading text-2xl font-semibold text-[#3a414f]">
            <Money value={comparison.interestSaved} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            vs zero extra · {comparison.monthsSaved} periods sooner
          </p>
        </div>
        <div className="rounded-xl border border-border px-4 py-4">
          <p className="text-xs uppercase text-muted-foreground">Payoff</p>
          <p className="font-heading text-2xl font-semibold text-[#3a414f]">
            {schedule.payoffDate}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Total interest <Money value={schedule.totalInterest} />
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-border px-4 py-4">
        <input type="hidden" name="loan" value={active.id} />
        {entityId ? <input type="hidden" name="entity" value={entityId} /> : null}
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">
            Extra payment / period
          </span>
          <input
            name="extra"
            type="number"
            min={0}
            step={100}
            defaultValue={extra}
            className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-[#3a414f] px-4 py-2 text-sm font-medium text-white hover:bg-[#535c63]"
        >
          Recalculate
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Payment</th>
              <th className="px-4 py-3 text-right">Principal</th>
              <th className="px-4 py-3 text-right">Interest</th>
              <th className="px-4 py-3 text-right">Extra</th>
              <th className="px-4 py-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {schedule.schedule.slice(0, 24).map((r) => (
              <tr key={r.period} className="border-t border-border/70">
                <td className="px-4 py-2">{r.period}</td>
                <td className="px-4 py-2">{r.date}</td>
                <td className="px-4 py-2 text-right">
                  <Money value={r.payment} />
                </td>
                <td className="px-4 py-2 text-right">
                  <Money value={r.principal} />
                </td>
                <td className="px-4 py-2 text-right">
                  <Money value={r.interest} />
                </td>
                <td className="px-4 py-2 text-right">
                  <Money value={r.extra} />
                </td>
                <td className="px-4 py-2 text-right font-medium">
                  <Money value={r.balance} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {schedule.schedule.length > 24 ? (
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Showing first 24 of {schedule.schedule.length} periods.
          </p>
        ) : null}
      </div>
    </div>
  );
}
