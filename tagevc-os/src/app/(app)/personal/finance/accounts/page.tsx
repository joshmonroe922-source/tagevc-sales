import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { AF_PERSONAL_BANKS } from '@/lib/af';
import { redirect } from 'next/navigation';
import { canAccessNetWorthPage } from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

export default async function PersonalAccountsPage() {
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
        title="Accounts"
        description="Banks, savings, brokerage — feeds managed here (not on Net Worth)."
        secondaryActions={<AfBackLink href="/personal/finance" label="Personal Finance" />}
      />
      <ul className="space-y-2">
        {AF_PERSONAL_BANKS.map((b) => (
          <li key={b.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
            <div>
              <p className="font-medium text-[#3a414f]">{b.name || b.id}</p>
              <p className="text-xs text-muted-foreground">{b.type} · GL {b.glAccount} · {b.familyClass}</p>
            </div>
            <StatusPill status={b.feedEnabled ? 'Feed on' : 'Manual'} />
          </li>
        ))}
        {AF_PERSONAL_BANKS.length === 0 && (
          <li className="text-sm text-muted-foreground">No personal banks seeded — complete Personal Setup.</li>
        )}
      </ul>
    </div>
  );
}
