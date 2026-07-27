import Link from 'next/link';
import { HrItHardeningPhase57Client } from '@/components/shared-services/hr-it-hardening-phase57-client';
import { HrOpsDepthClient } from '@/components/shared-services/hr-ops-depth-client';
import { SscFunctionHomeChromeServer } from '@/components/shared-services/ssc-function-home-chrome-server';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ViewModeLayout } from '@/components/ui/view-mode-toggle';
import { entityDisplayName } from '@/lib/entities/display-name';
import { listEmployees } from '@/lib/hris/employees';
import { listRuns } from '@/lib/hris/runs';
import { completionLabel, statusLabel } from '@/lib/hris/types';
import { getHrItHardeningPhase57Report } from '@/lib/shared-services/hr-it-hardening-phase57-server';
import { getHrOpsBundlePhase62 } from '@/lib/shared-services/hr-ops-phase62-server';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { roleHasPermission } from '@/lib/types/roles';
import { VIEW_MODE_DEFAULTS } from '@/lib/view-mode';

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

  // Parallel primary fetches — chrome loads independently via Suspense
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
    <div className="space-y-8">
      <SscFunctionHomeChromeServer
        functionKey="hr"
        entityId={entityId}
        firmWide={firmWide}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            HRIS snapshot
          </h2>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href="/shared-services/hr/employees"
              className="underline-offset-4 hover:underline"
            >
              Open directory →
            </Link>
            <Link
              href="/shared-services/hr/screening"
              className="underline-offset-4 hover:underline"
            >
              Screening →
            </Link>
          </div>
        </div>
        {hrisEmployees.error ? (
          <p className="text-sm text-muted-foreground">
            HRIS unavailable: {hrisEmployees.error}
          </p>
        ) : (
          <ViewModeLayout
            surface="hr-employees-snapshot"
            defaultMode={VIEW_MODE_DEFAULTS['hr-employees-snapshot']}
            cards={
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
            }
            list={
              <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
                {hrisEmployees.rows.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">
                    No HRIS employees yet — create one in the directory.
                  </p>
                ) : (
                  hrisEmployees.rows.map((e) => (
                    <Link
                      key={e.id}
                      href={`/shared-services/hr/employees/${e.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-[#3a414f]">
                          {e.full_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {entityDisplayName(e.entity_id)} ·{' '}
                          {e.role_title || '—'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1 text-xs">
                        <Badge variant="secondary">
                          {statusLabel(e.status)}
                        </Badge>
                        <Badge variant="outline">
                          Onboarding {completionLabel(e.onboarding_pct)}
                        </Badge>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            }
          />
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
