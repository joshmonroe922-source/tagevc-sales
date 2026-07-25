/**
 * Narrow AUTO executors for allow-listed ticket actions.
 * Prefer retries / documentation / reversible flags over writes.
 * Never money, legal send, permissions, HR termination, or credit-file mutation.
 */

import { writeAuditEvent } from '@/lib/audit/write';
import type { AllowAction } from '@/lib/types';

export type AutoExecResult = {
  result: 'success' | 'partial' | 'failed' | 'skipped';
  detail: string;
  /** Safe steps recorded for the ticket proposed_actions array. */
  steps: Array<{ code: string; status: string; note: string }>;
};

export async function executeAllowListedAction(input: {
  action: AllowAction | string;
  ticketId: string;
  title: string;
  entityId: string | null;
}): Promise<AutoExecResult> {
  const code = input.action as AllowAction;
  const base = {
    ticket_id: input.ticketId,
    action: code,
    entity_id: input.entityId,
  };

  switch (code) {
    case 'document_known_fix':
    case 'draft_status_summary':
    case 'sla_nudge':
    case 'tag_ticket_service':
    case 'route_inbound_form':
    case 'spawn_missing_stage_tasks': {
      await writeAuditEvent({
        action: 'ticket_action',
        title: `AUTO ${code} · ${input.ticketId}`,
        object_type: 'ticket',
        object_id: input.ticketId,
        entity_id: input.entityId,
        metadata: { ...base, mode: 'logged_only_v1' },
      });
      return {
        result: 'success',
        detail: `Logged allow-listed action "${code}" (v1: audit + status progression; side-effect executors expand later).`,
        steps: [
          {
            code,
            status: 'logged',
            note: 'Safe bookkeeping / draft / nudge — no money/legal/HR write.',
          },
        ],
      };
    }
    case 'retry_failed_parse': {
      await writeAuditEvent({
        action: 'ticket_action',
        title: `AUTO retry_failed_parse · ${input.ticketId}`,
        object_type: 'ticket',
        object_id: input.ticketId,
        entity_id: input.entityId,
        metadata: { ...base, mode: 'retry_queued' },
      });
      return {
        result: 'partial',
        detail:
          'Parse retry queued via audit. Operator can re-upload; AUTO does not invent scores.',
        steps: [
          {
            code,
            status: 'queued',
            note: 'Re-parse only — never fabricate FICO / business scores.',
          },
        ],
      };
    }
    case 'retry_noncritical_webhook': {
      await writeAuditEvent({
        action: 'ticket_action',
        title: `AUTO retry_noncritical_webhook · ${input.ticketId}`,
        object_type: 'ticket',
        object_id: input.ticketId,
        entity_id: input.entityId,
        metadata: { ...base, mode: 'retry_noted' },
      });
      return {
        result: 'partial',
        detail: 'Non-critical webhook retry noted. Repeated failure stays DRAFT/ESCALATE.',
        steps: [{ code, status: 'noted', note: 'Safe retry path only.' }],
      };
    }
    case 'clear_stale_cache_flag': {
      await writeAuditEvent({
        action: 'ticket_action',
        title: `AUTO clear_stale_cache_flag · ${input.ticketId}`,
        object_type: 'ticket',
        object_id: input.ticketId,
        entity_id: input.entityId,
        metadata: { ...base, mode: 'flag_clear_logged' },
      });
      return {
        result: 'success',
        detail: 'Stale-cache clear recorded (reversible flag).',
        steps: [{ code, status: 'cleared', note: 'No destructive write.' }],
      };
    }
    default:
      return {
        result: 'skipped',
        detail: `Action "${input.action}" is not on the narrow AUTO executor map.`,
        steps: [],
      };
  }
}

/** Persist a lightweight metric row (fail-soft). */
export async function recordAutomationMetric(input: {
  metricKey: string;
  ticketId?: string | null;
  value?: number;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { createPersistClient } = await import('@/lib/supabase/persist-client');
    const sb = await createPersistClient();
    await sb.from('os_automation_metrics').insert({
      metric_key: input.metricKey,
      metric_value: input.value ?? 1,
      ticket_id: input.ticketId ?? null,
      detail: input.detail ?? {},
    });
  } catch {
    /* fail-soft */
  }
}
