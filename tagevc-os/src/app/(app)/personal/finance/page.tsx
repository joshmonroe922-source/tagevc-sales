import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { AfModuleGrid, Money } from '@/components/af/af-ui';
import { PERSONAL_FINANCE_MODULES, getNetWorthSnapshot } from '@/lib/af';
import { redirect } from 'next/navigation';
import { canAccessNetWorthPage } from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

export default async function PersonalFinanceHomePage() {
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
  const nw = getNetWorthSnapshot().personal;
  const modules = PERSONAL_FINANCE_MODULES.filter((m) => m.id !== 'home');

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal · Private"
        title="Personal Finance"
        description="Isolated books_id=PERS — family classes, banks/cards, bills, and net worth. Not in company consolidation."
        context="Visionary only"
      />

      <div className="rounded-2xl border border-[#9B1C1C]/25 bg-gradient-to-br from-white via-[#fbf7f6] to-[#f3ecea] px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#9B1C1C]">Private</p>
            <p className="mt-2 font-heading text-4xl font-semibold text-[#3a414f]">
              <Money value={nw.netWorth} />
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Personal net worth · assets <Money value={nw.totalAssets} /> − liabilities <Money value={nw.totalLiabilities} />
            </p>
          </div>
          <Link
            href="/personal/finance/net-worth"
            className="inline-flex h-9 items-center rounded-md bg-[#3a414f] px-3 text-sm font-medium text-white hover:bg-[#2f3540]"
          >
            Full net worth →
          </Link>
        </div>
      </div>

      <AfModuleGrid modules={modules} />
    </div>
  );
}
