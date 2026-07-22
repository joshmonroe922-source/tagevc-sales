'use server';

import { revalidatePath } from 'next/cache';
import { applyDocuSignWebhook } from '@/lib/data/document-store';
import { insertDocuSignEvent } from '@/lib/docusign/events-repo';
import {
  getEnvelopeStatus,
  remindEnvelope,
  voidEnvelope,
} from '@/lib/docusign/envelopes';
import { backfillSignedFilesToStorage } from '@/lib/docusign/signed-docs';
import { syncDocuSignTemplates } from '@/lib/docusign/templates';
import { logActivity } from '@/lib/data/activity';
import { guardPermission } from '@/lib/rbac/session';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { getManualReviewEvidence } from '@/lib/docusign/envelopes';
import {
  canAccessEntityId,
  entityScopeDeniedMessage,
  isFirmWideAccess,
} from '@/lib/rbac/entity-scope';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { AppRole } from '@/lib/types/roles';

export type DocuSignActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function revalidateDocuSign() {
  revalidatePath('/shared-services/legal/docusign');
  revalidatePath('/documents');
}

export async function proposeDocuSignManualReviewAction(input: {
  intentId: string;
  decision: 'finalize_candidate' | 'cancel_intent';
  candidateEnvelopeId?: string | null;
  reason: string;
  expectedIntentVersion: number;
}): Promise<DocuSignActionResult> {
  const gate = await guardPermission('action:docusign_manual_review');
  if (!gate.ok) return gate;
  const parsed = z.object({
    intentId: z.string().uuid(),
    decision: z.enum(['finalize_candidate', 'cancel_intent']),
    candidateEnvelopeId: z.string().trim().min(1).nullable().optional(),
    reason: z.string().trim().min(20).max(1000),
    expectedIntentVersion: z.number().int().nonnegative(),
  }).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message || 'Invalid manual-review proposal',
    };
  }
  const service = await createPersistClient();
  const { data: intent, error: intentError } = await service
    .from('os_docusign_send_intents')
    .select('provider_transaction_id, entity_id, state')
    .eq('intent_id', parsed.data.intentId)
    .single();
  if (intentError || !intent || intent.state !== 'manual_review') {
    return {
      ok: false,
      error: intentError?.message || 'Manual-review intent is unavailable',
    };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      intent.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(intent.entity_id || 'firm-wide'),
    };
  }
  try {
    const evidence = await getManualReviewEvidence(
      intent.provider_transaction_id,
    );
    const { error } = await service.rpc(
      'propose_docusign_manual_review_resolution',
      {
        p_intent_id: parsed.data.intentId,
        p_actor_id: gate.profile.id,
        p_decision: parsed.data.decision,
        p_candidate_envelope_id:
          parsed.data.candidateEnvelopeId ?? null,
        p_provider_evidence: evidence,
        p_reason: parsed.data.reason,
        p_expected_intent_version: parsed.data.expectedIntentVersion,
      },
    );
    if (error) return { ok: false, error: error.message };
    revalidateDocuSign();
    return {
      ok: true,
      message:
        'Manual-review proposal recorded. A different authorized reviewer must approve it within 30 minutes.',
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error
          ? caught.message
          : 'Could not gather DocuSign review evidence',
    };
  }
}

export async function reviewDocuSignManualReviewAction(input: {
  resolutionId: string;
  reviewDecision: 'approve' | 'reject';
  statement: string;
  expectedResolutionVersion: number;
  expectedIntentVersion: number;
}): Promise<DocuSignActionResult> {
  const gate = await guardPermission('action:docusign_manual_review');
  if (!gate.ok) return gate;
  const parsed = z.object({
    resolutionId: z.string().uuid(),
    reviewDecision: z.enum(['approve', 'reject']),
    statement: z.string().trim().min(20).max(1000),
    expectedResolutionVersion: z.number().int().nonnegative(),
    expectedIntentVersion: z.number().int().nonnegative(),
  }).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message || 'Invalid manual-review decision',
    };
  }
  const service = await createPersistClient();
  const { data: resolution, error: resolutionError } = await service
    .from('os_docusign_manual_review_resolutions')
    .select('intent_id, entity_id')
    .eq('resolution_id', parsed.data.resolutionId)
    .single();
  if (resolutionError || !resolution) {
    return {
      ok: false,
      error: resolutionError?.message || 'Manual-review proposal not found',
    };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      resolution.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(resolution.entity_id || 'firm-wide'),
    };
  }
  const { data: intent, error: intentError } = await service
    .from('os_docusign_send_intents')
    .select('provider_transaction_id')
    .eq('intent_id', resolution.intent_id)
    .single();
  if (intentError || !intent) {
    return {
      ok: false,
      error: intentError?.message || 'Manual-review intent not found',
    };
  }
  try {
    const evidence = await getManualReviewEvidence(
      intent.provider_transaction_id,
    );
    const { error } = await service.rpc(
      'review_docusign_manual_review_resolution',
      {
        p_resolution_id: parsed.data.resolutionId,
        p_actor_id: gate.profile.id,
        p_review_decision: parsed.data.reviewDecision,
        p_provider_evidence: evidence,
        p_statement: parsed.data.statement,
        p_expected_resolution_version: parsed.data.expectedResolutionVersion,
        p_expected_intent_version: parsed.data.expectedIntentVersion,
      },
    );
    if (error) return { ok: false, error: error.message };
    revalidateDocuSign();
    return {
      ok: true,
      message:
        parsed.data.reviewDecision === 'approve'
          ? 'Manual-review resolution approved and committed atomically'
          : 'Manual-review proposal rejected; intent remains quarantined',
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error
          ? caught.message
          : 'Could not revalidate DocuSign provider evidence',
    };
  }
}

export async function proposeDocuSignMappingReviewAction(input: {
  requestId: string;
  sourceItemId: string;
  decision: 'assign_identity' | 'retain_quarantine';
  targetEntityId?: string | null;
  targetDocId?: string | null;
  targetSendIntentId?: string | null;
  targetLineageId?: string | null;
  reason: string;
  expectedEnvelopeVersion: number;
}): Promise<DocuSignActionResult> {
  const gate = await guardPermission('action:docusign_manual_review');
  if (!gate.ok) return gate;
  const optionalUuid = z.string().uuid().nullable().optional();
  const parsed = z
    .object({
      requestId: z.string().uuid(),
      sourceItemId: z.string().uuid(),
      decision: z.enum(['assign_identity', 'retain_quarantine']),
      targetEntityId: z.string().trim().min(1).max(100).nullable().optional(),
      targetDocId: z.string().trim().min(1).max(200).nullable().optional(),
      targetSendIntentId: optionalUuid,
      targetLineageId: optionalUuid,
      reason: z.string().trim().min(20).max(1000),
      expectedEnvelopeVersion: z.number().int().nonnegative(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message || 'Invalid mapping-review proposal',
    };
  }
  const service = await createPersistClient();
  const { data: item, error: itemError } = await service
    .from('os_docusign_reconciliation_items')
    .select('envelope_id')
    .eq('item_id', parsed.data.sourceItemId)
    .single();
  if (itemError || !item) {
    return {
      ok: false,
      error: itemError?.message || 'Mapping evidence is unavailable',
    };
  }
  const { data: envelope, error: envelopeError } = await service
    .from('os_docusign_envelopes')
    .select('entity_id')
    .eq('envelope_id', item.envelope_id)
    .single();
  if (envelopeError || !envelope) {
    return {
      ok: false,
      error: envelopeError?.message || 'Mapping projection is unavailable',
    };
  }
  const targetEntityId = parsed.data.targetEntityId ?? null;
  const currentEntityId = (envelope.entity_id as string | null) ?? null;
  if (
    (!currentEntityId &&
      !targetEntityId &&
      !isFirmWideAccess(gate.profile.role, gate.profile.entity_id)) ||
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      currentEntityId ?? targetEntityId,
    ) ||
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      targetEntityId,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(
        currentEntityId ?? targetEntityId ?? 'unmapped',
      ),
    };
  }
  const { data, error } = await service.rpc(
    'propose_docusign_mapping_review_resolution',
    {
      p_request_id: parsed.data.requestId,
      p_source_item_id: parsed.data.sourceItemId,
      p_actor_id: gate.profile.id,
      p_decision: parsed.data.decision,
      p_target_entity_id: targetEntityId,
      p_target_doc_id: parsed.data.targetDocId ?? null,
      p_target_send_intent_id: parsed.data.targetSendIntentId ?? null,
      p_target_lineage_id: parsed.data.targetLineageId ?? null,
      p_reason: parsed.data.reason,
      p_expected_envelope_version: parsed.data.expectedEnvelopeVersion,
    },
  );
  if (error) return { ok: false, error: error.message };
  revalidateDocuSign();
  const replayed = Boolean((data as { replayed?: boolean } | null)?.replayed);
  return {
    ok: true,
    message: replayed
      ? 'Mapping-review proposal replayed without duplicate effects'
      : 'Mapping-review proposal frozen. A different authorized actor must review it.',
  };
}

export async function reviewDocuSignMappingReviewAction(input: {
  reviewRequestId: string;
  resolutionId: string;
  reviewDecision: 'approve' | 'reject';
  statement: string;
  expectedResolutionVersion: number;
  expectedEnvelopeVersion: number;
}): Promise<DocuSignActionResult> {
  const gate = await guardPermission('action:docusign_manual_review');
  if (!gate.ok) return gate;
  const parsed = z
    .object({
      reviewRequestId: z.string().uuid(),
      resolutionId: z.string().uuid(),
      reviewDecision: z.enum(['approve', 'reject']),
      statement: z.string().trim().min(20).max(1000),
      expectedResolutionVersion: z.number().int().nonnegative(),
      expectedEnvelopeVersion: z.number().int().nonnegative(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message || 'Invalid mapping review',
    };
  }
  const service = await createPersistClient();
  const { data: resolution, error: resolutionError } = await service
    .from('os_docusign_mapping_review_resolutions')
    .select('entity_id')
    .eq('resolution_id', parsed.data.resolutionId)
    .single();
  if (resolutionError || !resolution) {
    return {
      ok: false,
      error: resolutionError?.message || 'Mapping-review proposal not found',
    };
  }
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      resolution.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(resolution.entity_id || 'unmapped'),
    };
  }
  const { data, error } = await service.rpc(
    'review_docusign_mapping_review_resolution',
    {
      p_review_request_id: parsed.data.reviewRequestId,
      p_resolution_id: parsed.data.resolutionId,
      p_actor_id: gate.profile.id,
      p_review_decision: parsed.data.reviewDecision,
      p_statement: parsed.data.statement,
      p_expected_resolution_version: parsed.data.expectedResolutionVersion,
      p_expected_envelope_version: parsed.data.expectedEnvelopeVersion,
    },
  );
  if (error) return { ok: false, error: error.message };
  revalidateDocuSign();
  const outcome = data as {
    status?: string;
    replayed?: boolean;
    error?: string;
  } | null;
  if (outcome?.status === 'projection_conflict') {
    return {
      ok: false,
      error:
        outcome.error ||
        'Projection changed; conflict remains quarantined for a new proposal',
    };
  }
  return {
    ok: true,
    message: outcome?.replayed
      ? 'Mapping review replayed without duplicate effects'
      : parsed.data.reviewDecision === 'approve'
        ? 'Mapping decision committed atomically; send authorization was unchanged'
        : 'Mapping proposal rejected; conflict remains quarantined',
  };
}

async function envelopeScopeError(
  role: AppRole,
  profileEntityId: string | null | undefined,
  envelopeId: string,
): Promise<string | null> {
  if (isFirmWideAccess(role, profileEntityId)) return null;
  const sb = await createPersistClient();
  const { data } = await sb
    .from('os_docusign_envelopes')
    .select('entity_id')
    .eq('envelope_id', envelopeId)
    .maybeSingle();
  const entityId = (data?.entity_id as string | null) ?? null;
  return entityId &&
    canAccessEntityId(role, profileEntityId, entityId)
    ? null
    : entityScopeDeniedMessage(entityId || 'unmapped');
}

export async function reconcileDocuSignAction(): Promise<DocuSignActionResult> {
  const gate = await guardPermission('action:docusign_reconcile');
  if (!gate.ok) return gate;
  const { reconcileDocuSignEnvelopes } = await import(
    '@/lib/docusign/reconciliation-repo'
  );
  const result = await reconcileDocuSignEnvelopes({
    trigger: 'manual',
    requestedBy: gate.profile.id,
    days: 30,
    maxPages: 3,
  });
  revalidateDocuSign();
  return result.ok
    ? {
        ok: true,
        message: `Reconciliation ${result.completed ? 'completed' : 'checkpointed'} · ${result.pages} page(s) this invocation · ${result.seen} total seen · ${result.manual_review} review`,
      }
    : { ok: false, error: result.error || 'Reconciliation failed' };
}

export async function runArchiveGovernanceAction(input: {
  kind: 'legacy_backfill' | 'integrity_scan';
  mode?: 'sample' | 'full';
}): Promise<DocuSignActionResult> {
  const gate = await guardPermission('action:docusign_reconcile');
  if (!gate.ok) return gate;
  const { runArchiveGovernanceWorker } = await import(
    '@/lib/docusign/archive-governance'
  );
  const result = await runArchiveGovernanceWorker({
    runKind: input.kind,
    scanMode: input.kind === 'legacy_backfill' ? 'full' : input.mode ?? 'sample',
    trigger: 'manual',
    requestedBy: gate.profile.id,
    limit: 5,
  });
  revalidateDocuSign();
  return result.ok || result.claimed > 0
    ? {
        ok: true,
        message: `Archive ${input.kind === 'legacy_backfill' ? 'backfill' : `${input.mode ?? 'sample'} scan`}: ${result.succeeded} verified/archived, ${result.unavailable} unavailable, ${result.drift} drift${result.checkpointed ? ' · checkpointed' : ''}`,
      }
    : { ok: false, error: result.error || 'Archive governance worker failed' };
}

export async function runArchiveCampaignAction(input: {
  kind: 'legacy_backfill_completion' | 'quarterly_full_integrity';
  force?: boolean;
}): Promise<DocuSignActionResult> {
  const gate = await guardPermission('action:docusign_reconcile');
  if (!gate.ok) return gate;
  const { runArchiveCampaignTick } = await import(
    '@/lib/docusign/archive-campaigns'
  );
  const result = await runArchiveCampaignTick({
    campaignKind: input.kind,
    trigger: 'manual',
    requestedBy: gate.profile.id,
    force: input.force ?? false,
    limit: 5,
  });
  revalidateDocuSign();
  if (result.disposition === 'not_due') {
    return {
      ok: true,
      message: 'Quarterly full integrity campaign is not due this quarter',
    };
  }
  if (result.disposition === 'gated') {
    return {
      ok: true,
      message: `Campaign gated: ${result.gateReason ?? 'gates'} · ${result.remainingUnhashed ?? 0} unhashed remaining · ${result.quarantineBacklog ?? 0} quarantine · ${result.progressPct ?? 0}%${result.opsMilestone?.eventKind ? ` · ops ${result.opsMilestone.eventKind}` : ''}`,
    };
  }
  if (result.disposition === 'already_complete') {
    return {
      ok: true,
      message: `Campaign already complete · ${result.progressPct ?? 100}%${result.opsMilestone?.firstQuarterlyMilestone ? ' · first quarterly milestone recorded' : ''}`,
    };
  }
  if (result.ok || (result.governance?.claimed ?? 0) > 0) {
    return {
      ok: true,
      message: `Campaign ${input.kind.replaceAll('_', ' ')}: ${result.progressPct ?? 0}% · run ${result.governance?.succeeded ?? 0} ok, ${result.governance?.unavailable ?? 0} unavailable, ${result.governance?.drift ?? 0} drift${result.governance?.checkpointed ? ' · checkpointed' : ''}${result.opsMilestone?.eventKind ? ` · ops ${result.opsMilestone.eventKind}` : ''}`,
    };
  }
  return {
    ok: false,
    error: result.error || 'Archive campaign worker failed',
  };
}

export async function reviewArchiveQuarantineAction(input: {
  quarantineId: string;
  decision: 'acknowledge' | 'resolve';
  note: string;
  expectedRowVersion: number;
}): Promise<DocuSignActionResult> {
  const gate = await guardPermission('action:docusign_manual_review');
  if (!gate.ok) return gate;
  const parsed = z
    .object({
      quarantineId: z.string().uuid(),
      decision: z.enum(['acknowledge', 'resolve']),
      note: z.string().trim().min(20).max(1000),
      expectedRowVersion: z.number().int().nonnegative(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message || 'Invalid archive review',
    };
  }
  const service = await createPersistClient();
  const { data: row, error: rowError } = await service
    .from('os_docusign_archive_quarantine')
    .select('entity_id')
    .eq('quarantine_id', parsed.data.quarantineId)
    .single();
  if (
    rowError ||
    !row ||
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      row.entity_id,
    )
  ) {
    return {
      ok: false,
      error:
        rowError?.message ||
        entityScopeDeniedMessage(row?.entity_id || 'archive quarantine'),
    };
  }
  const { error } = await service.rpc('review_docusign_archive_quarantine', {
    p_quarantine_id: parsed.data.quarantineId,
    p_actor_id: gate.profile.id,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note,
    p_expected_row_version: parsed.data.expectedRowVersion,
  });
  if (error) return { ok: false, error: error.message };
  revalidateDocuSign();
  return { ok: true, message: `Archive drift ${parsed.data.decision}d` };
}

export async function voidEnvelopeAction(
  envelopeId: string,
  reason: string,
): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;

  const id = envelopeId.trim();
  const voidReason = reason.trim();
  if (!id) return { ok: false, error: 'envelope_id required' };
  const scopeError = await envelopeScopeError(
    gate.profile.role,
    gate.profile.entity_id,
    id,
  );
  if (scopeError) return { ok: false, error: scopeError };
  if (!voidReason) {
    return { ok: false, error: 'Void reason is required for audit' };
  }

  // Phase 30 void policy
  const policy = (
    process.env.DOCUSIGN_VOID_POLICY || 'allow'
  ).trim().toLowerCase();
  try {
    const { listDocuments } = await import('@/lib/data/document-store');
    const { isCapitalDocument } = await import('@/lib/documents/capital-gate');
    const doc = listDocuments().find((d) => d.envelope_id === id);
    if (doc && isCapitalDocument(doc.doc_type)) {
      if (policy === 'block_capital') {
        return {
          ok: false,
          error:
            'Void blocked: capital document (DOCUSIGN_VOID_POLICY=block_capital)',
        };

      }
      if (policy === 'warn_capital') {
        // Allow but tag audit payload
      }
      const capitalGate = await guardPermission('action:docusign_capital');
      if (!capitalGate.ok && policy !== 'allow') {
        return {
          ok: false,
          error: capitalGate.error || 'Capital void requires action:docusign_capital',
        };
      }
    }
  } catch {
    /* document store optional */
  }

  if (!id.startsWith('ENV-')) {
    try {
      const current = await getEnvelopeStatus(id);
      if (current.status === 'voided') {
        return {
          ok: false,
          error:
            'Envelope is already voided. DocuSign void is irreversible; create a replacement envelope.',
        };
      }
      if (!['sent', 'delivered'].includes(current.status)) {
        return {
          ok: false,
          error: `Envelope status ${current.status} is not eligible for void. Only sent/delivered envelopes can be voided.`,
        };
      }
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof Error
            ? `Void preflight failed: ${e.message}`
            : 'Void preflight failed',
      };
    }
  }

  const requestedAt = new Date().toISOString();
  const intent = await insertDocuSignEvent({
    envelope_id: id,
    status: 'void-requested',
    event_type: 'envelope-void-requested',
    raw_payload: {
      reason: voidReason,
      source: 'hub',
      actor_id: gate.profile.id,
      actor_email: gate.profile.email ?? null,
      requested_at: requestedAt,
      void_policy: policy,
    },
  });
  if (!intent.ok) {
    return {
      ok: false,
      error: `Void aborted because intent audit could not be persisted: ${intent.error}`,
    };
  }

  const api = await voidEnvelope(id, voidReason);
  if (!api.ok) {
    await insertDocuSignEvent({
      envelope_id: id,
      status: 'void-failed',
      event_type: 'envelope-void-failed',
      raw_payload: {
        reason: voidReason,
        source: 'hub',
        actor_id: gate.profile.id,
        actor_email: gate.profile.email ?? null,
        error: api.error,
        requested_at: requestedAt,
      },
    });
    return api;
  }

  try {
    applyDocuSignWebhook({ envelope_id: id, status: 'voided' });
  } catch {
    // Envelope may be Connect-only / unknown locally
  }

  let capital = false;
  try {
    const { listDocuments } = await import('@/lib/data/document-store');
    const { isCapitalDocument } = await import('@/lib/documents/capital-gate');
    const doc = listDocuments().find((d) => d.envelope_id === id);
    capital = Boolean(doc && isCapitalDocument(doc.doc_type));
  } catch {
    /* optional */
  }

  const audit = await insertDocuSignEvent({
    envelope_id: id,
    status: 'voided',
    event_type: 'envelope-voided',
    raw_payload: {
      reason: voidReason,
      source: 'hub',
      actor_id: gate.profile.id,
      actor_email: gate.profile.email ?? null,
      voided_at: new Date().toISOString(),
      void_policy: policy,
      capital,
    },
  });
  if (!audit.ok) {
    return {
      ok: false,
      error: `Envelope was voided, but audit persistence failed: ${audit.error}. Escalate for reconciliation.`,
    };
  }

  void logActivity({
    module: 'documents',
    action: 'docusign_voided',
    title: `Envelope voided: ${id.slice(0, 18)} · ${voidReason.slice(0, 40)}`,
    ref_type: 'document',
    ref_id: id,
  });

  revalidateDocuSign();
  return {
    ok: true,
    message: `Voided ${id} · audited${capital ? ' · capital' : ''}`,
  };
}

/** Void cannot be undone in DocuSign; create a replacement with lineage. */
export async function createReplacementEnvelopeAction(input: {
  requestId?: string;
  sourceEnvelopeId: string;
  templateId: string;
  emailSubject: string;
  signerEmail?: string;
  signerName?: string;
  roleName?: string;
  roles?: Array<{ roleName: string; email: string; name?: string }>;
  reason?: string;
}): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;
  const sourceEnvelopeId = input.sourceEnvelopeId.trim();
  const templateId = input.templateId.trim();
  const rolesInput =
    input.roles ??
    (input.signerEmail
      ? [
          {
            roleName: input.roleName?.trim() || 'Signer',
            email: input.signerEmail,
            name: input.signerName,
          },
        ]
      : []);
  const parsedRoles = z
    .array(
      z.object({
        roleName: z.string().trim().min(1).max(100),
        email: z.string().trim().email(),
        name: z.string().trim().max(100).optional(),
      }),
    )
    .min(1)
    .max(20)
    .safeParse(rolesInput);
  if (!sourceEnvelopeId || !templateId || !parsedRoles.success) {
    return {
      ok: false,
      error:
        parsedRoles.success
          ? 'Source envelope and template are required'
          : parsedRoles.error.issues[0]?.message || 'Valid roles are required',
    };
  }
  const roleNames = parsedRoles.data.map((role) => role.roleName.toLowerCase());
  if (new Set(roleNames).size !== roleNames.length) {
    return { ok: false, error: 'Replacement role names must be unique' };
  }
  let sourceContext: {
    doc_id: string | null;
    entity_id: string | null;
    deal_id: string | null;
    ticket_id: string | null;
  } = { doc_id: null, entity_id: null, deal_id: null, ticket_id: null };
  try {
    const { listDocuments } = await import('@/lib/data/document-store');
    const { isCapitalDocument } = await import('@/lib/documents/capital-gate');
    const doc = listDocuments().find(
      (candidate) => candidate.envelope_id === sourceEnvelopeId,
    );
    if (doc) {
      sourceContext = {
        doc_id: doc.doc_id,
        entity_id: doc.entity_id ?? null,
        deal_id: null,
        ticket_id: null,
      };
      if (isCapitalDocument(doc.doc_type)) {
        const capitalGate = await guardPermission('action:docusign_capital');
        if (!capitalGate.ok) {
          return {
            ok: false,
            error:
              capitalGate.error ||
              'Capital replacement requires action:docusign_capital',
          };
        }
      }
    }
  } catch {
    // Connect-only envelopes may not have a local document.
  }
  const sb = await createPersistClient();
  if (!sourceContext.entity_id) {
    const { data: projection } = await sb
      .from('os_docusign_envelopes')
      .select('doc_id, entity_id')
      .eq('envelope_id', sourceEnvelopeId)
      .maybeSingle();
    if (projection) {
      sourceContext.doc_id = (projection.doc_id as string) ?? null;
      sourceContext.entity_id = (projection.entity_id as string) ?? null;
    }
  }
  if (
    (!sourceContext.entity_id &&
      !isFirmWideAccess(gate.profile.role, gate.profile.entity_id)) ||
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      sourceContext.entity_id,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(sourceContext.entity_id || 'unmapped'),
    };
  }
  if (!sourceEnvelopeId.startsWith('ENV-')) {
    try {
      const source = await getEnvelopeStatus(sourceEnvelopeId);
      if (source.status !== 'voided') {
        return {
          ok: false,
          error: `Replacement is only available for voided envelopes; current status is ${source.status}.`,
        };
      }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Replacement preflight failed',
      };
    }
  }
  const requestId =
    input.requestId?.trim() || randomUUID();
  const { error: lineageIntentError } = await sb
    .from('os_docusign_envelope_lineage')
    .upsert({
      request_id: requestId,
      source_envelope_id: sourceEnvelopeId,
      source_doc_id: sourceContext.doc_id,
      entity_id: sourceContext.entity_id,
      deal_id: sourceContext.deal_id,
      ticket_id: sourceContext.ticket_id,
      template_id: templateId,
      role_map: parsedRoles.data,
      replacement_reason: input.reason?.trim() || null,
      status: 'requested',
      actor_id: gate.profile.id,
      actor_email: gate.profile.email ?? null,
    }, { onConflict: 'request_id', ignoreDuplicates: true });
  if (lineageIntentError) {
    return {
      ok: false,
      error: `Replacement intent rejected: ${lineageIntentError.message}`,
    };
  }
  const requestedAudit = await insertDocuSignEvent({
    envelope_id: sourceEnvelopeId,
    status: 'replacement-requested',
    event_type: 'envelope-replacement-requested',
    raw_payload: {
      source: 'hub',
      templateId,
      actor_id: gate.profile.id,
      actor_email: gate.profile.email ?? null,
      requested_at: new Date().toISOString(),
      request_id: requestId,
      roles: parsedRoles.data,
      reason: input.reason?.trim() || null,
    },
  });
  if (!requestedAudit.ok) {
    await sb
      .from('os_docusign_envelope_lineage')
      .update({ status: 'failed', error: requestedAudit.error, updated_at: new Date().toISOString() })
      .eq('request_id', requestId);
    return {
      ok: false,
      error: `Replacement aborted because lineage intent could not be persisted: ${requestedAudit.error}`,
    };
  }
  try {
    const { createEnvelopeFromTemplate } = await import(
      '@/lib/docusign/envelopes'
    );
    const {
      prepareDocuSignSendIntent,
      dispatchPreparedDocuSignSend,
    } = await import('@/lib/docusign/send-intents-repo');
    const normalizedRoles = parsedRoles.data.map((role) => ({
        email: role.email,
        name: role.name || role.email,
        roleName: role.roleName,
      }));
    const sendIntent = await prepareDocuSignSendIntent({
      requestId,
      operationKind: 'replacement',
      docId: sourceContext.doc_id,
      entityId: sourceContext.entity_id,
      templateId,
      sourceEnvelopeId,
      emailSubject:
        input.emailSubject.trim() || 'Replacement signature request',
      roles: normalizedRoles,
      explicitHumanApproval: true,
      actorId: gate.profile.id,
    });
    if (sendIntent.state === 'finalized' && sendIntent.provider_envelope_id) {
      return {
        ok: true,
        message: `Replacement ${sendIntent.provider_envelope_id} already finalized for ${sourceEnvelopeId}`,
      };
    }
    const { data: boundLineage, error: lineageBindError } = await sb
      .from('os_docusign_envelope_lineage')
      .update({
        send_intent_id: sendIntent.intent_id,
        updated_at: new Date().toISOString(),
      })
      .eq('request_id', requestId)
      .eq('status', 'requested')
      .select('lineage_id')
      .single();
    if (lineageBindError || !boundLineage) {
      throw new Error(
        `Replacement intent prepared but lineage binding failed: ${
          lineageBindError?.message || 'lineage not found'
        }`,
      );
    }
    const created = await dispatchPreparedDocuSignSend({
      intent: sendIntent,
      dispatch: (leased) =>
        createEnvelopeFromTemplate({
          templateId,
          emailSubject:
            input.emailSubject.trim() || 'Replacement signature request',
          signers: normalizedRoles,
          transactionId: leased.provider_transaction_id,
          intentId: leased.intent_id,
          entityId: sourceContext.entity_id,
          operationKind: 'replacement',
          docId: sourceContext.doc_id,
        }),
    });
    revalidateDocuSign();
    return {
      ok: true,
      message: `Replacement ${created.envelopeId} sent for voided ${sourceEnvelopeId}`,
    };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Replacement send failed';
    await sb
      .from('os_docusign_envelope_lineage')
      .update({
        status: 'failed',
        error: `Pre-dispatch setup failed: ${message}`.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('request_id', requestId)
      .eq('status', 'requested')
      .is('send_intent_id', null);
    return {
      ok: false,
      error: message.includes('outcome unknown')
        ? `${message} · do not resend; transactional recovery is pending`
        : message,
    };
  }
}

export async function remindEnvelopeAction(
  envelopeId: string,
): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;

  const id = envelopeId.trim();
  if (!id) return { ok: false, error: 'envelope_id required' };
  const scopeError = await envelopeScopeError(
    gate.profile.role,
    gate.profile.entity_id,
    id,
  );
  if (scopeError) return { ok: false, error: scopeError };

  const api = await remindEnvelope(id);
  if (!api.ok) return api;

  await insertDocuSignEvent({
    envelope_id: id,
    status: 'sent',
    event_type: 'envelope-reminded',
    raw_payload: { source: 'hub' },
  });

  void logActivity({
    module: 'documents',
    action: 'docusign_reminded',
    title: `Envelope reminded: ${id.slice(0, 18)}`,
    ref_type: 'document',
    ref_id: id,
  });

  revalidateDocuSign();
  return { ok: true, message: `Reminder sent for ${id}` };
}

export async function syncTemplatesAction(): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;
  const res = await syncDocuSignTemplates();
  if (!res.ok) return res;
  revalidateDocuSign();
  return {
    ok: true,
    message: `Synced ${res.count} templates across ${res.pages} page(s)${
      res.truncated ? ' · bounded sync truncated' : ''
    }`,
  };
}

export async function refreshTemplateRecipientsAction(
  templateId: string,
): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;
  const id = templateId.trim();
  if (!id) return { ok: false, error: 'templateId required' };
  const { refreshTemplateRecipients } = await import(
    '@/lib/docusign/templates'
  );
  const res = await refreshTemplateRecipients(id);
  if (!res.ok) return res;
  revalidateDocuSign();
  return {
    ok: true,
    message: `Refreshed ${res.template.name} · roles: ${res.template.roles.join(', ')}`,
  };
}

export async function backfillSignedStorageAction(): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;

  const res = await backfillSignedFilesToStorage({ limit: 25 });
  revalidateDocuSign();
  return {
    ok: true,
    message: `Backfill: ${res.uploaded} uploaded, ${res.failed} failed (${res.processed} processed)`,
  };
}

export async function sendFromTemplateAction(input: {
  requestId?: string;
  templateId: string;
  entityId?: string | null;
  emailSubject: string;
  signerEmail: string;
  signerName: string;
  roleName?: string;
  scheduleReminders?: boolean;
}): Promise<DocuSignActionResult> {
  return sendFromTemplateRolesAction({
    templateId: input.templateId,
    requestId: input.requestId,
    entityId: input.entityId,
    emailSubject: input.emailSubject,
    roles: [
      {
        email: input.signerEmail,
        name: input.signerName,
        roleName: input.roleName || 'Signer',
      },
    ],
    scheduleReminders: input.scheduleReminders,
  });
}

export async function sendFromTemplateRolesAction(input: {
  requestId?: string;
  templateId: string;
  entityId?: string | null;
  emailSubject: string;
  roles: Array<{ email: string; name?: string; roleName: string }>;
  scheduleReminders?: boolean;
}): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;

  const templateId = input.templateId.trim();
  const entityId = input.entityId?.trim() || null;
  const signers = (input.roles ?? []).filter((r) => r.email?.trim());
  if (!templateId || signers.length === 0) {
    return { ok: false, error: 'templateId and at least one role email required' };
  }
  if (
    (!entityId &&
      !isFirmWideAccess(gate.profile.role, gate.profile.entity_id)) ||
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      entityId,
    )
  ) {
    return {
      ok: false,
      error: entityScopeDeniedMessage(entityId || 'firm-wide'),
    };
  }

  try {
    const { createEnvelopeFromTemplate } = await import(
      '@/lib/docusign/envelopes'
    );
    const {
      prepareDocuSignSendIntent,
      dispatchPreparedDocuSignSend,
    } = await import('@/lib/docusign/send-intents-repo');
    const normalizedRoles = signers.map((s) => ({
      email: s.email.trim(),
      name: (s.name || s.email).trim(),
      roleName: s.roleName?.trim() || 'Signer',
    }));
    const intent = await prepareDocuSignSendIntent({
      requestId: input.requestId,
      operationKind: 'template_send',
      entityId,
      templateId,
      emailSubject: input.emailSubject || 'Please sign',
      roles: normalizedRoles,
      explicitHumanApproval: true,
      actorId: gate.profile.id,
    });
    const created = await dispatchPreparedDocuSignSend({
      intent,
      dispatch: (leased) =>
        createEnvelopeFromTemplate({
          templateId,
          emailSubject: input.emailSubject || 'Please sign',
          signers: normalizedRoles,
          transactionId: leased.provider_transaction_id,
          intentId: leased.intent_id,
          entityId,
          operationKind: 'template_send',
        }),
    });

    if (input.scheduleReminders !== false) {
      const { enqueueEnvelopeReminders } = await import(
        '@/lib/docusign/reminder-jobs'
      );
      await enqueueEnvelopeReminders({ envelope_id: created.envelopeId });
    }

    void logActivity({
      module: 'documents',
      action: 'docusign_template_sent',
      title: `Template send: ${templateId.slice(0, 12)}… (${signers.length} roles)`,
      ref_type: 'document',
      ref_id: created.envelopeId,
    });

    revalidateDocuSign();
    return {
      ok: true,
      message: `Sent ${created.envelopeId} · ${signers.length} role(s)${
        input.scheduleReminders !== false ? ' · reminders queued' : ''
      }`,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'template send failed',
    };
  }
}

export async function emailCocAction(
  envelopeId: string,
): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;
  const id = envelopeId.trim();
  if (!id) return { ok: false, error: 'envelope_id required' };
  const scopeError = await envelopeScopeError(
    gate.profile.role,
    gate.profile.entity_id,
    id,
  );
  if (scopeError) return { ok: false, error: scopeError };
  const { emailCertificateOfCompletion } = await import(
    '@/lib/docusign/coc-email'
  );
  const res = await emailCertificateOfCompletion({
    envelope_id: id,
    include_ops: true,
  });
  if (!res.ok && !res.skipped) return { ok: false, error: res.detail };
  revalidateDocuSign();
  return { ok: true, message: res.detail };
}

export async function scheduleRemindersAction(
  envelopeId: string,
): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;
  const id = envelopeId.trim();
  if (!id) return { ok: false, error: 'envelope_id required' };
  const scopeError = await envelopeScopeError(
    gate.profile.role,
    gate.profile.entity_id,
    id,
  );
  if (scopeError) return { ok: false, error: scopeError };
  const { enqueueEnvelopeReminders } = await import(
    '@/lib/docusign/reminder-jobs'
  );
  const res = await enqueueEnvelopeReminders({ envelope_id: id });
  if (!res.ok) return res;
  revalidateDocuSign();
  return { ok: true, message: `Queued ${res.count} reminders for ${id}` };
}

export async function runReminderWorkerAction(): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;
  const { processDueReminderJobs } = await import(
    '@/lib/docusign/reminder-jobs'
  );
  const { processed } = await processDueReminderJobs({ limit: 20 });
  revalidateDocuSign();
  const ok = processed.filter((p) => p.ok).length;
  const fail = processed.filter((p) => !p.ok).length;
  return {
    ok: true,
    message: `Reminder worker: ${ok} ok, ${fail} failed`,
  };
}
