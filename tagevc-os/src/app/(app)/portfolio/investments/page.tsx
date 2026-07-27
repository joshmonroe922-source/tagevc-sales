import Link from 'next/link';
import { redirect } from 'next/navigation';
import { InvestmentsClient } from '@/components/portfolio/investments-client';
import { writeAuditEvent } from '@/lib/audit/write';
import {
  computeNetWorthBreakdown,
  listInvestorAssets,
} from '@/lib/net-worth/assets';
import { probeNetWorthConnectors } from '@/lib/net-worth/connectors';
import { canAccessInvestmentsPage } from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

export default async function InvestmentsPage() {
  const ctx = await getSessionContext();
  if (
    !ctx ||
    !canAccessInvestmentsPage({
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    })
  ) {
    redirect('/entities');
  }

  await writeAuditEvent({
    action: 'net_worth_access',
    title: 'Investments page viewed',
    object_type: 'investments',
    object_id: 'dashboard',
  });

  const { rows, error } = await listInvestorAssets({ scope: 'all' });
  const breakdown = computeNetWorthBreakdown(rows);
  const connectors = probeNetWorthConnectors();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/portfolio/net-worth"
            className="text-muted-foreground hover:text-foreground"
          >
            ← Net Worth roll-up
          </Link>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Investments
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Visionary-only private holdings — retirement, stocks/funds, crypto, and
          brokerage. Business and real estate stay on their Assets lists; Net Worth
          rolls everything up.
        </p>
      </header>

      <InvestmentsClient
        assets={rows}
        breakdown={breakdown}
        connectors={connectors}
        error={error}
      />
    </div>
  );
}
