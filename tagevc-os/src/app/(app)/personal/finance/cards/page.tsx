import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money } from '@/components/af/af-ui';
import { getAfStore } from '@/lib/af';
import { redirect } from 'next/navigation';
import { canAccessNetWorthPage } from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

export default async function PersonalCardsPage() {
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
  const bal = getAfStore().personalBalances['2000'] ?? 0;
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal Finance"
        title="Credit cards"
        description="Card balances, feeds, pay, and utilization live here — not under a separate Credit Management menu, and not on Net Worth."
        secondaryActions={<AfBackLink href="/personal/finance" label="Personal Finance" />}
      />
      <div className="rounded-xl border border-border px-5 py-4">
        <p className="text-xs uppercase text-muted-foreground">Card liability (GL 2000)</p>
        <p className="font-heading text-3xl font-semibold text-[#3a414f]"><Money value={bal} /></p>
        <p className="mt-2 text-sm text-muted-foreground">NW page uses this only as part of total liabilities — no card UI there.</p>
      </div>
    </div>
  );
}
