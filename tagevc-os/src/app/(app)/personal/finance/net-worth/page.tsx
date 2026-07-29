import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money } from '@/components/af/af-ui';
import { computeCombinedView, getNetWorthSnapshot } from '@/lib/af';
import { redirect } from 'next/navigation';
import { canAccessNetWorthPage } from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

export default async function PersonalNetWorthPage() {
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
  const snap = getNetWorthSnapshot();
  const nw = snap.personal;
  const combined = computeCombinedView(nw);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal Finance · Net Worth"
        title="Personal net worth"
        description="Full asset stack − total liabilities (GL sum only). No card list or utilization on this page — manage cards under Personal Finance → Cards."
        secondaryActions={<AfBackLink href="/personal/finance" label="Personal Finance" />}
      />

      <div className="rounded-2xl border border-border bg-gradient-to-br from-[#f8f7f4] to-white px-6 py-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Net worth</p>
        <p className="mt-2 font-heading text-4xl font-semibold text-[#3a414f]"><Money value={nw.netWorth} /></p>
        <p className="mt-2 text-sm text-muted-foreground">
          Liabilities total <Money value={nw.totalLiabilities} /> (aggregate — no per-card UI)
        </p>
      </div>

      <div className="space-y-2">
        {nw.categories.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm">
            <span className="font-medium text-[#3a414f]">{c.label}</span>
            <Money value={c.amount} className="font-semibold" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
        Visionary combined view: <Money value={combined.netWorth} className="font-medium text-foreground" /> — {combined.note}
      </div>
    </div>
  );
}
