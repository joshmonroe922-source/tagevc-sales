import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import {
  AF_PERSONAL_BANKS,
  listPersonalBankConnections,
} from '@/lib/af';
import { requirePersonalVisionary } from '@/lib/personal/access';

export default async function PersonalAccountsPage() {
  await requirePersonalVisionary();
  const connections = await listPersonalBankConnections();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal Finance"
        title="Accounts"
        description="Banks, savings, brokerage — feeds managed here (not on Net Worth)."
        secondaryActions={
          <AfBackLink href="/personal/finance" label="Personal Finance" />
        }
        primaryAction={
          <Link
            href="/personal/finance/accounts/connect"
            className="inline-flex h-9 items-center rounded-md bg-[#3a414f] px-3 text-sm font-medium text-white hover:bg-[#2f3540]"
          >
            Connect bank
          </Link>
        }
      />
      <ul className="space-y-2">
        {AF_PERSONAL_BANKS.map((b) => {
          const c = connections.find((x) => x.bankAccountId === b.id);
          return (
            <li
              key={b.id}
              className="flex items-center justify-between rounded-xl border border-border px-4 py-3"
            >
              <div>
                <p className="font-medium text-[#3a414f]">{b.name || b.id}</p>
                <p className="text-xs text-muted-foreground">
                  {b.type} · GL {b.glAccount} · {b.familyClass}
                  {c?.accountMask ? ` · ••••${c.accountMask}` : ''}
                  {c?.institutionName ? ` · ${c.institutionName}` : ''}
                </p>
              </div>
              <StatusPill
                status={
                  c?.status === 'connected'
                    ? 'connected'
                    : b.feedEnabled
                      ? c?.status ?? 'not_connected'
                      : 'Manual'
                }
              />
            </li>
          );
        })}
        {AF_PERSONAL_BANKS.length === 0 && (
          <li className="text-sm text-muted-foreground">
            No personal banks seeded — complete Personal Setup.
          </li>
        )}
      </ul>
    </div>
  );
}
