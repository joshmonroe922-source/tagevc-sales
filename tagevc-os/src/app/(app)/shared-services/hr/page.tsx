import { HrItHardeningPhase57Client } from '@/components/shared-services/hr-it-hardening-phase57-client';
import { HrOpsDepthClient } from '@/components/shared-services/hr-ops-depth-client';
import { SscFunctionHomeStrip } from '@/components/shared-services/ssc-function-home-strip';
import { getHrItHardeningPhase57Report } from '@/lib/shared-services/hr-it-hardening-phase57-server';
import { getHrOpsBundlePhase62 } from '@/lib/shared-services/hr-ops-phase62-server';
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

  const [report, ops] = await Promise.all([
    getHrItHardeningPhase57Report({ entityId }),
    getHrOpsBundlePhase62({ entityId }),
  ]);
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:shared_services')
    : false;

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          HR operations
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          People roster, joiner/mover/leaver checklists, access readiness, and
          service requests. High-risk access changes stay dual-approved — never
          silently revoked.
        </p>
      </header>

      <SscFunctionHomeStrip functionKey="hr" entityId={entityId} />

      <HrOpsDepthClient
        roster={ops.roster}
        rosterError={ops.rosterError}
        onboardingRuns={ops.onboardingRuns}
        offboardingRuns={ops.offboardingRuns}
        onboardingCandidateCount={ops.onboardingCandidates.length}
        offboardingCandidateCount={ops.offboardingCandidates.length}
        entityId={entityId}
      />

      <HrItHardeningPhase57Client
        report={report}
        canWrite={canWrite}
        initialEntityId={entityId ?? ''}
        surface="hr"
        showPageHeader={false}
      />
    </div>
  );
}
