/**
 * HRIS assist: apply (or prepare) entity email signature for onboarding step sd.email_sig.
 */

import {
  applyEntityEmailSignature,
  type ApplySignatureResult,
} from '@/lib/brand/email-signatures';
import type { HrisEmployee } from '@/lib/hris/types';
import { writeAuditEvent } from '@/lib/audit/write';

export const EMAIL_SIGNATURE_STEP_KEY = 'sd.email_sig';
export const EMAIL_SIGNATURE_HOOK = 'email_signature';

export type EmailSignatureAssistResult = {
  handled: boolean;
  detail: string;
  evidence_note?: string;
  evidence_url?: string | null;
};

export async function runEmailSignatureAssist(
  emp: HrisEmployee,
): Promise<EmailSignatureAssistResult> {
  const email = (emp.work_email || emp.personal_email || '').trim();
  if (!email) {
    return {
      handled: true,
      detail: 'No work/personal email on employee — cannot build signature',
    };
  }

  const result: ApplySignatureResult = await applyEntityEmailSignature({
    fullName: emp.full_name,
    jobTitle: emp.role_title,
    email,
    phone: emp.phone,
    entityId: emp.entity_id,
  });

  await writeAuditEvent({
    action: 'hris_action',
    title: `Email signature · ${emp.full_name}`,
    object_type: 'employee',
    object_id: emp.id,
    entity_id: emp.entity_id,
    metadata: {
      mode: result.mode,
      detail: result.detail,
      html_len: result.html?.length ?? 0,
    },
  });

  const evidence =
    result.mode === 'need_human' || result.mode === 'dry_run'
      ? `${result.detail}\n\n--- signature HTML ready (${result.html?.length ?? 0} chars) — paste into Outlook or run EXO Set-MailboxMessageConfiguration ---\n`
      : result.detail;

  return {
    handled: true,
    detail: result.detail,
    evidence_note: evidence,
    evidence_url: '/documents',
  };
}

export function isEmailSignatureStep(input: {
  step_key: string;
  system_hook: string | null;
}): boolean {
  return (
    input.step_key === EMAIL_SIGNATURE_STEP_KEY ||
    input.system_hook === EMAIL_SIGNATURE_HOOK
  );
}
