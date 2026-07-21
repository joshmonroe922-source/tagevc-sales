import Link from 'next/link';
import { ItAssetsClient } from '@/components/shared-services/it-assets-client';
import { Badge } from '@/components/ui/badge';
import {
  listAssignmentEvents,
  listHardwareAssets,
  listLifecycleEvents,
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

  const [hw, lic, ev, lifecycle, off, onb] = await Promise.all([
    listHardwareAssets(),
    listSoftwareLicenses(),
    listAssignmentEvents(),
    listLifecycleEvents(),
    listOffboardingRuns(),
    listOnboardingRuns(),
  ]);
  const candidateTickets = listOffboardingCandidateTickets();
  const onboardingTickets = listOnboardingCandidateTickets();

  const ctx = await getSessionContext();
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:it_assets')
    : false;

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
          <Badge variant="secondary">Phase 31</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hardware &amp; licensing
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Warranty CSV import, litigation-hold and soft-delete mailbox modes,
          tracked Intune retirement, renewals, and full asset lifecycle.
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
        canWrite={canWrite}
        tableError={tableError}
      />
    </div>
  );
}
