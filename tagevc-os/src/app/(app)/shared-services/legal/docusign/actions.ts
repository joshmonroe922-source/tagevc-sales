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
import { z } from 'zod';

export type DocuSignActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function revalidateDocuSign() {
  revalidatePath('/shared-services/legal/docusign');
  revalidatePath('/documents');
}

export async function reconcileDocuSignAction(): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;
  const { reconcileDocuSignEnvelopes } = await import(
    '@/lib/docusign/reconciliation-repo'
  );
  const result = await reconcileDocuSignEnvelopes({
    trigger: 'manual',
    requestedBy: gate.profile.id,
    days: 30,
  });
  revalidateDocuSign();
  return result.ok
    ? {
        ok: true,
        message: `Reconciled ${result.seen} envelopes · ${result.matched} matched · ${result.manual_review} review`,
      }
    : { ok: false, error: result.error || 'Reconciliation failed' };
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
  const requestId =
    input.requestId?.trim() ||
    `DSR-${Date.now().toString(36).toUpperCase()}-${sourceEnvelopeId.slice(0, 8)}`;
  const sb = await createPersistClient();
  const { error: lineageIntentError } = await sb
    .from('os_docusign_envelope_lineage')
    .insert({
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
    });
  if (lineageIntentError) {
    return {
      ok: false,
      error: `Replacement intent rejected: ${lineageIntentError.message}`,
    };
  }
  const intent = await insertDocuSignEvent({
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
  if (!intent.ok) {
    await sb
      .from('os_docusign_envelope_lineage')
      .update({ status: 'failed', error: intent.error, updated_at: new Date().toISOString() })
      .eq('request_id', requestId);
    return {
      ok: false,
      error: `Replacement aborted because lineage intent could not be persisted: ${intent.error}`,
    };
  }
  try {
    const { createEnvelopeFromTemplate } = await import(
      '@/lib/docusign/envelopes'
    );
    const created = await createEnvelopeFromTemplate({
      templateId,
      emailSubject: input.emailSubject.trim() || 'Replacement signature request',
      signers: parsedRoles.data.map((role) => ({
        email: role.email,
        name: role.name || role.email,
        roleName: role.roleName,
      })),
    });
    const { error: lineageUpdateError } = await sb
      .from('os_docusign_envelope_lineage')
      .update({
        replacement_envelope_id: created.envelopeId,
        status: 'created',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('request_id', requestId)
      .eq('status', 'requested');
    if (lineageUpdateError) {
      return {
        ok: false,
        error: `Replacement ${created.envelopeId} was sent, but durable lineage finalization failed: ${lineageUpdateError.message}`,
      };
    }
    const audit = await insertDocuSignEvent({
      envelope_id: created.envelopeId,
      status: created.status,
      event_type: 'envelope-replacement-created',
      raw_payload: {
        source: 'hub',
        replacement_for_envelope_id: sourceEnvelopeId,
        templateId,
        actor_id: gate.profile.id,
        actor_email: gate.profile.email ?? null,
        request_id: requestId,
        roles: parsedRoles.data,
      },
    });
    if (!audit.ok) {
      return {
        ok: false,
        error: `Replacement ${created.envelopeId} was sent, but lineage audit failed: ${audit.error}`,
      };
    }
    const reciprocal = await insertDocuSignEvent({
      envelope_id: sourceEnvelopeId,
      status: 'replaced',
      event_type: 'envelope-replaced',
      raw_payload: {
        source: 'hub',
        replaced_by_envelope_id: created.envelopeId,
        templateId,
        actor_id: gate.profile.id,
        actor_email: gate.profile.email ?? null,
        request_id: requestId,
      },
    });
    if (!reciprocal.ok) {
      return {
        ok: false,
        error: `Replacement ${created.envelopeId} was sent, but reciprocal lineage failed: ${reciprocal.error}`,
      };
    }
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
        error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('request_id', requestId)
      .eq('status', 'requested');
    await insertDocuSignEvent({
      envelope_id: sourceEnvelopeId,
      status: 'replacement-failed',
      event_type: 'envelope-replacement-failed',
      doc_id: sourceContext.doc_id,
      entity_id: sourceContext.entity_id,
      deal_id: sourceContext.deal_id,
      ticket_id: sourceContext.ticket_id,
      raw_payload: {
        request_id: requestId,
        templateId,
        error: message,
        actor_id: gate.profile.id,
        actor_email: gate.profile.email ?? null,
      },
    });
    return {
      ok: false,
      error: message,
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
  templateId: string;
  emailSubject: string;
  signerEmail: string;
  signerName: string;
  roleName?: string;
  scheduleReminders?: boolean;
}): Promise<DocuSignActionResult> {
  return sendFromTemplateRolesAction({
    templateId: input.templateId,
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
  templateId: string;
  emailSubject: string;
  roles: Array<{ email: string; name?: string; roleName: string }>;
  scheduleReminders?: boolean;
}): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;

  const templateId = input.templateId.trim();
  const signers = (input.roles ?? []).filter((r) => r.email?.trim());
  if (!templateId || signers.length === 0) {
    return { ok: false, error: 'templateId and at least one role email required' };
  }

  try {
    const { createEnvelopeFromTemplate } = await import(
      '@/lib/docusign/envelopes'
    );
    const created = await createEnvelopeFromTemplate({
      templateId,
      emailSubject: input.emailSubject || 'Please sign',
      signers: signers.map((s) => ({
        email: s.email.trim(),
        name: (s.name || s.email).trim(),
        roleName: s.roleName?.trim() || 'Signer',
      })),
    });

    await insertDocuSignEvent({
      envelope_id: created.envelopeId,
      status: created.status,
      event_type: 'envelope-sent-from-template',
      raw_payload: {
        templateId,
        source: 'hub',
        roles: signers.map((s) => s.roleName),
      },
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
