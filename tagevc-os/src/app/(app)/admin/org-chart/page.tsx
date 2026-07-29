import { Suspense } from 'react';
import { OrgChartClient } from '@/components/org/org-chart-client';
import { CONSOLIDATED_SELECT_VALUE } from '@/lib/entities/display-order';
import { loadOrgChartForViewer } from '@/lib/org/repo';
import { getSessionContext } from '@/lib/rbac/session';

const SCOPE_OPTIONS = [
  { value: 'all', label: 'Consolidated' },
  { value: 'ENT-FIRM', label: 'Tage VC' },
  { value: 'ENT-R619', label: 'Recruit 619' },
  { value: 'ENT-SIGNENT', label: 'Signent HR' },
  { value: 'ENT-INDA', label: 'Instant NDA' },
];

export default async function OrgChartPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; zoom?: string }>;
}) {
  const session = await getSessionContext();
  if (!session) return null;

  const params = await searchParams;
  const chart = await loadOrgChartForViewer({
    viewer: {
      id: session.profile.id,
      role: session.profile.role,
      entity_id: session.profile.entity_id,
    },
    scope: params.entity ?? CONSOLIDATED_SELECT_VALUE,
    zoomRootId: params.zoom ?? null,
  });

  return (
    <Suspense fallback={null}>
      <OrgChartClient
        forest={chart.forest}
        canEdit={chart.canEdit}
        isConsolidated={chart.isConsolidated}
        scope={chart.scope}
        scopeOptions={SCOPE_OPTIONS}
      />
      {!chart.tableReady ? (
        <p className="mt-4 text-xs text-amber-700">
          Apply supabase/phase85_org_spine_l10_hire.sql for manager_profile_id +
          job_title columns.
        </p>
      ) : null}
      {chart.error ? (
        <p className="mt-2 text-xs text-destructive">{chart.error}</p>
      ) : null}
    </Suspense>
  );
}
