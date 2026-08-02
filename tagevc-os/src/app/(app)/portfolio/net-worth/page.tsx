import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NetWorthClient } from '@/components/portfolio/net-worth-client';
import { writeAuditEvent } from '@/lib/audit/write';
import {
  computeNetWorthBreakdown,
  getFirmAumSnapshot,
  listInvestorAssets,
} from '@/lib/net-worth/assets';
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

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/entities"
            className="text-muted-foreground hover:text-foreground"
          >
            ← Businesses
          </Link>
          <Link
            href="/portfolio/investments"
            className="text-muted-foreground hover:text-foreground"
          >
            Investments
          </Link>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Net Worth
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Scope: <span className="font-medium text-foreground">Visionary assets</span>{' '}
          — personal + private holdings roll-up (Businesses, Real Estate,
          Investments). Separate from{' '}
          <span className="font-medium text-foreground">Firm AUM / portfolio</span>{' '}
          and from{' '}
          <span className="font-medium text-foreground">A&amp;F company finance</span>.
          Credit Management lives under Personal. Labels only (D12=A).
        </p>
      </header>

      <NetWorthClient breakdown={breakdown} firmAum={firmAum} error={error} />
    </div>
  );
}
