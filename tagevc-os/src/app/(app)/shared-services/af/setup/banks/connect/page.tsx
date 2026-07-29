import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { AF_BANKS } from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

export default async function BankConnectPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs } = await resolveAfEntityParam(searchParams);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Setup · Bank feeds"
        title="Connect bank & card feeds"
        description="1) Choose MD bank account  2) Connect provider (Plaid/MX/Unit)  3) Select last4  4) Map to bank_account_id  5) Test import."
        secondaryActions={<AfBackLink href={`/shared-services/af/setup${qs}`} label="Setup" />}
      />
      <ol className="space-y-3">
        {AF_BANKS.map((b, i) => (
          <li key={b.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium text-[#3a414f]">{i + 1}. {b.name} · {b.entityCode}</p>
              <p className="text-xs text-muted-foreground">{b.id} → GL {b.glAccount}</p>
            </div>
            <StatusPill status={b.feedEnabled ? 'Ready' : 'Watch'} />
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted-foreground">OAuth provider wiring ships with Spec - API Webhooks hardening. Checklist ENT-03 marks Done after test import.</p>
    </div>
  );
}
