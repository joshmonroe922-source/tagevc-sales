import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, StatusPill } from '@/components/af/af-ui';
import { redirect } from 'next/navigation';
import { canAccessNetWorthPage } from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

const STEPS = [
  'Enable Personal Finance (books PERS)',
  'Load MD — Personal Family members',
  'Load CoA — Personal',
  'Add banks/cards + feeds',
  'Enter opening balances',
  'Set budgets',
  'Test bill + income invoice',
  'Mark Personal Go Live',
];

export default async function PersonalSetupPage() {
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
        title="Personal go-live"
        description="Independent of company entity go-live. One-click provision via Personal Financials Hub pattern."
        secondaryActions={<AfBackLink href="/personal/finance" label="Personal Finance" />}
      />
      <ul className="space-y-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm">
            <span>{i + 1}. {s}</span>
            <StatusPill status={i < 3 ? 'Done' : 'Not started'} />
          </li>
        ))}
      </ul>
    </div>
  );
}
