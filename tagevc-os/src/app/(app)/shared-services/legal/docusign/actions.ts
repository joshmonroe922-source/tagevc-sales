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

export type DocuSignActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

function revalidateDocuSign() {
  revalidatePath('/shared-services/legal/docusign');
  revalidatePath('/documents');
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
  sourceEnvelopeId: string;
  templateId: string;
  emailSubject: string;
  signerEmail: string;
  signerName: string;
  roleName?: string;
}): Promise<DocuSignActionResult> {
  const gate = await guardPermission('write:documents');
  if (!gate.ok) return gate;
  const sourceEnvelopeId = input.sourceEnvelopeId.trim();
  const templateId = input.templateId.trim();
  if (!sourceEnvelopeId || !templateId || !input.signerEmail.trim()) {
    return {
      ok: false,
      error: 'Source envelope, template, and signer email are required',
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
    },
  });
  if (!intent.ok) {
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
      signers: [
        {
          email: input.signerEmail.trim(),
          name: input.signerName.trim() || input.signerEmail.trim(),
          roleName: input.roleName?.trim() || 'Signer',
        },
      ],
    });
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
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Replacement send failed',
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
  return { ok: true, message: `Synced ${res.count} templates` };
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
