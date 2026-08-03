/**
 * Journey step advancement — email / wait / DocuSign send_envelope / goal.
 * Phase 5b: nurture → envelope uses Document Library IDs via spine port.
 */

import { campaignDb } from '@/lib/campaign/db/client';
import { normalizeJourneyGraph } from '@/lib/campaign/core/journey-graph';
import { queueSendEnvelope } from '@/lib/campaign/docusign-port';
import { listLibraryDocumentsForEntity } from '@/lib/campaign/docusign/library';

type GraphNode = {
  id: string;
  type: string;
  config?: Record<string, unknown>;
};

function nextNodes(
  graph: ReturnType<typeof normalizeJourneyGraph>,
  fromId: string,
): GraphNode[] {
  const outs = graph.edges.filter((e) => e.from === fromId);
  return outs
    .map((e) => graph.nodes.find((n) => n.id === e.to))
    .filter(Boolean) as GraphNode[];
}

async function resolveLibraryDocumentId(
  entityId: string,
  config: Record<string, unknown> | undefined,
): Promise<string | null> {
  const explicit = config?.library_document_id;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();

  // Entity default from settings / pack install metadata
  const sb = await campaignDb();
  const { data: settings } = await sb
    .from('ecc_entity_settings')
    .select('brand_kit_json')
    .eq('entity_id', entityId)
    .maybeSingle();
  const kit = (settings?.brand_kit_json || {}) as {
    default_library_document_id?: string;
  };
  if (kit.default_library_document_id) return kit.default_library_document_id;

  const docs = await listLibraryDocumentsForEntity(entityId);
  return docs[0]?.id ?? null;
}

export async function advanceEnrollmentAfterEnroll(enrollmentId: string) {
  const sb = await campaignDb();
  const { data: enr } = await sb
    .from('ecc_journey_enrollments')
    .select('*, ecc_journeys(id, entity_id, graph_json, status)')
    .eq('id', enrollmentId)
    .maybeSingle();
  if (!enr || enr.state !== 'active') return;

  const journey = enr.ecc_journeys as {
    id: string;
    entity_id: string;
    graph_json: unknown;
    status: string;
  } | null;
  if (!journey) return;

  const graph = normalizeJourneyGraph(journey.graph_json);
  const currentId =
    enr.current_node ||
    graph.nodes.find((n) => n.type === 'trigger')?.id ||
    null;
  if (!currentId) return;

  const targets = nextNodes(graph, currentId);
  for (const node of targets) {
    await runNode({
      enrollmentId,
      entityId: String(enr.entity_id),
      contactId: String(enr.contact_id),
      node,
    });
  }
}

async function runNode(input: {
  enrollmentId: string;
  entityId: string;
  contactId: string;
  node: GraphNode;
}) {
  const sb = await campaignDb();
  await sb.from('ecc_journey_node_runs').insert({
    enrollment_id: input.enrollmentId,
    entity_id: input.entityId,
    node_id: input.node.id,
    status: 'running',
    scheduled_for: new Date().toISOString(),
  });

  if (input.node.type === 'send_envelope') {
    const libraryDocumentId = await resolveLibraryDocumentId(
      input.entityId,
      input.node.config,
    );
    if (!libraryDocumentId) {
      await sb
        .from('ecc_journey_node_runs')
        .update({
          status: 'error',
          error: 'No library_document_id configured for send_envelope',
          completed_at: new Date().toISOString(),
        })
        .eq('enrollment_id', input.enrollmentId)
        .eq('node_id', input.node.id)
        .eq('status', 'running');
      return;
    }

    const result = await queueSendEnvelope({
      entityId: input.entityId,
      libraryDocumentId,
      contactIds: [input.contactId],
      enrollmentId: input.enrollmentId,
      emailMessage:
        typeof input.node.config?.email_message === 'string'
          ? input.node.config.email_message
          : null,
      actorId: null,
      explicitHumanConfirm: false, // journey-queued; spine send happens with operator confirm or mock
      queueOnly: true,
    });

    await sb
      .from('ecc_journey_enrollments')
      .update({ current_node: input.node.id })
      .eq('id', input.enrollmentId);

    await sb
      .from('ecc_journey_node_runs')
      .update({
        status: result.ok ? 'completed' : 'error',
        error: result.ok ? null : result.error,
        completed_at: new Date().toISOString(),
      })
      .eq('enrollment_id', input.enrollmentId)
      .eq('node_id', input.node.id)
      .eq('status', 'running');
    return;
  }

  if (input.node.type === 'wait') {
    const hours = Number(input.node.config?.delay_hours || 24);
    const when = new Date(Date.now() + hours * 3600_000).toISOString();
    await sb
      .from('ecc_journey_enrollments')
      .update({ current_node: input.node.id })
      .eq('id', input.enrollmentId);
    await sb
      .from('ecc_journey_node_runs')
      .update({
        status: 'scheduled',
        scheduled_for: when,
      })
      .eq('enrollment_id', input.enrollmentId)
      .eq('node_id', input.node.id)
      .eq('status', 'running');
    return;
  }

  if (input.node.type === 'goal' || input.node.type === 'exit') {
    await sb
      .from('ecc_journey_enrollments')
      .update({
        current_node: input.node.id,
        state: input.node.type === 'goal' ? 'completed' : 'exited',
        exited_at: new Date().toISOString(),
        exit_reason: String(input.node.config?.goal || input.node.config?.reason || input.node.type),
      })
      .eq('id', input.enrollmentId);
    await sb
      .from('ecc_journey_node_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('enrollment_id', input.enrollmentId)
      .eq('node_id', input.node.id)
      .eq('status', 'running');
    return;
  }

  // email / call_vm_email / branch / task — mark current and leave for workers/UI
  await sb
    .from('ecc_journey_enrollments')
    .update({ current_node: input.node.id })
    .eq('id', input.enrollmentId);
  await sb
    .from('ecc_journey_node_runs')
    .update({
      status: 'pending',
      completed_at: null,
    })
    .eq('enrollment_id', input.enrollmentId)
    .eq('node_id', input.node.id)
    .eq('status', 'running');
}

/** Operator-triggered: dispatch queued envelope actions via spine library send. */
export async function dispatchQueuedEnvelopes(input: {
  entityId: string;
  actorId: string;
  explicitHumanConfirm: boolean;
  limit?: number;
}) {
  const sb = await campaignDb();
  const { data: actions } = await sb
    .from('ecc_envelope_actions')
    .select('*')
    .eq('entity_id', input.entityId)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(input.limit ?? 20);

  const { dispatchEnvelopeAction } = await import(
    '@/lib/campaign/docusign-port'
  );
  const results = [];
  for (const a of actions ?? []) {
    results.push(
      await dispatchEnvelopeAction({
        actionId: String(a.id),
        actorId: input.actorId,
        explicitHumanConfirm: input.explicitHumanConfirm,
      }),
    );
  }
  return results;
}
