import Link from 'next/link';
import { HrItHardeningPhase57Client } from '@/components/shared-services/hr-it-hardening-phase57-client';
import { HrOpsDepthClient } from '@/components/shared-services/hr-ops-depth-client';
import { SscFunctionHomeStrip } from '@/components/shared-services/ssc-function-home-strip';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { entityDisplayName } from '@/lib/entities/display-name';
import { listEmployees } from '@/lib/hris/employees';
import { listRuns } from '@/lib/hris/runs';
import { completionLabel, statusLabel } from '@/lib/hris/types';
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

  const [report, ops, hrisEmployees, onboardingRuns] = await Promise.all([
    getHrItHardeningPhase57Report({ entityId }),
    getHrOpsBundlePhase62({ entityId }),
    listEmployees({ entityId, limit: 12 }),
    listRuns({ kind: 'onboarding', entityId, limit: 8 }),
  ]);
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:shared_services')
    : false;
  const openOnboarding = onboardingRuns.rows.filter((r) =>
    ['open', 'in_progress', 'blocked'].includes(r.status),
  );

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          HR operations
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          HRIS employee records, onboarding/offboarding process tracking,
          roster, and access readiness. Destructive access changes stay
          human-confirmed.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/shared-services/hr/employees"
            className="font-medium underline-offset-4 hover:underline"
          >
            Employees (HRIS)
          </Link>
          <Link
            href="/shared-services/hr/onboarding"
            className="underline-offset-4 hover:underline"
          >
            Onboarding queue
          </Link>
          <Link
            href="/shared-services/hr/offboarding"
            className="underline-offset-4 hover:underline"
          >
            Offboarding queue
          </Link>
        </div>
      </header>

      <SscFunctionHomeStrip functionKey="hr" entityId={entityId} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            HRIS snapshot
          </h2>
          <Link
            href="/shared-services/hr/employees"
            className="text-sm underline-offset-4 hover:underline"
          >
            Open directory →
          </Link>
        </div>
        {hrisEmployees.error ? (
          <p className="text-sm text-muted-foreground">
            HRIS unavailable: {hrisEmployees.error}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {hrisEmployees.rows.map((e) => (
              <Card key={e.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    <Link
                      href={`/shared-services/hr/employees/${e.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {e.full_name}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {entityDisplayName(e.entity_id)} · {e.role_title || '—'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1 text-xs">
                  <Badge variant="secondary">{statusLabel(e.status)}</Badge>
                  <Badge variant="outline">
                    Onboarding {completionLabel(e.onboarding_pct)}
                  </Badge>
                </CardContent>
              </Card>
            ))}
            {hrisEmployees.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                No HRIS employees yet — create one in the directory.
              </p>
            ) : null}
          </div>
        )}
        {openOnboarding.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {openOnboarding.length} open onboarding run
            {openOnboarding.length === 1 ? '' : 's'} in queue.
          </p>
        ) : null}
      </section>

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
