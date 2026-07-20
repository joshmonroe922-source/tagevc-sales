'use server';

import { revalidatePath } from 'next/cache';
import { applyDocuSignWebhook } from '@/lib/data/document-store';
import { insertDocuSignEvent } from '@/lib/docusign/events-repo';
import { remindEnvelope, voidEnvelope } from '@/lib/docusign/envelopes';
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
  if (!id) return { ok: false, error: 'envelope_id required' };

  const api = await voidEnvelope(id, reason || 'Voided via Tage VC OS');
  if (!api.ok) return api;

  try {
    applyDocuSignWebhook({ envelope_id: id, status: 'voided' });
  } catch {
    // Envelope may be Connect-only / unknown locally
  }

  await insertDocuSignEvent({
    envelope_id: id,
    status: 'voided',
    event_type: 'envelope-voided',
    raw_payload: { reason, source: 'hub' },
  });

  void logActivity({
    module: 'documents',
    action: 'docusign_voided',
    title: `Envelope voided: ${id.slice(0, 18)}`,
    ref_type: 'document',
    ref_id: id,
  });

  revalidateDocuSign();
  return { ok: true, message: `Voided ${id}` };
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
