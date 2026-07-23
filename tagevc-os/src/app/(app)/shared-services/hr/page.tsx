import { HrItHardeningPhase57Client } from '@/components/shared-services/hr-it-hardening-phase57-client';
import { getHrItHardeningPhase57Report } from '@/lib/shared-services/hr-it-hardening-phase57-server';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { roleHasPermission } from '@/lib/types/roles';

type Props = {
  searchParams?: Promise<{ entity?: string }>;
};

export default async function HrOperationsPage({ searchParams }: Props) {
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

  const report = await getHrItHardeningPhase57Report({ entityId });
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:shared_services')
    : false;

  return (
    <HrItHardeningPhase57Client
      report={report}
      canWrite={canWrite}
      initialEntityId={entityId ?? ''}
      surface="hr"
    />
  );
}
