/**
 * DocuSign scheduled reminder jobs (Phase 27).
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getEnvelopeStatus,
  remindEnvelope,
} from '@/lib/docusign/envelopes';

export type ReminderJob = {
  job_id: string;
  envelope_id: string;
  doc_id: string | null;
  entity_id: string | null;
  status: string;
  scheduled_for: string;
  attempts: number;
  last_error: string | null;
};

function id(): string {
  return `DRJ-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4)}`;
}

/** Enqueue default reminder cadence (+1d, +3d, +7d) for an envelope. */
export async function enqueueEnvelopeReminders(input: {
  envelope_id: string;
  doc_id?: string | null;
  entity_id?: string | null;
  offsetsDays?: number[];
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const days = input.offsetsDays ?? [1, 3, 7];
  try {
    const sb = await createPersistClient();
    const now = Date.now();
    let count = 0;
    for (const d of days) {
      const scheduled_for = new Date(now + d * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await sb.from('os_docusign_reminder_jobs').insert({
        job_id: id(),
        envelope_id: input.envelope_id,
        doc_id: input.doc_id ?? null,
        entity_id: input.entity_id ?? null,
        status: 'pending',
        scheduled_for,
        attempts: 0,
        updated_at: new Date().toISOString(),
      });
      if (!error) count += 1;
    }
    return { ok: true, count };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'enqueue failed',
    };
  }
}

export async function listReminderJobs(limit = 30): Promise<{
  rows: ReminderJob[];
  error?: string;
}> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_docusign_reminder_jobs')
      .select(
        'job_id, envelope_id, doc_id, entity_id, status, scheduled_for, attempts, last_error',
      )
      .order('scheduled_for', { ascending: true })
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((r) => ({
        job_id: String(r.job_id),
        envelope_id: String(r.envelope_id),
        doc_id: (r.doc_id as string) ?? null,
        entity_id: (r.entity_id as string) ?? null,
        status: String(r.status),
        scheduled_for: String(r.scheduled_for),
        attempts: Number(r.attempts ?? 0),
        last_error: (r.last_error as string) ?? null,
      })),
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'list failed',
    };
  }
}

export async function processDueReminderJobs(opts?: {
  limit?: number;
  force?: boolean;
}): Promise<{
  processed: Array<{ job_id: string; ok: boolean; detail?: string }>;
}> {
  const limit = opts?.limit ?? 20;
  const nowIso = new Date().toISOString();
  const sb = await createPersistClient();
  const { data: jobs } = await sb
    .from('os_docusign_reminder_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(limit);

  const processed: Array<{ job_id: string; ok: boolean; detail?: string }> = [];

  for (const raw of jobs ?? []) {
    const job = raw as Record<string, unknown>;
    const jobId = String(job.job_id);
    const envelopeId = String(job.envelope_id);
    const attempts = Number(job.attempts ?? 0) + 1;

    await sb
      .from('os_docusign_reminder_jobs')
      .update({ status: 'running', attempts, updated_at: nowIso })
      .eq('job_id', jobId);

    try {
      if (!envelopeId.startsWith('ENV-')) {
        const status = await getEnvelopeStatus(envelopeId);
        if (
          ['completed', 'voided', 'declined'].includes(status.status)
        ) {
          await sb
            .from('os_docusign_reminder_jobs')
            .update({
              status: 'cancelled',
              last_error: `Envelope already ${status.status}`,
              updated_at: nowIso,
            })
            .eq('job_id', jobId);
          processed.push({
            job_id: jobId,
            ok: true,
            detail: `skipped (${status.status})`,
          });
          continue;
        }
      }

      const rem = await remindEnvelope(envelopeId);
      if (!rem.ok) {
        await sb
          .from('os_docusign_reminder_jobs')
          .update({
            status: 'failed',
            last_error: rem.error,
            updated_at: nowIso,
          })
          .eq('job_id', jobId);
        processed.push({ job_id: jobId, ok: false, detail: rem.error });
        continue;
      }

      await sb
        .from('os_docusign_reminder_jobs')
        .update({
          status: 'succeeded',
          last_error: null,
          updated_at: nowIso,
        })
        .eq('job_id', jobId);
      processed.push({ job_id: jobId, ok: true, detail: 'reminded' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'reminder failed';
      await sb
        .from('os_docusign_reminder_jobs')
        .update({
          status: 'failed',
          last_error: msg,
          updated_at: nowIso,
        })
        .eq('job_id', jobId);
      processed.push({ job_id: jobId, ok: false, detail: msg });
    }
  }

  return { processed };
}
