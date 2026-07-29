import Link from 'next/link';
import { BusinessBureauClient } from '@/components/portfolio/business-bureau-client';
import { CreditManagementClient } from '@/components/portfolio/credit-management-client';
import { DualPersonPersonalCreditClient } from '@/components/portfolio/dual-person-personal-credit-client';
import {
  businessBureauStaleAlerts,
  listBusinessBureauCompanies,
} from '@/lib/net-worth/business-credit-bureaus';
import {
  businessCreditAlerts,
  listBusinessCreditProfiles,
} from '@/lib/net-worth/credit';
import { listCreditGrokMessages } from '@/lib/net-worth/credit-grok';
import { loadDualPersonCreditBundle } from '@/lib/net-worth/personal-credit';
import { requirePersonalVisionary } from '@/lib/personal/access';

export default async function CreditManagementPage({
  searchParams,
}: {
  searchParams?: Promise<{ entity?: string }>;
}) {
  await requirePersonalVisionary();
  const sp = (await searchParams) ?? {};
  const entityFilter = sp.entity?.trim() || null;

  const dual = await loadDualPersonCreditBundle();
  const grokMessages = await listCreditGrokMessages(40);
  const biz = await listBusinessCreditProfiles({
    entityId: entityFilter,
  });
  const alerts = businessCreditAlerts(biz.rows);
  const bureaus = await listBusinessBureauCompanies();
  const bureauAlerts = businessBureauStaleAlerts(bureaus.companies);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/personal/finance"
            className="text-muted-foreground hover:text-foreground"
          >
            ← Personal Finance
          </Link>
          <Link
            href="/portfolio/net-worth"
            className="text-muted-foreground hover:text-foreground"
          >
            Company Net Worth
          </Link>
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Credit Management
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Visionary-only (Josh). Personal credit (Josh + Lauren) with FICO 8 /
          FICO 10 focus, plus business bureau tracking.
        </p>
      </header>

      <DualPersonPersonalCreditClient
        byPerson={dual.byPerson}
        alerts={dual.alerts}
        grokMessages={grokMessages}
        loadError={dual.error}
      />

      <BusinessBureauClient
        companies={bureaus.companies}
        alerts={bureauAlerts}
        loadError={bureaus.error}
      />

      <CreditManagementClient
        showPersonal={false}
        personal={null}
        items={[]}
        actions={[]}
        coaching={[]}
        showBusiness
        businessProfiles={biz.rows}
        businessError={biz.error}
        alerts={alerts}
        entityFilter={entityFilter ?? ''}
      />
    </div>
  );
}
