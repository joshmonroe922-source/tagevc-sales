/** Escalate overdue HRIS process steps to HR tickets. */

import {
  createTicket,
  hydrateTicketStore,
  listTickets,
} from '@/lib/data/ticket-store';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { entityDisplayName } from '@/lib/entities/display-name';
import { appendEmployeeEvent } from './employees';
import { isStepOverdue } from './timing';

export type HrisEscalateResult = {
  scanned: number;
  created: number;
  skipped: number;
  ticket_ids: string[];
};

export async function escalateOverdueHrisSteps(opts?: {
  limit?: number;
  actorId?: string | null;
}): Promise<HrisEscalateResult> {
  const result: HrisEscalateResult = {
    scanned: 0,
    created: 0,
    skipped: 0,
    ticket_ids: [],
  };

  try {
    await hydrateTicketStore();
    const sb = await createPersistClient();
    const today = new Date().toISOString().slice(0, 10);

    const { data: steps } = await sb
      .from('os_hris_process_steps')
      .select(
        'id, run_id, title, due_at, status, escalated_ticket_id, owner_role, category, os_hris_process_runs!inner(id, kind, employee_id, escalated_ticket_id, os_hris_employees!inner(id, full_name, entity_id, work_email))',
      )
      .lt('due_at', today)
      .in('status', ['pending', 'in_progress', 'blocked'])
      .limit(opts?.limit ?? 50);

    const rows = steps ?? [];
    result.scanned = rows.length;
    const existing = listTickets();

    for (const raw of rows) {
      const row = raw as Record<string, unknown>;
      if (row.escalated_ticket_id) {
        result.skipped += 1;
        continue;
      }
      if (
        !isStepOverdue({
          due_at: row.due_at ? String(row.due_at) : null,
          status: String(row.status),
        }, today)
      ) {
        result.skipped += 1;
        continue;
      }

      const run = row.os_hris_process_runs as Record<string, unknown>;
      const emp = run.os_hris_employees as Record<string, unknown>;
      const entityId = String(emp.entity_id ?? 'ENT-FIRM');
      const company = entityDisplayName(entityId);
      const empName = String(emp.full_name ?? 'Employee');
      const title = `[HRIS overdue] ${empName} · ${row.title}`;
      const already = existing.find(
        (t) =>
          t.title === title &&
          t.status !== 'Closed' &&
          t.status !== 'Resolved',
      );
      if (already) {
        await sb
          .from('os_hris_process_steps')
          .update({
            escalated_ticket_id: already.ticket_id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        result.skipped += 1;
        continue;
      }

      const ticket = createTicket({
        title,
        description: `Overdue ${String(run.kind)} step for ${empName} at ${company}. Owner: ${row.owner_role}. Due ${String(row.due_at).slice(0, 10)}. Category: ${row.category}.`,
        service: 'HR',
        priority: 'P1',
        entity_id: entityId,
        company_name: company,
        requester_name: 'HRIS cadence',
        desired_outcome: `Complete or waive step: ${row.title}`,
        links: `/shared-services/hr/employees/${emp.id}`,
      });

      await sb
        .from('os_hris_process_steps')
        .update({
          escalated_ticket_id: ticket.ticket_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      await sb
        .from('os_hris_process_runs')
        .update({
          escalated_ticket_id: ticket.ticket_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', run.id);

      await appendEmployeeEvent({
        employee_id: String(emp.id),
        event_kind: 'escalated',
        summary: `Escalated overdue step to ticket · ${row.title}`,
        detail: { ticket_id: ticket.ticket_id, step_id: row.id },
        actor_id: opts?.actorId,
      });

      result.created += 1;
      result.ticket_ids.push(ticket.ticket_id);
      existing.push(ticket);
    }
  } catch {
    /* return partial */
  }

  return result;
}
