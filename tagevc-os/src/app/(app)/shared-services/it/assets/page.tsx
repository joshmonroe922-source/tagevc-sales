import Link from 'next/link';
import { ItAssetsClient } from '@/components/shared-services/it-assets-client';
import { Badge } from '@/components/ui/badge';
import {
  listAssignmentEvents,
  listHardwareAssets,
  listLifecycleEvents,
  listIntuneActions,
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

export default async function ItAssetsModulePage() {
  await requirePermission('read:it_assets');

  const [hw, lic, ev, lifecycle, off, onb, intune] = await Promise.all([
    listHardwareAssets(),
    listSoftwareLicenses(),
    listAssignmentEvents(),
    listLifecycleEvents(),
    listOffboardingRuns(),
    listOnboardingRuns(),
    listIntuneActions(),
  ]);
  const candidateTickets = listOffboardingCandidateTickets();
  const onboardingTickets = listOnboardingCandidateTickets();

  const ctx = await getSessionContext();
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:it_assets')
    : false;
  if (ctx?.profile.entity_id) {
    intune.rows = intune.rows.filter(
      (action) => action.entity_id === ctx.profile.entity_id,
    );
  }

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
          <Badge variant="secondary">Phase 34</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hardware &amp; licensing
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Atomic warranty preview/commit, structured per-device Intune
          submission and verification evidence, renewals, and asset lifecycle.
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
        canWrite={canWrite}
        tableError={tableError || intune.error}
      />
    </div>
  );
}
