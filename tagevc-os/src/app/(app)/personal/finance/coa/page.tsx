import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink } from '@/components/af/af-ui';
import { getCoa } from '@/lib/af';
import { redirect } from 'next/navigation';
import { canAccessNetWorthPage } from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

export default async function PersonalCoaPage() {
  const ctx = await getSessionContext();
  if (
    !ctx ||
    !canAccessNetWorthPage({
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    })
  ) {
    redirect('/entities');
  }
  const coa = getCoa('PERS');
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal Finance"
        title="Chart of Accounts"
        description="CoA — Personal (books_id=PERS)."
        secondaryActions={<AfBackLink href="/personal/finance" label="Personal Finance" />}
      />
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {coa.map((a) => (
          <li key={a.number} className="flex gap-2 border-b border-border/40 py-1.5">
            <span className="w-12 tabular-nums text-muted-foreground">{a.number}</span>
            <span>{a.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
