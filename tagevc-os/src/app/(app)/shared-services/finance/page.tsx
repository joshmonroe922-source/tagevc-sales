import { FinanceControlPlaneClient } from '@/components/shared-services/finance-control-plane-client';
import { getFinanceControlPlanePhase55Report } from '@/lib/shared-services/finance-control-plane-phase55-server';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { roleHasPermission } from '@/lib/types/roles';

type Props = {
  searchParams?: Promise<{ entity?: string }>;
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

  const report = await getFinanceControlPlanePhase55Report({ entityId });
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:shared_services')
    : false;

  return (
    <FinanceControlPlaneClient
      report={report}
      canWrite={canWrite}
      initialEntityId={entityId ?? ''}
    />
  );
}
