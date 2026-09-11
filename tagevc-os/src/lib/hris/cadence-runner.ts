/** HRIS cadence worker — retime + escalate. */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { runHrisDueDigest } from './due-digest';
import { escalateOverdueHrisSteps } from './escalate';
import { retimeAllOpenRuns } from './runs';

export type HrisCadenceKind = 'full' | 'timing' | 'escalate' | 'digest';

export type HrisCadenceResult = {
  ok: boolean;
  run_kind: HrisCadenceKind;
  steps_retimed: number;
  escalations_created: number;
  notifications_written: number;
  due_today_notified: number;
  due_soon_in_digest: number;
  digest_email_sent: boolean;
  ticket_ids: string[];
  error?: string;
};

export async function runHrisCadence(opts: {
  run_kind?: HrisCadenceKind;
  trigger_source?: 'cron' | 'manual' | 'api';
  actor_id?: string | null;
}): Promise<HrisCadenceResult> {
  const kind = opts.run_kind ?? 'full';
  const result: HrisCadenceResult = {
    ok: true,
    run_kind: kind,
    steps_retimed: 0,
    escalations_created: 0,
    notifications_written: 0,
    due_today_notified: 0,
    due_soon_in_digest: 0,
    digest_email_sent: false,
    ticket_ids: [],
  };

  let cadenceId: string | null = null;
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_hris_cadence_runs')
      .insert({
        run_kind: kind,
        trigger_source: opts.trigger_source ?? 'manual',
        actor_id: opts.actor_id ?? null,
      })
      .select('run_id')
      .single();
    cadenceId = data?.run_id ? String(data.run_id) : null;

    if (kind === 'full' || kind === 'timing') {
      result.steps_retimed = await retimeAllOpenRuns();
    }
    if (kind === 'full' || kind === 'escalate') {
      const esc = await escalateOverdueHrisSteps({
        actorId: opts.actor_id,
      });
      result.escalations_created = esc.created;
      result.notifications_written += esc.notifications;
      result.ticket_ids = esc.ticket_ids;
    }
    if (kind === 'full' || kind === 'digest') {
      const digest = await runHrisDueDigest({ actorId: opts.actor_id });
      result.due_today_notified = digest.due_today_count;
      result.due_soon_in_digest = digest.due_soon_count;
      result.notifications_written += digest.notifications_written;
      result.digest_email_sent = digest.email_sent;
    }

    if (cadenceId) {
      await sb
        .from('os_hris_cadence_runs')
        .update({
          finished_at: new Date().toISOString(),
          ok: true,
          steps_retimed: result.steps_retimed,
          escalations_created: result.escalations_created,
          detail: {
            ticket_ids: result.ticket_ids,
            notifications_written: result.notifications_written,
            due_today_notified: result.due_today_notified,
            due_soon_in_digest: result.due_soon_in_digest,
            digest_email_sent: result.digest_email_sent,
          },
        })
        .eq('run_id', cadenceId);
    }
  } catch (e) {
    result.ok = false;
    result.error = e instanceof Error ? e.message : 'Cadence failed';
    if (cadenceId) {
      try {
        const sb = await createPersistClient();
        await sb
          .from('os_hris_cadence_runs')
          .update({
            finished_at: new Date().toISOString(),
            ok: false,
            detail: { error: result.error },
          })
          .eq('run_id', cadenceId);
      } catch {
        /* soft */
      }
    }
  }

  return result;
}
