import { createPersistClient } from '@/lib/supabase/persist-client';
import { listRecentEnvelopes } from '@/lib/docusign/envelopes';

export type DocuSignReconciliationRow = {
  envelope_id: string;
  operation_kind: string;
  doc_id: string | null;
  entity_id: string | null;
  provider_status: string | null;
  local_document_status: string | null;
  reconciliation_state: string;
  issue_code: string | null;
  last_reconciled_at: string | null;
};

export async function reconcileDocuSignEnvelopes(input: {
  trigger: 'cron' | 'manual' | 'webhook_recovery';
  requestedBy?: string | null;
  days?: number;
}): Promise<{
  ok: boolean;
  run_id?: string;
  seen: number;
  matched: number;
  unmapped: number;
  manual_review: number;
  error?: string;
}> {
  const sb = await createPersistClient();
  const days = Math.min(Math.max(input.days ?? 30, 1), 90);
  const { data: run, error: runError } = await sb
    .from('os_docusign_reconciliation_runs')
    .insert({
      trigger_source: input.trigger,
      status: 'running',
      window_days: days,
      requested_by: input.requestedBy ?? null,
    })
    .select('run_id')
    .single();
  if (runError || !run) {
    return {
      ok: false,
      seen: 0,
      matched: 0,
      unmapped: 0,
      manual_review: 0,
      error: runError?.message || 'Could not start reconciliation run',
    };
  }
  let seen = 0;
  let matched = 0;
  let unmapped = 0;
  let manualReview = 0;
  try {
    const envelopes = [];
    let startPosition = 0;
    for (let page = 0; page < 5; page += 1) {
      const result = await listRecentEnvelopes({
        count: 100,
        days,
        startPosition,
      });
      if (!result.ok) throw new Error(result.error);
      envelopes.push(...result.envelopes);
      if (result.pagination.nextStartPosition == null) break;
      startPosition = result.pagination.nextStartPosition;
    }
    seen = envelopes.length;
    const envelopeIds = envelopes.map((envelope) => envelope.envelopeId);
    const [{ data: documents }, { data: lineage }, { data: events }] =
      await Promise.all([
        envelopeIds.length
          ? sb
              .from('os_documents')
              .select('doc_id, envelope_id, entity_id, status')
              .in('envelope_id', envelopeIds)
          : Promise.resolve({ data: [] }),
        envelopeIds.length
          ? sb
              .from('os_docusign_envelope_lineage')
              .select(
                'lineage_id, source_envelope_id, replacement_envelope_id, source_doc_id, entity_id',
              )
              .or(
                `source_envelope_id.in.(${envelopeIds.join(',')}),replacement_envelope_id.in.(${envelopeIds.join(',')})`,
              )
          : Promise.resolve({ data: [] }),
        envelopeIds.length
          ? sb
              .from('os_docusign_events')
              .select('event_id, envelope_id, doc_id, entity_id, status')
              .in('envelope_id', envelopeIds)
              .order('received_at', { ascending: false })
          : Promise.resolve({ data: [] }),
      ]);
    const now = new Date().toISOString();
    const rows = envelopes.map((envelope) => {
      const docMatches = (documents ?? []).filter(
        (doc) => doc.envelope_id === envelope.envelopeId,
      );
      const lineageMatch = (lineage ?? []).find(
        (item) =>
          item.source_envelope_id === envelope.envelopeId ||
          item.replacement_envelope_id === envelope.envelopeId,
      );
      const event = (events ?? []).find(
        (item) => item.envelope_id === envelope.envelopeId,
      );
      const document = docMatches.length === 1 ? docMatches[0] : null;
      const entityId =
        (document?.entity_id as string | null) ??
        (lineageMatch?.entity_id as string | null) ??
        (event?.entity_id as string | null) ??
        null;
      const docId =
        (document?.doc_id as string | null) ??
        (lineageMatch?.source_doc_id as string | null) ??
        (event?.doc_id as string | null) ??
        null;
      const localStatus = (document?.status as string | null) ?? null;
      const statusMismatch =
        Boolean(localStatus) &&
        localStatus?.toLowerCase() !== envelope.status.toLowerCase();
      const issueCode =
        docMatches.length > 1
          ? 'duplicate_document_mapping'
          : statusMismatch
            ? 'status_mismatch'
            : !docId && !lineageMatch
              ? 'document_missing'
              : null;
      const state =
        docMatches.length > 1 || statusMismatch
          ? 'manual_review'
          : docId || lineageMatch
            ? 'in_sync'
            : 'unmapped_expected';
      if (state === 'manual_review') manualReview += 1;
      else if (state === 'unmapped_expected') unmapped += 1;
      else matched += 1;
      return {
        envelope_id: envelope.envelopeId,
        operation_kind: lineageMatch
          ? 'replacement'
          : document
            ? 'document_send'
            : event
              ? 'connect_discovered'
              : 'legacy',
        doc_id: docId,
        entity_id: entityId,
        lineage_id: lineageMatch?.lineage_id ?? null,
        provider_status: envelope.status,
        provider_status_at: envelope.statusChangedDateTime,
        provider_observed_at: now,
        local_document_status: localStatus,
        last_event_id: event?.event_id ?? null,
        reconciliation_state: state,
        issue_code: issueCode,
        last_error: null,
        attempts: 1,
        last_reconciled_at: now,
        next_reconcile_at: null,
        updated_at: now,
      };
    });
    if (rows.length > 0) {
      const { error } = await sb
        .from('os_docusign_envelopes')
        .upsert(rows, { onConflict: 'envelope_id' });
      if (error) throw new Error(error.message);
    }
    await sb
      .from('os_docusign_reconciliation_runs')
      .update({
        status: manualReview > 0 ? 'partial' : 'completed',
        seen,
        matched,
        unmapped,
        manual_review: manualReview,
        completed_at: now,
      })
      .eq('run_id', run.run_id);
    return {
      ok: true,
      run_id: String(run.run_id),
      seen,
      matched,
      unmapped,
      manual_review: manualReview,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Reconciliation failed';
    await sb
      .from('os_docusign_reconciliation_runs')
      .update({
        status: 'failed',
        seen,
        matched,
        unmapped,
        manual_review: manualReview,
        failed: 1,
        completed_at: new Date().toISOString(),
        error: message,
      })
      .eq('run_id', run.run_id);
    return {
      ok: false,
      run_id: String(run.run_id),
      seen,
      matched,
      unmapped,
      manual_review: manualReview,
      error: message,
    };
  }
}

export async function listDocuSignReconciliation(input?: {
  limit?: number;
  entityId?: string | null;
  firmWide?: boolean;
}): Promise<DocuSignReconciliationRow[]> {
  const sb = await createPersistClient();
  let query = sb
    .from('os_docusign_envelopes')
    .select(
      'envelope_id, operation_kind, doc_id, entity_id, provider_status, local_document_status, reconciliation_state, issue_code, last_reconciled_at',
    )
    .order('updated_at', { ascending: false })
    .limit(input?.limit ?? 50);
  if (!input?.firmWide && input?.entityId) {
    query = query.eq('entity_id', input.entityId);
  } else if (!input?.firmWide) {
    return [];
  }
  const { data } = await query;
  return (data ?? []) as DocuSignReconciliationRow[];
}

export async function listDocuSignReconciliationRuns(limit = 10) {
  const sb = await createPersistClient();
  const { data } = await sb
    .from('os_docusign_reconciliation_runs')
    .select(
      'run_id, trigger_source, status, seen, matched, unmapped, manual_review, started_at, completed_at, error',
    )
    .order('started_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}
