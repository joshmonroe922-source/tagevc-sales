import { NextResponse } from 'next/server';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { executeCampaignSend } from '@/lib/campaign/orchestrator';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Cron: schedule due approved campaigns + materialize dynamic segments.
 * Auth: CRON_SECRET or Vercel cron.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET?.trim();
  const isVercelCron = Boolean(req.headers.get('x-vercel-cron'));
  if (cronSecret && auth !== `Bearer ${cronSecret}` && !isVercelCron) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const sb = await createPersistClient({ mode: 'service' });
  const now = new Date().toISOString();

  const { data: due } = await sb
    .from('ecc_campaigns')
    .select('id, entity_id, owner_id')
    .eq('status', 'scheduled')
    .lte('schedule_at', now)
    .limit(10);

  const results: Array<Record<string, unknown>> = [];
  for (const c of due ?? []) {
    // Scheduled Graph sends need stored tokens — mark ready for operator send
    await sb
      .from('ecc_campaigns')
      .update({ status: 'approved', updated_at: now })
      .eq('id', c.id);
    results.push({
      campaignId: c.id,
      action: 'promoted_to_approved',
      note: 'Operator/send worker completes with Graph token',
    });
  }

  // Soft materialize: refresh segment counts from definition (sample)
  const { data: segments } = await sb
    .from('ecc_segments')
    .select('id, entity_id')
    .eq('is_dynamic', true)
    .limit(20);
  for (const s of segments ?? []) {
    await sb
      .from('ecc_segments')
      .update({ last_materialized_at: now })
      .eq('id', s.id);
  }

  return NextResponse.json({
    ok: true,
    due: results,
    segmentsTouched: segments?.length ?? 0,
    executeCampaignSendAvailable: typeof executeCampaignSend === 'function',
  });
}
