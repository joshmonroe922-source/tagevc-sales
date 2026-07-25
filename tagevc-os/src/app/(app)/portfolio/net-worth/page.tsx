import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NetWorthClient } from '@/components/portfolio/net-worth-client';
import { writeAuditEvent } from '@/lib/audit/write';
import {
  computeNetWorthBreakdown,
  listInvestorAssets,
} from '@/lib/net-worth/assets';
import { probeNetWorthConnectors } from '@/lib/net-worth/connectors';
import { getFirmAumSnapshot } from '@/lib/net-worth/assets';
import { canAccessNetWorthPage } from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

export default async function NetWorthPage() {
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

  await writeAuditEvent({
    action: 'net_worth_access',
    title: 'Net Worth page viewed',
    object_type: 'net_worth',
    object_id: 'dashboard',
  });

  const [{ rows, error }, firmAum] = await Promise.all([
    listInvestorAssets({ scope: 'all' }),
    getFirmAumSnapshot(),
  ]);
  const breakdown = computeNetWorthBreakdown(rows);
  const connectors = probeNetWorthConnectors();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/entities"
            className="text-muted-foreground hover:text-foreground"
          >
            ← Portfolio companies
          </Link>
          <Link
            href="/portfolio/net-worth/credit"
            className="font-medium underline-offset-4 hover:underline"
          >
            Credit Management →
          </Link>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Net Worth
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Visionary capital picture across private I-quadrant investments,
          crypto, retirement, business portfolio, and real estate. Private
          balances stay Visionary-only.
        </p>
      </header>

      <NetWorthClient
        assets={rows}
        breakdown={breakdown}
        firmAum={firmAum}
        connectors={connectors}
        error={error}
      />
    </div>
  );
}
