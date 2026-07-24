/**
 * Auto-escalate overdue high/critical SSC checklist tasks into Shared Services tickets.
 * Dedupes via evidence_ticket_id. Never moves money or sends legal docs.
 */

import {
  createTicket,
  hydrateTicketStore,
  listTickets,
} from '@/lib/data/ticket-store';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { companyName } from './scope';
import type { SscFunction } from './types';
import { functionLabel } from './types';

function serviceFor(fn: SscFunction) {
  switch (fn) {
    case 'finance':
      return 'Finance' as const;
    case 'hr':
      return 'HR' as const;
    case 'it':
      return 'IT' as const;
    case 'marketing':
      return 'Marketing' as const;
    case 'legal':
      return 'Legal' as const;
  }
}

export type EscalateResult = {
  scanned: number;
  created: number;
  skipped: number;
  ticket_ids: string[];
};

export async function escalateOverdueSscTasks(opts?: {
  actorId?: string | null;
  limit?: number;
}): Promise<EscalateResult> {
  const result: EscalateResult = {
    scanned: 0,
    created: 0,
    skipped: 0,
    ticket_ids: [],
  };

  try {
    await hydrateTicketStore();
    const supabase = await createPersistClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data: tasks } = await supabase
      .from('os_ssc_checklist_tasks')
      .select(
        'id, instance_id, title, description, function_key, entity_id, due_date, status, risk_level, evidence_ticket_id, owner_role',
      )
      .lt('due_date', today)
      .in('status', ['not_started', 'in_progress', 'blocked'])
      .in('risk_level', ['high', 'critical'])
      .limit(opts?.limit ?? 40);

    const rows = tasks ?? [];
    result.scanned = rows.length;
    const existing = listTickets();

    for (const row of rows) {
      if (row.evidence_ticket_id) {
        result.skipped += 1;
        continue;
      }

      const entityId = (row.entity_id as string) || 'ENT-FIRM';
      const titleMarker = `[SSC overdue] ${row.title}`;
      const already = existing.find(
        (t) =>
          t.status !== 'Closed' &&
          t.status !== 'Resolved' &&
          t.entity_id === entityId &&
          t.title.includes(String(row.title)),
      );
      if (already) {
        await supabase
          .from('os_ssc_checklist_tasks')
          .update({
            evidence_ticket_id: already.ticket_id,
            ai_suggestion: `Escalated earlier as ${already.ticket_id}. Complete checklist task or update ticket.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        result.skipped += 1;
        continue;
      }

      try {
        const fn = row.function_key as SscFunction;
        const ticket = createTicket({
          title: titleMarker,
          description: [
            'Auto-escalated from Shared Services Center checklist (Phase 66).',
            `Company: ${companyName(entityId)}`,
            `Function: ${functionLabel(fn)}`,
            `Owner role: ${row.owner_role}`,
            `Due: ${row.due_date}`,
            `Risk: ${row.risk_level}`,
            '',
            String(row.description ?? ''),
            '',
            'Human confirmation required for high-risk actions. No autonomous money movement or legal send/sign.',
            `Checklist task: ${row.id}`,
            'Open: /shared-services/checklists',
          ].join('\n'),
          desired_outcome:
            'Clear the overdue SSC checklist item and attach evidence',
          service: serviceFor(fn),
          priority: row.risk_level === 'critical' ? 'P0' : 'P1',
          requester_name: 'SSC automation',
          entity_id: entityId,
          company_name: companyName(entityId),
          links: '/shared-services/checklists',
          assignee_name: String(row.owner_role ?? 'service_lead'),
          ai_generated: true,
        });

        await supabase
          .from('os_ssc_checklist_tasks')
          .update({
            evidence_ticket_id: ticket.ticket_id,
            evidence_url: `/shared-services/tickets/${ticket.ticket_id}`,
            automation_source: 'auto',
            ai_suggestion: `Escalated to ${ticket.ticket_id}. Resolve ticket evidence, then mark checklist done.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        await supabase.from('os_ssc_checklist_task_events').insert({
          task_id: row.id,
          instance_id: row.instance_id,
          event_kind: 'overdue_mark',
          note: `Escalated to ticket ${ticket.ticket_id}`,
          actor_id: opts?.actorId ?? null,
          detail: { ticket_id: ticket.ticket_id, auto: true },
        });

        // Best-effort ops alert row if phase59 table exists
        try {
          await supabase.from('os_notification_phase59_ops_alerts').insert({
            entity_id: entityId,
            severity: row.risk_level === 'critical' ? 'critical' : 'high',
            title: titleMarker,
            body: `SSC overdue escalation → ${ticket.ticket_id}`,
            route_kind: 'owner_routed',
            destination_key: 'ops_alerts',
            meta: {
              ticket_id: ticket.ticket_id,
              ssc_task_id: row.id,
              source: 'ssc_phase66',
            },
          });
        } catch {
          // table shape may differ — fail-soft
        }

        result.created += 1;
        result.ticket_ids.push(ticket.ticket_id);
      } catch {
        result.skipped += 1;
      }
    }
  } catch {
    // fail-soft
  }

  return result;
}
