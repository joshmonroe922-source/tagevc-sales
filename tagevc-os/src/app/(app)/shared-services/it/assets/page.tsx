import Link from 'next/link';
import { ItAssetsClient } from '@/components/shared-services/it-assets-client';
import { Badge } from '@/components/ui/badge';
import {
  listAssignmentEvents,
  listHardwareAssets,
  listLifecycleEvents,
  listIntuneActions,
  listIntuneActionEvents,
  listIntuneDispatchAttempts,
  listIntuneWorkerRuns,
  listSoftwareLicenses,
} from '@/lib/shared-services/it-assets-repo';
import {
  listOffboardingCandidateTickets,
  listOffboardingRuns,
} from '@/lib/shared-services/it-offboarding';
import {
  listOnboardingCandidateTickets,
  listOnboardingRuns,
} from '@/lib/shared-services/it-onboarding';
import { roleHasPermission } from '@/lib/types/roles';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';

export default async function ItAssetsModulePage() {
  await requirePermission('read:it_assets');

  const [hw, lic, ev, lifecycle, off, onb, intune, intuneEvents, dispatchAttempts, workerRuns] =
    await Promise.all([
    listHardwareAssets(),
    listSoftwareLicenses(),
    listAssignmentEvents(),
    listLifecycleEvents(),
    listOffboardingRuns(),
    listOnboardingRuns(),
    listIntuneActions(),
    listIntuneActionEvents(),
    listIntuneDispatchAttempts(),
    listIntuneWorkerRuns(),
  ]);
  const candidateTickets = listOffboardingCandidateTickets();
  const onboardingTickets = listOnboardingCandidateTickets();

  const ctx = await getSessionContext();
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:it_assets')
    : false;
  const canIntuneRetire = ctx
    ? roleHasPermission(ctx.profile.role, 'action:intune_retire')
    : false;
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;
  if (!firmWide && ctx?.profile.entity_id) {
    intune.rows = intune.rows.filter(
      (action) => action.entity_id === ctx.profile.entity_id,
    );
  }
  const visibleActionIds = new Set(
    intune.rows.map((action) => action.action_id),
  );
  const visibleIntuneEvents = intuneEvents.filter((event) =>
    visibleActionIds.has(String(event.action_id)),
  );

  const tableError =
    hw.error || lic.error || ev.error || lifecycle.error || off.error || onb.error;

  return (
    <div className="space-y-6">
      <Link
        href="/shared-services"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Shared Services
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">IT</Badge>
          <Badge variant="secondary">Phase 37</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hardware &amp; licensing
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Atomic warranty preview/commit, final pre-dispatch authorization,
          verification-only recovery, worker timelines, and asset lifecycle.
        </p>
      </div>

      <ItAssetsClient
        hardware={hw.rows}
        licenses={lic.rows}
        events={ev.rows}
        lifecycleEvents={lifecycle.rows}
        offboarding={off.rows}
        onboarding={onb.rows}
        candidateTickets={candidateTickets}
        onboardingTickets={onboardingTickets}
        intuneActions={intune.rows}
        intuneEvents={visibleIntuneEvents}
        intuneDispatchAttempts={dispatchAttempts.filter((attempt) =>
          visibleActionIds.has(String(attempt.action_id)),
        )}
        intuneWorkerRuns={firmWide ? workerRuns : []}
        canWrite={canWrite}
        canIntuneRetire={canIntuneRetire}
        tableError={tableError || intune.error}
      />
    </div>
  );
}
