import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import { campaignDb } from '@/lib/campaign/db/client';
import { JourneyGraphEditor } from '@/components/campaign/journey-graph-editor';
import { ECC_ROUTE_PREFIX } from '@/lib/campaign/core/types';
import { validateJourneyGraph } from '@/lib/campaign/core/journey-graph';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const entityId = ctx?.profile.entity_id || 'ENT-FIRM';
  const { id } = await params;
  const sb = await campaignDb();
  const { data: journey } = await sb
    .from('ecc_journeys')
    .select('*')
    .eq('entity_id', entityId)
    .eq('id', id)
    .maybeSingle();
  if (!journey) notFound();

  const { normalizeJourneyGraph } = await import('@/lib/campaign/core/journey-graph');
  const validation = validateJourneyGraph(normalizeJourneyGraph(journey.graph_json));
  const { count: enrollments } = await sb
    .from('ecc_journey_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('journey_id', id)
    .eq('entity_id', entityId);

  const notes = [...validation.errors, ...validation.warnings];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`${ECC_ROUTE_PREFIX}/sequences`}
            className="text-xs text-[#7c7871] hover:text-[#3a414f]"
          >
            ← Sequences
          </Link>
          <h2 className="font-heading mt-1 text-xl font-semibold text-[#3a414f]">{journey.name}</h2>
          <p className="text-sm text-[#7c7871]">
            {journey.journey_type} · {journey.status}
            {journey.mutex_group ? ` · mutex ${journey.mutex_group}` : ''}
            {' · '}
            {enrollments ?? 0} enrollments
          </p>
        </div>
        {notes.length ? (
          <p className="max-w-sm text-xs text-[#8a7355]">
            {notes.length} validation note{notes.length === 1 ? '' : 's'} — fix hard errors before
            publish.
          </p>
        ) : null}
      </div>
      <JourneyGraphEditor
        journeyId={String(journey.id)}
        initialGraph={journey.graph_json}
        name={String(journey.name)}
        status={String(journey.status)}
      />
    </div>
  );
}
