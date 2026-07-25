/**
 * Controlled DocuSign send from HRIS offer/NDA steps.
 * Always requires explicit human confirmation. No silent sends.
 */

import { randomUUID } from 'crypto';
import { createEnvelope } from '@/lib/docusign/envelopes';
import { getDocuSignMode, isDocuSignConfigured } from '@/lib/docusign/config';
import {
  dispatchPreparedDocuSignSend,
  prepareDocuSignSendIntent,
} from '@/lib/docusign/send-intents-repo';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeAuditEvent } from '@/lib/audit/write';
import type { HrisEmployee, HrisProcessStep } from '@/lib/hris/types';
import { addEmployeeLink } from '@/lib/hris/employees';

export async function sendHrisStepViaDocuSign(input: {
  employee: HrisEmployee;
  step: HrisProcessStep;
  actorId: string;
  actorEmail: string;
  explicitHumanConfirm: boolean;
  signerName?: string;
  signerEmail?: string;
  documentText?: string;
}): Promise<
  | {
      ok: true;
      envelope_id: string;
      mode: 'live' | 'mock';
      detail: string;
    }
  | { ok: false; error: string }
> {
  if (!input.explicitHumanConfirm) {
    return {
      ok: false,
      error: 'Human confirmation required before DocuSign send',
    };
  }

  const signerEmail =
    input.signerEmail?.trim() ||
    input.employee.personal_email ||
    input.employee.work_email;
  const signerName =
    input.signerName?.trim() || input.employee.full_name || 'New hire';
  if (!signerEmail) {
    return { ok: false, error: 'Signer email required' };
  }

  const subject = `${input.step.title} · ${input.employee.full_name}`;
  const content =
    input.documentText?.trim() ||
    [
      input.step.title,
      '',
      `Employee: ${input.employee.full_name}`,
      `Company entity: ${input.employee.entity_id}`,
      `Role: ${input.employee.role_title}`,
      `Start: ${input.employee.start_date ?? 'TBD'}`,
      '',
      'Sent from Tage HRIS with explicit human confirmation.',
    ].join('\n');

  try {
    const intent = await prepareDocuSignSendIntent({
      requestId: `hris-${input.step.id}-${randomUUID().slice(0, 8)}`,
      operationKind: 'document_send',
      docId: `HRIS-${input.step.step_key}-${input.employee.id.slice(0, 8)}`,
      entityId: input.employee.entity_id,
      emailSubject: subject,
      content,
      explicitHumanApproval: true,
      actorId: input.actorId,
    });

    let envelopeId: string;
    const mode = getDocuSignMode();

    if (isDocuSignConfigured()) {
      const result = await dispatchPreparedDocuSignSend({
        intent,
        dispatch: (leased) =>
          createEnvelope({
            emailSubject: subject,
            documentName: `${input.step.step_key}.txt`,
            documentText: content,
            signers: [{ name: signerName, email: signerEmail }],
            status: 'sent',
            transactionId: leased.provider_transaction_id,
            intentId: leased.intent_id,
            entityId: input.employee.entity_id,
            operationKind: 'document_send',
            docId: `HRIS-${input.step.id}`,
          }),
      });
      envelopeId = result.envelopeId;
    } else {
      const result = await dispatchPreparedDocuSignSend({
        intent,
        dispatch: async (leased) => ({
          envelopeId: `ENV-HRIS-${leased.request_id.slice(0, 8)}`,
          status: 'sent',
          raw: { mode: 'mock' },
        }),
      });
      envelopeId = result.envelopeId;
    }

    const sb = await createPersistClient();
    await sb.from('os_hris_documents').insert({
      employee_id: input.employee.id,
      step_id: input.step.id,
      kind: input.step.step_key.includes('nda') ? 'nda' : 'offer',
      title: subject,
      file_name: `${input.step.step_key}.txt`,
      mime_type: 'text/plain',
      byte_size: content.length,
      storage_path: `docusign://${envelopeId}`,
      uploaded_by: input.actorId,
      docusign_envelope_id: envelopeId,
      docusign_status: 'sent',
      detail: { mode, step_key: input.step.step_key },
    });

    await addEmployeeLink({
      employee_id: input.employee.id,
      kind: 'document',
      ref_id: envelopeId,
      label: `DocuSign · ${input.step.title}`,
      href: `/shared-services/legal/docusign`,
    });

    await writeAuditEvent({
      action: 'hris_action',
      title: `HRIS DocuSign send · ${input.step.title}`,
      object_type: 'docusign_envelope',
      object_id: envelopeId,
      entity_id: input.employee.entity_id,
      metadata: {
        step_id: input.step.id,
        employee_id: input.employee.id,
        mode,
        explicit_human_confirm: true,
      },
    });

    return {
      ok: true,
      envelope_id: envelopeId,
      mode: mode === 'live' ? 'live' : 'mock',
      detail: `DocuSign ${mode} send ${envelopeId} to ${signerEmail}`,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'DocuSign send failed',
    };
  }
}
