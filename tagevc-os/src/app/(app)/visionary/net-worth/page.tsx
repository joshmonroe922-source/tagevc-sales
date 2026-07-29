import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { Money } from '@/components/af/af-ui';
import { computeCombinedView, getNetWorthSnapshot } from '@/lib/af';
import { redirect } from 'next/navigation';
import { canAccessNetWorthPage } from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

export default async function VisionaryNetWorthPage() {
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
  const combined = computeCombinedView(snap.personal);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Visionary"
        title="Net worth panels"
        description="Company and Personal side-by-side. Combined uses Personal (incl. business ownership) — never double-count company cash."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/shared-services/af/finance/net-worth" className="rounded-2xl border border-border bg-gradient-to-br from-white to-[#eef2f7] px-5 py-5 hover:border-[#3a414f]/30">
          <p className="text-xs uppercase text-muted-foreground">Company consolidated</p>
          <p className="mt-2 font-heading text-3xl font-semibold text-[#3a414f]"><Money value={snap.consolidated.netWorth} /></p>
          <p className="mt-2 text-sm text-muted-foreground">Cash <Money value={snap.consolidated.cash} /></p>
        </Link>
        <Link href="/personal/finance/net-worth" className="rounded-2xl border border-border bg-gradient-to-br from-white to-[#fbf7f6] px-5 py-5 hover:border-[#3a414f]/30">
          <p className="text-xs uppercase text-[#9B1C1C]">Personal</p>
          <p className="mt-2 font-heading text-3xl font-semibold text-[#3a414f]"><Money value={snap.personal.netWorth} /></p>
          <p className="mt-2 text-sm text-muted-foreground">Incl. business ownership at book × %</p>
        </Link>
      </div>
      <div className="rounded-xl border border-border px-4 py-3 text-sm">
        <span className="font-medium">Combined: </span>
        <Money value={combined.netWorth} className="font-semibold" />
        <span className="text-muted-foreground"> — {combined.note}</span>
      </div>
    </div>
  );
}
