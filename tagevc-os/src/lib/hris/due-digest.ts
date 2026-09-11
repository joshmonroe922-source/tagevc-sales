/**
 * HR onboarding due-today / due-soon cadence — in-app Alerts + optional daily email digest.
 */

import { entityDisplayName } from '@/lib/entities/display-name';
import { platformEmailAppUrl } from '@/lib/platform-email/config';
import { sendPlatformEmail } from '@/lib/platform-email/send';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeHrisNotifications } from './notify';
import {
  addDays,
  classifyHrisStepDue,
  HRIS_DUE_SOON_DAYS,
} from './timing';

export type HrisDueDigestResult = {
  scanned: number;
  due_today_count: number;
  due_soon_count: number;
  notifications_written: number;
  email_sent: boolean;
};

type StepRow = {
  id: string;
  title: string;
  due_at: string;
  status: string;
  owner_role: string;
  category: string;
  os_hris_process_runs: {
    kind: string;
    os_hris_employees: {
      id: string;
      full_name: string;
      entity_id: string;
    };
  };
};

/** Daily digest email is on unless explicitly disabled. */
export function hrisCadenceEmailEnabled(): boolean {
  const raw = (process.env.HRIS_CADENCE_EMAIL ?? '1').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

/** Comma-separated override; defaults to Josh work mail. */
export function hrisCadenceNotifyEmails(): string[] {
  const raw = process.env.HRIS_CADENCE_NOTIFY_EMAIL?.trim();
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes('@'));
  }
  return ['joshmonroe@tagevc.com'];
}

function formatDigestLine(row: StepRow): string {
  const emp = row.os_hris_process_runs.os_hris_employees;
  const company = entityDisplayName(String(emp.entity_id ?? 'ENT-FIRM'));
  const due = row.due_at.slice(0, 10);
  return `• ${emp.full_name} (${company}) — ${row.title} — due ${due} — ${row.owner_role}`;
}

export async function runHrisDueDigest(opts?: {
  today?: string;
  actorId?: string | null;
}): Promise<HrisDueDigestResult> {
  const today = opts?.today ?? new Date().toISOString().slice(0, 10);
  const result: HrisDueDigestResult = {
    scanned: 0,
    due_today_count: 0,
    due_soon_count: 0,
    notifications_written: 0,
    email_sent: false,
  };

  try {
    const sb = await createPersistClient();
    const horizon = addDays(today, HRIS_DUE_SOON_DAYS);

    const { data: steps } = await sb
      .from('os_hris_process_steps')
      .select(
        'id, title, due_at, status, owner_role, category, os_hris_process_runs!inner(kind, os_hris_employees!inner(id, full_name, entity_id))',
      )
      .gte('due_at', today)
      .lte('due_at', horizon)
      .in('status', ['pending', 'in_progress', 'blocked'])
      .limit(80);

    const rows = (steps ?? []) as unknown as StepRow[];
    result.scanned = rows.length;

    const dueTodayRows: StepRow[] = [];
    const dueSoonRows: StepRow[] = [];

    for (const row of rows) {
      const bucket = classifyHrisStepDue(
        { due_at: row.due_at, status: row.status },
        today,
      );
      if (bucket.due_today) {
        dueTodayRows.push(row);
        result.due_today_count += 1;
        const emp = row.os_hris_process_runs.os_hris_employees;
        const entityId = String(emp.entity_id ?? 'ENT-FIRM');
        const notify = await writeHrisNotifications({
          entity_id: entityId,
          alert_kind: 'hris_due_today',
          severity: 'warning',
          title: `[HRIS due today] ${emp.full_name} · ${row.title}`,
          body: `${entityDisplayName(entityId)} · ${row.owner_role} · due ${today}`,
          href: `/shared-services/hr/employees/${emp.id}`,
          step_id: row.id,
          window_key: `hris-due-today:${row.id}:${today}`,
          detail: { due_at: row.due_at, owner_role: row.owner_role },
        });
        result.notifications_written += notify.app_notifications;
      } else if (bucket.due_soon) {
        dueSoonRows.push(row);
        result.due_soon_count += 1;
      }
    }

    if (
      hrisCadenceEmailEnabled() &&
      (dueTodayRows.length > 0 || dueSoonRows.length > 0)
    ) {
      const emailWindow = `hris-digest-email:${today}`;
      const { data: priorDigest } = await sb
        .from('app_notifications')
        .select('notification_id')
        .like('notification_id', `hris:${emailWindow}:%`)
        .limit(1);

      if (!(priorDigest?.length ?? 0)) {
        const subjectParts = [
          dueTodayRows.length ? `${dueTodayRows.length} due today` : null,
          dueSoonRows.length ? `${dueSoonRows.length} due soon` : null,
        ].filter(Boolean);
        const subject = `[Tage OS] HR onboarding · ${subjectParts.join(' · ')}`;
        const appUrl = platformEmailAppUrl();
        const lines: string[] = [
          'HR onboarding checklist — daily cadence digest',
          '',
          `Date: ${today}`,
          '',
        ];
        if (dueTodayRows.length) {
          lines.push('Due today:', ...dueTodayRows.map(formatDigestLine), '');
        }
        if (dueSoonRows.length) {
          lines.push(
            `Due within ${HRIS_DUE_SOON_DAYS} days:`,
            ...dueSoonRows.map(formatDigestLine),
            '',
          );
        }
        lines.push(
          `Open onboarding: ${appUrl}/shared-services/hr/onboarding`,
          '',
          'Overdue steps escalate to P1 Help Desk tickets on the HRIS cadence worker.',
        );
        const text = lines.join('\n');
        const entityId =
          dueTodayRows[0]?.os_hris_process_runs.os_hris_employees.entity_id ??
          dueSoonRows[0]?.os_hris_process_runs.os_hris_employees.entity_id ??
          'ENT-FIRM';

        const res = await sendPlatformEmail({
          channel: 'system',
          entityId: String(entityId),
          to: hrisCadenceNotifyEmails(),
          subject,
          bodyText: text,
          bodyHtml: text.replace(/\n/g, '<br>\n'),
          source: 'system',
          track: false,
          activityModule: 'shared_services',
          tags: { kind: 'hris_cadence_digest', date: today },
        });
        result.email_sent = res.ok;

        if (result.email_sent) {
          const digestNotify = await writeHrisNotifications({
            entity_id: String(entityId),
            alert_kind: 'hris_due_digest',
            severity: 'info',
            title: subject,
            body: `${dueTodayRows.length} due today · ${dueSoonRows.length} due within ${HRIS_DUE_SOON_DAYS} days`,
            href: '/shared-services/hr/onboarding',
            window_key: emailWindow,
            detail: {
              due_today: dueTodayRows.length,
              due_soon: dueSoonRows.length,
              emailed: true,
            },
          });
          result.notifications_written += digestNotify.app_notifications;
        }
      }
    }
  } catch {
    /* fail-soft */
  }

  return result;
}
