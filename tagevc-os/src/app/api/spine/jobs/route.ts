import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/rbac/session';
import { listRecentEnrichmentJobs } from '@/lib/spine/db/crud';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { accountBootstrapKey } from '@/lib/spine/enrichment/jobs';
import { resolveOrgIdBySlug } from '@/lib/spine/db/repos';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const jobs = await listRecentEnrichmentJobs(12);
  if (url.searchParams.get('active') === '1') {
    return NextResponse.json({
      ok: true,
      jobs: jobs.filter(
        (j) => j.status === 'queued' || j.status === 'running',
      ),
    });
  }
  return NextResponse.json({ ok: true, jobs });
}

/** Enqueue account.bootstrap refresh (works with mock worker; LIVE providers later). */
export async function POST(req: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    account_id?: string;
    org_slug?: string;
  };
  if (!body.account_id) {
    return NextResponse.json(
      { ok: false, error: 'account_id required' },
      { status: 400 },
    );
  }
  const orgId = await resolveOrgIdBySlug(body.org_slug || 'tage');
  if (!orgId) {
    return NextResponse.json(
      { ok: false, error: 'org missing' },
      { status: 400 },
    );
  }
  try {
    const sb = await createPersistClient();
    const key = accountBootstrapKey(body.account_id, orgId);
    const { data, error } = await sb
      .from('enrichment_jobs')
      .upsert(
        {
          org_id: orgId,
          type: 'account.bootstrap',
          account_id: body.account_id,
          status: 'queued',
          idempotency_key: `${key}:${new Date().toISOString().slice(0, 13)}`,
          payload: { account_id: body.account_id, refresh: true },
          progress_pct: 0,
          progress_message: 'queued from CRM',
        },
        { onConflict: 'idempotency_key' },
      )
      .select('id')
      .maybeSingle();
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, jobId: data?.id ?? null });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'enqueue_failed' },
      { status: 500 },
    );
  }
}
