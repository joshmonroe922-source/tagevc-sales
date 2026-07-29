import { Suspense } from 'react';
import { HireImpactClient } from '@/app/(app)/admin/hire-impact/hire-impact-client';
import { listHireCostTemplates, listHireScenarios } from '@/lib/hire/repo';
import { canViewHireImpact } from '@/lib/org/tree';
import { getSessionContext } from '@/lib/rbac/session';
import { normalizeEntityId } from '@/lib/entities/display-name';

export default async function HireImpactPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const session = await getSessionContext();
  if (!session) return null;
  if (!canViewHireImpact(session.profile.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        Hire financial impact is for leadership (Visionary, COO, SubLead, HR,
        Finance).
      </p>
    );
  }

  const params = await searchParams;
  const entityId =
    normalizeEntityId(params.entity ?? '') ||
    session.profile.entity_id ||
    'ENT-FIRM';

  const [templates, scenarios] = await Promise.all([
    listHireCostTemplates(entityId),
    listHireScenarios(entityId),
  ]);

  return (
    <Suspense fallback={null}>
      <HireImpactClient
        templates={templates.templates}
        scenarios={scenarios.scenarios}
        entityId={entityId}
        canEdit={canViewHireImpact(session.profile.role)}
        tableReady={templates.tableReady && scenarios.tableReady}
      />
    </Suspense>
  );
}
