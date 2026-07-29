import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

const TASKS = [
  'Bank/card rec complete',
  'AR/AP age reviewed',
  'IC balances agree parent↔sub',
  'Revenue cut-off',
  'Deferred rev rollforward',
  'Accruals',
  'Commissions true-up',
  'Loans schedule',
  'Eliminations draft',
  'TB balance',
  'Snapshot + lock period',
];

export default async function ClosePage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs } = await resolveAfEntityParam(searchParams);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accounting · Close"
        title="Continuous close"
        description="Soft close warns; hard lock blocks posting. Reopen requires Controls role + audit log."
        secondaryActions={<AfBackLink href={`/shared-services/af/accounting${qs}`} label="Accounting" />}
      />
      <ul className="space-y-2">
        {TASKS.map((t, i) => (
          <li key={t} className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm">
            <span><span className="mr-2 text-muted-foreground">{i + 1}.</span>{t}</span>
            <StatusPill status={i < 3 ? 'Done' : 'Not started'} />
          </li>
        ))}
      </ul>
    </div>
  );
}
