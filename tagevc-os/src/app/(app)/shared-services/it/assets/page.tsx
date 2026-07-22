import Link from 'next/link';
import { ItAssetsClient } from '@/components/shared-services/it-assets-client';
import { Badge } from '@/components/ui/badge';
import {
  listAssignmentEvents,
  listHardwareAssets,
  listLifecycleEvents,
  listIntuneActions,
  listIntuneActionEvents,
  listIntuneAmbiguityResolutions,
  listIntuneBreakerHealth,
  listIntuneBreakerResetProposals,
  listIntuneTuningProposals,
  getIntunePhase40Health,
  getIntunePhase41Health,
  getIntunePhase42Health,
  getIntunePhase43Health,
  getIntunePhase44Health,
  getIntunePhase45Health,
  getIntunePhase46Health,
  getIntunePhase47Health,
  listIntuneOutagePostmortems,
  listIntuneThresholdRecommendations,
  listIntuneSoakCycleTimeline,
  listIntuneResilienceCorrelationTimeline,
  listIntunePostmortemQualityStatus,
  listIntunePostmortemQualityScorecards,
  listIntunePromoteWaiveStatus,
  listIntunePromoteWaiveExpiryStatus,
  listIntuneScorecardMttrCorrelations,
  listIntuneTuningPromoteGateStatus,
  listIntuneDispatchAttempts,
  listIntuneManualReviewSlo,
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

  const [
    hw,
    lic,
    ev,
    lifecycle,
    off,
    onb,
    intune,
    intuneEvents,
    dispatchAttempts,
    workerRuns,
    ambiguity,
    manualReviewSlo,
    breakerHealth,
    breakerResetProposals,
    tuningProposals,
    phase40Health,
    phase41Health,
    phase42Health,
    phase43Health,
    phase44Health,
    phase45Health,
    phase46Health,
    phase47Health,
    outagePostmortems,
    thresholdRecommendations,
    soakCycleTimeline,
    resilienceCorrelation,
    postmortemQuality,
    postmortemScorecards,
    promoteWaives,
    promoteWaiveExpiries,
    scorecardMttrCorrelations,
    promoteGates,
  ] = await Promise.all([
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
    listIntuneAmbiguityResolutions(),
    listIntuneManualReviewSlo(),
    listIntuneBreakerHealth(),
    listIntuneBreakerResetProposals(),
    listIntuneTuningProposals(),
    getIntunePhase40Health(),
    getIntunePhase41Health(),
    getIntunePhase42Health(),
    getIntunePhase43Health(),
    getIntunePhase44Health(),
    getIntunePhase45Health(),
    getIntunePhase46Health(),
    getIntunePhase47Health(),
    listIntuneOutagePostmortems(),
    listIntuneThresholdRecommendations(),
    listIntuneSoakCycleTimeline(),
    listIntuneResilienceCorrelationTimeline(),
    listIntunePostmortemQualityStatus(),
    listIntunePostmortemQualityScorecards(),
    listIntunePromoteWaiveStatus(),
    listIntunePromoteWaiveExpiryStatus(),
    listIntuneScorecardMttrCorrelations(),
    listIntuneTuningPromoteGateStatus(),
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
  const canIntuneManualReview = ctx
    ? roleHasPermission(ctx.profile.role, 'action:intune_manual_review')
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
          <Badge variant="secondary">Phase 43</Badge>
          <Badge variant="secondary">Phase 44</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hardware &amp; licensing
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Phase 43 soak cycle evidence plus Phase 44 breaker performance trends,
          canary/outage ops alerts, and correlation across outages, tuning, and
          recovery. Observe-only — never closes or resets open breakers.
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
        intuneAmbiguityResolutions={ambiguity.rows.filter((resolution) =>
          visibleActionIds.has(String(resolution.action_id)),
        )}
        intuneManualReviewSlo={manualReviewSlo.filter((row) =>
          visibleActionIds.has(String(row.action_id)),
        )}
        intuneBreakerHealth={breakerHealth.rows.filter(
          (breaker) =>
            firmWide || breaker.entity_id === ctx?.profile.entity_id,
        )}
        intuneBreakerResetProposals={breakerResetProposals.rows.filter(
          (proposal) =>
            firmWide || proposal.entity_id === ctx?.profile.entity_id,
        )}
        intuneTuningProposals={tuningProposals.rows.filter(
          (proposal) =>
            firmWide || proposal.entity_id === ctx?.profile.entity_id,
        )}
        intunePhase40Health={firmWide ? phase40Health.row : null}
        intunePhase41Health={firmWide ? phase41Health.row : null}
        intunePhase42Health={firmWide ? phase42Health.row : null}
        intunePhase43Health={firmWide ? phase43Health.row : null}
        intunePhase44Health={firmWide ? phase44Health.row : null}
        intunePhase45Health={firmWide ? phase45Health.row : null}
        intunePhase46Health={firmWide ? phase46Health.row : null}
        intunePhase47Health={firmWide ? phase47Health.row : null}
        intuneOutagePostmortems={firmWide ? outagePostmortems.rows : []}
        intuneThresholdRecommendations={thresholdRecommendations.rows.filter(
          (recommendation) =>
            firmWide || recommendation.entity_id === ctx?.profile.entity_id,
        )}
        intuneSoakCycleTimeline={soakCycleTimeline.rows.filter(
          (cycle) => firmWide || cycle.entity_id === ctx?.profile.entity_id,
        )}
        intuneResilienceCorrelation={firmWide ? resilienceCorrelation.rows : []}
        intunePostmortemQuality={firmWide ? postmortemQuality.rows : []}
        intunePostmortemScorecards={firmWide ? postmortemScorecards.rows : []}
        intunePromoteWaives={firmWide ? promoteWaives.rows : []}
        intunePromoteWaiveExpiries={firmWide ? promoteWaiveExpiries.rows : []}
        intuneScorecardMttrCorrelations={
          firmWide ? scorecardMttrCorrelations.rows : []
        }
        intunePromoteGates={firmWide ? promoteGates.rows : []}
        canWrite={canWrite}
        canIntuneRetire={canIntuneRetire}
        canIntuneManualReview={canIntuneManualReview}
        currentActorId={ctx?.profile.id ?? null}
        tableError={
          tableError ||
          intune.error ||
          ambiguity.error ||
          breakerHealth.error ||
          breakerResetProposals.error ||
          tuningProposals.error ||
          phase40Health.error ||
          phase41Health.error ||
          phase42Health.error ||
          phase43Health.error ||
          phase44Health.error ||
          phase45Health.error ||
          phase46Health.error ||
          phase47Health.error ||
          outagePostmortems.error ||
          thresholdRecommendations.error ||
          soakCycleTimeline.error ||
          resilienceCorrelation.error ||
          postmortemQuality.error ||
          postmortemScorecards.error ||
          promoteWaives.error ||
          promoteWaiveExpiries.error ||
          scorecardMttrCorrelations.error ||
          promoteGates.error
        }
      />
    </div>
  );
}
