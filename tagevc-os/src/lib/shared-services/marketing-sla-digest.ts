/**
 * Marketing approval SLA escalation (Phases 28–30).
 * Finds content in review past approval_due_at and notifies + optional email.
 * Phase 30: per-assignee email digests when MARKETING_SLA_EMAIL_ASSIGNEES=1.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  createBroadcastNotification,
  logActivity,
} from '@/lib/data/activity';

export type SlaEscalationItem = {
  content_id: string;
  title: string;
  approval_due_at: string;
  approval_ticket_id: string | null;
  approval_assignee: string | null;
  entity_id: string | null;
  hours_overdue: number;
};

function looksLikeEmail(s: string | null | undefined): s is string {
  return Boolean(s && s.includes('@') && s.includes('.'));
}

async function sendResend(input: {
  to: string[];
  subject: string;
  text: string;
}): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey || input.to.length === 0) return false;
  const from = process.env.DIGEST_FROM_EMAIL || 'noreply@tagevc.com';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error('marketing SLA digest email failed', e);
    return false;
  }
}

export async function runApprovalSlaEscalation(opts?: {
  limit?: number;
  email?: boolean;
}): Promise<{
  overdue: number;
  notified: number;
  emailed: number;
  items: SlaEscalationItem[];
  error?: string;
}> {
  const limit = opts?.limit ?? 40;
  const now = new Date();
  const sb = await createPersistClient();

  const { data, error } = await sb
    .from('os_marketing_content')
    .select(
      'content_id, title, approval_due_at, approval_ticket_id, approval_assignee, entity_id, status',
    )
    .eq('status', 'review')
    .not('approval_due_at', 'is', null)
    .lt('approval_due_at', now.toISOString())
    .order('approval_due_at', { ascending: true })
    .limit(limit);

  if (error) {
    return {
      overdue: 0,
      notified: 0,
      emailed: 0,
      items: [],
      error: error.message,
    };
  }

  const defaultAssignee = process.env.MARKETING_SLA_ASSIGNEE?.trim() || null;
  const items: SlaEscalationItem[] = (data ?? []).map((row) => {
    const due = new Date(String(row.approval_due_at));
    const hours = Math.max(
      0,
      Math.round((now.getTime() - due.getTime()) / (60 * 60 * 1000)),
    );
    return {
      content_id: String(row.content_id),
      title: String(row.title ?? row.content_id),
      approval_due_at: String(row.approval_due_at),
      approval_ticket_id: (row.approval_ticket_id as string) ?? null,
      approval_assignee:
        ((row.approval_assignee as string) || defaultAssignee) ?? null,
      entity_id: (row.entity_id as string) ?? null,
      hours_overdue: hours,
    };
  });

  if (items.length === 0) {
    return { overdue: 0, notified: 0, emailed: 0, items };
  }

  const lines = items
    .slice(0, 15)
    .map(
      (i) =>
        `· ${i.content_id}: ${i.title.slice(0, 60)} (${i.hours_overdue}h overdue)${
          i.approval_assignee ? ` → ${i.approval_assignee}` : ''
        }${i.approval_ticket_id ? ` · ${i.approval_ticket_id}` : ''}`,
    )
    .join('\n');

  const assigneeHint =
    items.find((i) => i.approval_assignee)?.approval_assignee || null;

  await createBroadcastNotification({
    kind: 'marketing_sla',
    title: `Marketing approval SLA: ${items.length} overdue${
      assigneeHint ? ` · ${assigneeHint}` : ''
    }`,
    body: lines.slice(0, 500),
    href: '/shared-services/marketing',
  });

  void logActivity({
    module: 'shared_services',
    action: 'marketing_sla_escalation',
    title: `Approval SLA escalation: ${items.length} overdue`,
    ref_type: 'ticket',
    ref_id: items[0]?.approval_ticket_id ?? items[0]?.content_id,
  });

  let emailed = 0;
  const wantEmail = opts?.email !== false;
  const emailAssignees =
    process.env.MARKETING_SLA_EMAIL_ASSIGNEES === '1' ||
    process.env.MARKETING_SLA_EMAIL_ASSIGNEES === 'true';

  if (wantEmail) {
    if (emailAssignees) {
      const byAssignee = new Map<string, SlaEscalationItem[]>();
      for (const item of items) {
        const key = item.approval_assignee || '__ops__';
        const list = byAssignee.get(key) ?? [];
        list.push(item);
        byAssignee.set(key, list);
      }
      for (const [assignee, group] of byAssignee) {
        const groupLines = group
          .map(
            (i) =>
              `· ${i.content_id}: ${i.title.slice(0, 60)} (${i.hours_overdue}h overdue)`,
          )
          .join('\n');
        const recipients: string[] = [];
        if (looksLikeEmail(assignee)) recipients.push(assignee);
        const ops =
          process.env.MARKETING_SLA_DIGEST_TO?.trim() ||
          process.env.DIGEST_TO_EMAIL?.trim();
        if (assignee === '__ops__' && ops) {
          recipients.push(
            ...ops.split(',').map((s) => s.trim()).filter(Boolean),
          );
        } else if (ops && !looksLikeEmail(assignee)) {
          // Named assignee without email — include ops copy
          recipients.push(
            ...ops.split(',').map((s) => s.trim()).filter(Boolean),
          );
        }
        if (recipients.length === 0) continue;
        const ok = await sendResend({
          to: [...new Set(recipients)],
          subject: `[Tage VC] Marketing SLA · ${group.length} overdue${
            assignee !== '__ops__' ? ` · ${assignee}` : ''
          }`,
          text: `Approval SLA overdue items${
            assignee !== '__ops__' ? ` for ${assignee}` : ''
          }:\n\n${groupLines}\n\nhttps://app.tagevc.com/shared-services/marketing`,
        });
        if (ok) emailed += 1;
      }
    } else {
      const to =
        process.env.MARKETING_SLA_DIGEST_TO?.trim() ||
        process.env.DIGEST_TO_EMAIL?.trim();
      if (to) {
        const ok = await sendResend({
          to: to.split(',').map((s) => s.trim()).filter(Boolean),
          subject: `[Tage VC] Marketing approval SLA: ${items.length} overdue`,
          text: `The following marketing content is past approval SLA:\n\n${lines}\n\nhttps://app.tagevc.com/shared-services/marketing`,
        });
        if (ok) emailed = 1;
      }
    }
  }

  const ids = items.map((i) => i.content_id);
  await sb
    .from('os_marketing_content')
    .update({
      approval_escalated_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .in('content_id', ids)
    .is('approval_escalated_at', null);

  return {
    overdue: items.length,
    notified: 1,
    emailed,
    items,
  };
}
