/**
 * notify-worker — welcome / BYOD privacy templates (sheet 16 / 07b).
 * Fail-open: email bounce must not block case close.
 * Full Graph/platform send is wired when PLATFORM_EMAIL credentials + channel ready.
 */

import { writeIdentityAudit } from '@/lib/identity/audit';

export type NotifyJobResult = {
  ok: boolean;
  detail: string;
  message_id?: string;
};

export async function handleNotifySend(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  template?: string;
  to?: string;
}): Promise<NotifyJobResult> {
  const template = payload.template || 'identity.company_welcome';
  const to = payload.to || '(undeliverable)';
  const messageId = `notify-dry-${payload.case_id}-${Date.now().toString(36)}`;

  await writeIdentityAudit({
    action: 'notify',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: `Notify ${template} → ${to}`,
    after: {
      template,
      to,
      mode: 'dry_run',
      message_id: messageId,
      copy:
        template === 'identity.byod_welcome'
          ? 'BYOD privacy: company may selectively wipe company data only'
          : 'Company device Day-1 setup',
    },
    source_system: 'notify',
    result: 'partial',
  });

  return {
    ok: true,
    message_id: messageId,
    detail: `dry_run: ${template}`,
  };
}
