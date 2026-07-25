import Link from 'next/link';
import { redirect } from 'next/navigation';
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
import {
  canAccessNetWorthPage,
  canViewBusinessCredit,
  canViewPersonalCredit,
} from '@/lib/net-worth/visibility';
import { getSessionContext } from '@/lib/rbac/session';

export default async function CreditManagementPage({
  searchParams,
}: {
  searchParams?: Promise<{ entity?: string }>;
}) {
  const ctx = await getSessionContext();
  const sp = (await searchParams) ?? {};
  const entityFilter = sp.entity?.trim() || null;

  const canPersonal =
    !!ctx &&
    canViewPersonalCredit({
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    });
  const canBiz = !!ctx && canViewBusinessCredit(ctx.profile.role);

  if (!canPersonal && !canBiz) {
    redirect('/entities');
  }

  // Live Look: strip personal even if somehow reached
  const showPersonal =
    canPersonal &&
    !!ctx &&
    canAccessNetWorthPage({
      realRole: ctx.realRole,
      liveLookActive: ctx.liveLookActive,
    });

  const dual = showPersonal
    ? await loadDualPersonCreditBundle()
    : {
        subjects: [],
        byPerson: {} as Awaited<
          ReturnType<typeof loadDualPersonCreditBundle>
        >['byPerson'],
        alerts: [],
        error: undefined,
      };
  const grokMessages = showPersonal ? await listCreditGrokMessages(40) : [];

  const biz = canBiz
    ? await listBusinessCreditProfiles({
        entityId: entityFilter,
      })
    : { rows: [], error: undefined };
  const alerts = businessCreditAlerts(biz.rows);

  const bureaus = canBiz
    ? await listBusinessBureauCompanies()
    : { companies: [], error: undefined };
  const bureauAlerts = businessBureauStaleAlerts(bureaus.companies);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap gap-3 text-sm">
          {showPersonal ? (
            <Link
              href="/portfolio/net-worth"
              className="text-muted-foreground hover:text-foreground"
            >
              ← Net Worth
            </Link>
          ) : (
            <Link
              href="/shared-services/finance"
              className="text-muted-foreground hover:text-foreground"
            >
              ← Finance
            </Link>
          )}
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Credit Management
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Personal credit (Josh + Lauren) is Visionary-only with FICO 8 / FICO
          10 focus. Business credit is visible to Visionary and permitted
          finance/SSC roles — company names, no fake scores.
        </p>
      </header>

      {showPersonal ? (
        <DualPersonPersonalCreditClient
          byPerson={dual.byPerson}
          alerts={dual.alerts}
          grokMessages={grokMessages}
          loadError={dual.error}
        />
      ) : null}

      {canBiz ? (
        <BusinessBureauClient
          companies={bureaus.companies}
          alerts={bureauAlerts}
          loadError={bureaus.error}
        />
      ) : null}

      <CreditManagementClient
        showPersonal={false}
        personal={null}
        items={[]}
        actions={[]}
        coaching={[]}
        showBusiness={canBiz}
        businessProfiles={biz.rows}
        businessError={biz.error}
        alerts={alerts}
        entityFilter={entityFilter ?? ''}
      />
    </div>
  );
}
