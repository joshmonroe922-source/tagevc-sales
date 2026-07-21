import { createHash, randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getEnvelopeRecoveryEvidence,
  listEnvelopeStatusesByTransactionIds,
  type CreateEnvelopeResult,
} from '@/lib/docusign/envelopes';

export type DocuSignSendIntent = {
  intent_id: string;
  request_id: string;
  operation_kind: 'document_send' | 'template_send' | 'replacement';
  state: string;
  doc_id: string | null;
  entity_id: string | null;
  template_id: string | null;
  source_envelope_id: string | null;
  provider_transaction_id: string;
  provider_envelope_id: string | null;
  lease_token: string | null;
  recovery_attempts: number;
  requested_at: string;
  last_error_code: string | null;
  last_error_message: string | null;
};

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function prepareDocuSignSendIntent(input: {
  requestId?: string;
  operationKind: DocuSignSendIntent['operation_kind'];
  docId?: string | null;
  entityId?: string | null;
  templateId?: string | null;
  sourceEnvelopeId?: string | null;
  emailSubject: string;
  roles?: Array<{ roleName?: string; email: string; name?: string }>;
  content?: string | null;
  explicitHumanApproval: boolean;
  actorId: string;
}): Promise<DocuSignSendIntent> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('prepare_docusign_send', {
    p_request_id: input.requestId || randomUUID(),
    p_operation_kind: input.operationKind,
    p_doc_id: input.docId ?? null,
    p_entity_id: input.entityId ?? null,
    p_template_id: input.templateId ?? null,
    p_source_envelope_id: input.sourceEnvelopeId ?? null,
    p_email_subject: input.emailSubject,
    p_role_map_sha256: sha(
      (input.roles ?? []).map((role) => ({
        role: role.roleName ?? 'Signer',
        email: role.email.trim().toLowerCase(),
        name: role.name?.trim() || null,
      })),
    ),
    p_content_sha256: input.content ? sha(input.content) : null,
    p_explicit_human_approval: input.explicitHumanApproval,
    p_actor_id: input.actorId,
  });
  if (error || !data) {
    throw new Error(error?.message || 'Could not prepare DocuSign send');
  }
  return data as DocuSignSendIntent;
}

export async function dispatchPreparedDocuSignSend(input: {
  intent: DocuSignSendIntent;
  dispatch: (intent: DocuSignSendIntent) => Promise<CreateEnvelopeResult>;
}): Promise<CreateEnvelopeResult> {
  const sb = await createPersistClient();
  const workerId = `send-${randomUUID()}`;
  const { data: claimed, error: claimError } = await sb.rpc(
    'claim_docusign_send',
    {
      p_intent_id: input.intent.intent_id,
      p_worker_id: workerId,
      p_lease_seconds: 90,
    },
  );
  if (claimError || !claimed) {
    if (
      input.intent.state === 'finalized' &&
      input.intent.provider_envelope_id
    ) {
      return {
        envelopeId: input.intent.provider_envelope_id,
        status: 'sent',
        raw: { replay: true, intent_id: input.intent.intent_id },
      };
    }
    throw new Error(claimError?.message || 'Could not claim DocuSign send');
  }
  const leased = claimed as DocuSignSendIntent;
  if (leased.state === 'finalized' && leased.provider_envelope_id) {
    return {
      envelopeId: leased.provider_envelope_id,
      status: 'sent',
      raw: { replay: true, intent_id: leased.intent_id },
    };
  }
  try {
    const created = await input.dispatch(leased);
    const { error: finalizeError } = await sb.rpc('finalize_docusign_send', {
      p_intent_id: leased.intent_id,
      p_lease_token: leased.lease_token,
      p_envelope_id: created.envelopeId,
      p_provider_status: created.status,
      p_recovered: false,
    });
    if (finalizeError) {
      throw new Error(
        `Provider sent ${created.envelopeId}; transactional finalization failed: ${finalizeError.message}`,
      );
    }
    return created;
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : 'DocuSign dispatch failed';
    const status = Number(message.match(/HTTP\s+(\d+)/i)?.[1] ?? 0);
    const unknown =
      !status || status === 408 || status === 429 || status >= 500;
    const { error: finishError } = await sb.rpc('finish_docusign_send_attempt', {
      p_intent_id: leased.intent_id,
      p_lease_token: leased.lease_token,
      p_outcome: unknown ? 'unknown' : 'definitive_failure',
      p_error_class: unknown ? 'provider_unknown' : 'provider_rejected',
      p_error_code: message.match(/·\s+([A-Z_]+)\s+·/)?.[1] || 'send_failed',
      p_error_message: message,
      p_http_status: status || null,
      p_trace_token: message.match(/trace\s+([^\s]+)/i)?.[1] || null,
    });
    if (finishError) {
      throw new Error(
        `${message} · additionally failed to persist send outcome: ${finishError.message}`,
      );
    }
    throw new Error(
      unknown
        ? `${message} · outcome unknown; recovery will reconcile transaction ${leased.provider_transaction_id}`
        : message,
    );
  }
}

export async function recoverDocuSignSendIntents(limit = 20) {
  const sb = await createPersistClient();
  const { data: sweep, error: sweepError } = await sb.rpc(
    'sweep_docusign_send_intents',
  );
  if (sweepError) {
    return {
      claimed: 0,
      recovered: 0,
      deferred: 0,
      quarantined: 0,
      error: sweepError.message,
    };
  }
  const workerId = `recover-${randomUUID()}`;
  const { data, error } = await sb.rpc('claim_docusign_send_recovery', {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: 90,
  });
  if (error) {
    return {
      claimed: 0,
      recovered: 0,
      deferred: 0,
      quarantined: 0,
      sweep,
      error: error.message,
    };
  }
  const intents = (data ?? []) as DocuSignSendIntent[];
  let recovered = 0;
  let deferred = 0;
  let quarantined = 0;
  const issues: string[] = [];
  for (const intent of intents) {
    try {
      const found = await listEnvelopeStatusesByTransactionIds(
        [intent.provider_transaction_id],
      );
      const matches = found.filter(
        (envelope) =>
          envelope.transactionId === intent.provider_transaction_id,
      );
      if (matches.length === 1) {
        const evidence = await getEnvelopeRecoveryEvidence(
          matches[0].envelopeId,
        );
        const evidenceMatches =
          evidence.tagevc_send_intent_id === intent.intent_id &&
          evidence.tagevc_operation_kind === intent.operation_kind &&
          evidence.tagevc_entity_id === (intent.entity_id ?? 'firm') &&
          (!intent.doc_id || evidence.tagevc_doc_id === intent.doc_id);
        if (!evidenceMatches) {
          quarantined += 1;
          const { error: quarantineError } = await sb.rpc(
            'quarantine_docusign_send_recovery',
            {
              p_intent_id: intent.intent_id,
              p_lease_token: intent.lease_token,
              p_disposition: 'evidence_mismatch',
              p_reason:
                'Transaction matched but hidden intent/entity/operation evidence differed',
              p_candidate_envelope_id: matches[0].envelopeId,
              p_candidate_provider_status: matches[0].status,
            },
          );
          if (quarantineError) issues.push(quarantineError.message);
          continue;
        }
        const { error: finalizeError } = await sb.rpc(
          'finalize_docusign_send',
          {
            p_intent_id: intent.intent_id,
            p_lease_token: intent.lease_token,
            p_envelope_id: matches[0].envelopeId,
            p_provider_status: matches[0].status,
            p_recovered: true,
          },
        );
        if (!finalizeError) recovered += 1;
        else {
          quarantined += 1;
          const { error: quarantineError } = await sb.rpc(
            'quarantine_docusign_send_recovery',
            {
              p_intent_id: intent.intent_id,
              p_lease_token: intent.lease_token,
              p_disposition: 'finalization_conflict',
              p_reason: finalizeError.message,
              p_candidate_envelope_id: matches[0].envelopeId,
              p_candidate_provider_status: matches[0].status,
            },
          );
          if (quarantineError) issues.push(quarantineError.message);
        }
      } else if (matches.length > 1) {
        quarantined += 1;
        const { error: quarantineError } = await sb.rpc(
          'quarantine_docusign_send_recovery',
          {
            p_intent_id: intent.intent_id,
            p_lease_token: intent.lease_token,
            p_disposition: 'multiple_matches',
            p_reason: 'Multiple envelopes matched the same provider transaction',
            p_candidate_envelope_id: matches[0]?.envelopeId ?? null,
            p_candidate_provider_status: matches[0]?.status ?? null,
          },
        );
        if (quarantineError) issues.push(quarantineError.message);
      } else {
        deferred += 1;
        const { error: deferError } = await sb.rpc(
          'defer_docusign_send_recovery_v2',
          {
            p_intent_id: intent.intent_id,
            p_lease_token: intent.lease_token,
            p_disposition: 'not_found',
            p_error_message: 'Provider transaction not found yet',
          },
        );
        if (deferError) issues.push(deferError.message);
      }
    } catch (caught) {
      deferred += 1;
      const { error: deferError } = await sb.rpc(
        'defer_docusign_send_recovery_v2',
        {
          p_intent_id: intent.intent_id,
          p_lease_token: intent.lease_token,
          p_disposition: 'lookup_error',
          p_error_message:
            caught instanceof Error ? caught.message : 'Recovery lookup failed',
        },
      );
      if (deferError) issues.push(deferError.message);
    }
  }
  return {
    claimed: intents.length,
    recovered,
    deferred,
    quarantined,
    sweep,
    error: issues[0],
    issues,
  };
}

export async function listDocuSignSendIntents(input?: {
  entityId?: string | null;
  firmWide?: boolean;
}) {
  const sb = await createPersistClient();
  let query = sb
    .from('os_docusign_send_intents')
    .select(
      'intent_id, request_id, operation_kind, state, doc_id, entity_id, template_id, source_envelope_id, provider_transaction_id, provider_envelope_id, dispatch_attempts, recovery_attempts, last_error_code, last_error_message, candidate_envelope_id, last_lookup_at, last_lookup_disposition, manual_review_reason, next_recovery_at, requested_at, finalized_at',
    )
    .order('requested_at', { ascending: false })
    .limit(30);
  if (!input?.firmWide) {
    if (!input?.entityId) return [];
    query = query.eq('entity_id', input.entityId);
  }
  const { data } = await query;
  return data ?? [];
}
