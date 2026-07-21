import { createPersistClient } from '@/lib/supabase/persist-client';

export type DocuSignMappingConflict = {
  item_id: string;
  run_id: string;
  envelope_id: string;
  provider_status: string;
  provider_status_at: string | null;
  item_sha256: string;
  identity_state: 'ambiguous' | 'sticky_ambiguous';
  issue_code: string | null;
  identity_claims: {
    entity_ids?: string[];
    doc_ids?: string[];
    send_intent_ids?: string[];
    lineage_ids?: string[];
    event_ids?: string[];
  };
  committed_at: string;
  envelope: {
    entity_id: string | null;
    doc_id: string | null;
    send_intent_id: string | null;
    lineage_id: string | null;
    row_version: number;
  } | null;
};

export async function listDocuSignMappingReviews(input?: {
  entityId?: string | null;
  firmWide?: boolean;
}) {
  const sb = await createPersistClient();
  await sb.rpc('expire_docusign_mapping_reviews');

  let envelopeQuery = sb
    .from('os_docusign_envelopes')
    .select(
      'envelope_id, entity_id, doc_id, send_intent_id, lineage_id, row_version',
    )
    .eq('reconciliation_state', 'manual_review')
    .in('issue_code', [
      'identity_ambiguity',
      'identity_conflict',
      'send_intent_conflict',
      'duplicate_document_mapping',
    ])
    .order('updated_at', { ascending: false })
    .limit(50);
  let resolutionQuery = sb
    .from('os_docusign_mapping_review_resolutions')
    .select(
      'resolution_id, request_id, envelope_id, source_item_id, source_run_id, entity_id, decision, status, target_entity_id, target_doc_id, target_send_intent_id, target_lineage_id, evidence_sha256, proposal_sha256, proposed_envelope_version, proposed_by, proposed_reason, proposed_at, expires_at, reviewed_by, reviewer_statement, reviewed_at, row_version',
    )
    .order('proposed_at', { ascending: false })
    .limit(50);
  let eventQuery = sb
    .from('os_docusign_mapping_review_events')
    .select(
      'event_id, resolution_id, envelope_id, entity_id, event_type, actor_id, from_status, to_status, evidence_sha256, envelope_version, resolution_version, detail, reason, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100);

  if (!input?.firmWide) {
    if (!input?.entityId) {
      return { conflicts: [], resolutions: [], events: [] };
    }
    envelopeQuery = envelopeQuery.eq('entity_id', input.entityId);
    resolutionQuery = resolutionQuery.eq('entity_id', input.entityId);
    eventQuery = eventQuery.eq('entity_id', input.entityId);
  }

  const [
    { data: envelopes, error: envelopeError },
    { data: resolutions, error: resolutionError },
    { data: events, error: eventError },
  ] = await Promise.all([envelopeQuery, resolutionQuery, eventQuery]);
  const envelopeById = new Map(
    (envelopes ?? []).map((row) => [String(row.envelope_id), row]),
  );
  const envelopeIds = [...envelopeById.keys()];
  const { data: items, error: itemError } =
    envelopeIds.length === 0
      ? { data: [], error: null }
      : await sb
          .from('os_docusign_reconciliation_items')
          .select(
            'item_id, run_id, envelope_id, provider_status, provider_status_at, item_sha256, identity_state, issue_code, identity_claims, committed_at',
          )
          .in('envelope_id', envelopeIds)
          .in('identity_state', ['ambiguous', 'sticky_ambiguous'])
          .order('committed_at', { ascending: false });

  const seen = new Set<string>();
  const conflicts = (items ?? [])
    .filter((item) => {
      const id = String(item.envelope_id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((item) => ({
      ...item,
      envelope: envelopeById.get(String(item.envelope_id)) ?? null,
    })) as DocuSignMappingConflict[];

  return {
    conflicts,
    resolutions: resolutions ?? [],
    events: events ?? [],
    error:
      envelopeError?.message ||
      resolutionError?.message ||
      eventError?.message ||
      itemError?.message,
  };
}
