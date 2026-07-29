import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink } from '@/components/af/af-ui';
import { redirect } from 'next/navigation';
import { canAccessNetWorthPage } from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

export default async function Page() {
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
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal Finance"
        title="Income invoices"
        description="Personal AR-lite: create, email PDF, mark paid to personal Operating."
        secondaryActions={<AfBackLink href="/personal/finance" label="Personal Finance" />}
      />
      <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
        Ready for transactional depth — kernel shared with company AP/AR engines.
      </div>
    </div>
  );
}
