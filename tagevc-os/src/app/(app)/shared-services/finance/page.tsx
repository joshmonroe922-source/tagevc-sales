import Link from 'next/link';
import { FinanceControlPlaneClient } from '@/components/shared-services/finance-control-plane-client';
import { IesFinancePanel } from '@/components/shared-services/ies-finance-panel';
import { SscFunctionHomeStrip } from '@/components/shared-services/ssc-function-home-strip';
import { getIesFinanceReport } from '@/lib/ies/report';
import { canViewBusinessCredit } from '@/lib/net-worth/visibility';
import { getFinanceControlPlanePhase55Report } from '@/lib/shared-services/finance-control-plane-phase55-server';
import { listPortfolioFinanceBridgePhase62 } from '@/lib/shared-services/finance-ops-phase62-server';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { roleHasPermission } from '@/lib/types/roles';

type Props = {
  searchParams?: Promise<{ entity?: string; ies?: string; reason?: string }>;
};

export default async function FinanceControlPlanePage({ searchParams }: Props) {
  await requirePermission('read:shared_services');

  const params = (await searchParams) ?? {};
  const entityParam = params.entity?.trim() ?? '';
  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;
  const entityId = firmWide
    ? entityParam || null
    : (ctx?.profile.entity_id ?? (entityParam || null));

  const [report, portfolioBridge, iesReport] = await Promise.all([
    getFinanceControlPlanePhase55Report({ entityId }),
    listPortfolioFinanceBridgePhase62({ entityId }),
    getIesFinanceReport({ entityId }),
  ]);
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:shared_services')
    : false;
  const showBizCredit = ctx ? canViewBusinessCredit(ctx.profile.role) : false;

  const iesBanner =
    params.ies === 'connected'
      ? 'IES company connected. Map realm if needed, then Pull latest.'
      : params.ies === 'error'
        ? `IES connect failed${params.reason ? `: ${params.reason}` : ''}.`
        : null;

  return (
    <div className="space-y-6">
      <SscFunctionHomeStrip functionKey="finance" entityId={entityId} />
      {showBizCredit ? (
        <p className="text-sm text-muted-foreground">
          Business credit monitoring ·{' '}
          <Link
            href="/portfolio/net-worth/credit"
            className="font-medium underline-offset-4 hover:underline"
          >
            Credit Management
          </Link>
        </p>
      ) : null}
      {iesBanner ? (
        <p className="rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          {iesBanner}
        </p>
      ) : null}
      <IesFinancePanel
        report={iesReport}
        canWrite={canWrite}
        entityId={entityId ?? ''}
      />
      <FinanceControlPlaneClient
        report={report}
        canWrite={canWrite}
        initialEntityId={entityId ?? ''}
        portfolioBridge={portfolioBridge}
      />
    </div>
  );
}
