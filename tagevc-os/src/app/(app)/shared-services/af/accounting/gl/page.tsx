import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money } from '@/components/af/af-ui';
import { AF_ENTITIES, getAfStore, getCoa, getEntityTb } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';
import type { EntityCode } from '@/lib/af';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function GlPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { entityId, qs } = await resolveAfEntityParam(searchParams);
  const code = (entityId as EntityCode) || 'TVC';
  const tb = getEntityTb(code);
  const coa = getCoa(code);
  const journals = getAfStore().journals.filter((j) => j.entityCode === code).slice(-12);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · GL"
        title="General Ledger"
        context={AF_ENTITIES.find((e) => e.code === code)?.legalName ?? code}
        description="Multi-entity GL with automated JE templates. Common account numbers identical across entities."
        secondaryActions={<AfBackLink href={`/shared-services/af/accounting${qs}`} label="Accounting" />}
      />

      <div className="flex flex-wrap gap-2">
        {AF_ENTITIES.map((e) => (
          <a key={e.code} href={`/shared-services/af/accounting/gl?entity=${e.code}`}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${code === e.code ? 'bg-[#3a414f] text-white' : 'bg-muted text-muted-foreground'}`}>
            {e.legalName}
          </a>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="border-b border-border bg-muted/30 px-4 py-2 text-sm font-medium">Trial balance (JE activity)</div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">Acct</th><th className="px-4 py-2 text-right">Debit</th><th className="px-4 py-2 text-right">Credit</th></tr>
            </thead>
            <tbody>
              {Object.entries(tb).sort().map(([acct, row]) => (
                <tr key={acct} className="border-t border-border/60">
                  <td className="px-4 py-2 tabular-nums">{acct}</td>
                  <td className="px-4 py-2 text-right"><Money value={row.debit} /></td>
                  <td className="px-4 py-2 text-right"><Money value={row.credit} /></td>
                </tr>
              ))}
              {Object.keys(tb).length === 0 && (
                <tr><td className="px-4 py-3 text-muted-foreground" colSpan={3}>No journals yet for this entity</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="border-b border-border bg-muted/30 px-4 py-2 text-sm font-medium">Recent journals</div>
          <ul className="divide-y divide-border/60 text-sm">
            {journals.map((j) => (
              <li key={j.id} className="px-4 py-3">
                <p className="font-medium text-[#3a414f]">{j.memo}</p>
                <p className="text-xs text-muted-foreground">{j.date} · {j.sourceModule} · {j.lines.length} lines</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <details className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer font-heading font-semibold text-[#3a414f]">Chart of Accounts ({coa.length})</summary>
        <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
          {coa.map((a) => (
            <li key={a.number} className="flex gap-2 border-b border-border/40 py-1">
              <span className="w-12 tabular-nums text-muted-foreground">{a.number}</span>
              <span>{a.name}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
