import { NextResponse } from 'next/server';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { accountBootstrapKey } from '@/lib/spine/enrichment/jobs';
import { runDataQaPass } from '@/lib/spine/agents/data-qa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Daily stale refresh + data_qa enqueue (C10).
 * Auth: CRON_SECRET / DIGEST_SECRET bearer, or authenticated admin session.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET || '';
  const cronOk =
    Boolean(secret) &&
    (auth === `Bearer ${secret}` ||
      req.headers.get('x-vercel-cron') === '1');

  if (!cronOk) {
    const { getSessionContext } = await import('@/lib/rbac/session');
    const session = await getSessionContext();
    if (!session || session.profile.role !== 'visionary') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  const staleDays = Number(process.env.SPINE_STALE_DAYS || 90);
  const cutoff = new Date(
    Date.now() - staleDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const day = new Date().toISOString().slice(0, 10);

  try {
    const sb = await createPersistClient({ mode: 'service' });
    const { data: orgs } = await sb
      .from('organizations')
      .select('id, slug')
      .limit(20);

    let enqueued = 0;
    const qaReports: Array<{ org: string; flags: number }> = [];

    for (const org of orgs ?? []) {
      const { data: links } = await sb
        .from('account_org_links')
        .select('account_id')
        .eq('org_id', org.id)
        .limit(80);
      const ids = (links ?? []).map((l) => String(l.account_id));
      if (!ids.length) continue;

      const { data: stale } = await sb
        .from('accounts')
        .select('id')
        .in('id', ids)
        .or(`last_enriched_at.is.null,last_enriched_at.lt.${cutoff}`)
        .limit(25);

      for (const a of stale ?? []) {
        const key = `account.refresh_stale:${a.id}:${org.id}:${day}`;
        const { error } = await sb.from('enrichment_jobs').upsert(
          {
            org_id: org.id,
            type: 'account.refresh_stale',
            payload: { account_id: a.id, org_id: org.id },
            idempotency_key: key,
            account_id: a.id,
            status: 'queued',
          },
          { onConflict: 'idempotency_key' },
        );
        if (!error) enqueued += 1;
      }

      const qaKey = `agent.data_qa:${org.id}:${day}`;
      await sb.from('enrichment_jobs').upsert(
        {
          org_id: org.id,
          type: 'agent.data_qa',
          payload: { org_id: org.id },
          idempotency_key: qaKey,
          status: 'queued',
        },
        { onConflict: 'idempotency_key' },
      );

      // Inline light QA sample for cron response (report-only)
      const report = await runDataQaPass(sb, org.id, { limit: 20 });
      qaReports.push({ org: org.slug, flags: report.flags.length });
    }

    // also keep bootstrap key helper referenced for tree-shaking clarity
    void accountBootstrapKey;

    return NextResponse.json({
      ok: true,
      enqueued,
      staleDays,
      qaReports,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'stale refresh failed',
      },
      { status: 500 },
    );
  }
}
