import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/rbac/session';
import { SPINE_AGENTS } from '@/lib/spine/agents/catalog';
import { generateAccountBrief } from '@/lib/spine/agents/brief';
import { searchGraph } from '@/lib/spine/db/crud';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { accountBootstrapKey } from '@/lib/spine/enrichment/jobs';
import { getActiveOrgSlug } from '@/lib/spine/auth/active-org';
import { resolveOrgIdBySlug } from '@/lib/spine/db/repos';

export const runtime = 'nodejs';

/**
 * Tool-gated copilot (C10) — no send_email, no capital DocuSign.
 * Tools: search, brief, list_agents, jobs.enqueue (refresh/bootstrap).
 */
export async function POST(req: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    tool?: string;
    account_id?: string;
    contact_id?: string;
    q?: string;
    job_type?: string;
  };

  const tool = (body.tool || '').trim();
  if (tool === 'list_agents') {
    return NextResponse.json({
      ok: true,
      agents: SPINE_AGENTS,
      forbid: ['send_email', 'docusign_capital_send', 'paid_enrich_without_LIVE'],
      allowed: ['list_agents', 'search', 'brief', 'jobs.enqueue'],
    });
  }

  if (tool === 'search') {
    const result = await searchGraph(body.q || '', 12);
    return NextResponse.json({ ok: true, ...result });
  }

  if (tool === 'brief') {
    if (!body.account_id) {
      return NextResponse.json(
        { ok: false, error: 'account_id required' },
        { status: 400 },
      );
    }
    const brief = await generateAccountBrief(body.account_id);
    return NextResponse.json(brief, { status: brief.ok ? 200 : 400 });
  }

  if (tool === 'jobs.enqueue') {
    const orgId = await resolveOrgIdBySlug(await getActiveOrgSlug());
    if (!orgId) {
      return NextResponse.json(
        { ok: false, error: 'org missing — apply phase94' },
        { status: 400 },
      );
    }
    const jobType = (body.job_type || 'account.bootstrap').trim();
    const allowed = new Set([
      'account.bootstrap',
      'account.enrich',
      'account.refresh_stale',
      'contact.enrich',
      'contact.bootstrap',
      'agent.data_qa',
    ]);
    if (!allowed.has(jobType)) {
      return NextResponse.json(
        { ok: false, error: 'job_type not allowed', allowed: [...allowed] },
        { status: 400 },
      );
    }
    if (
      (jobType.startsWith('account.') || jobType === 'account.refresh_stale') &&
      jobType !== 'agent.data_qa' &&
      !body.account_id
    ) {
      return NextResponse.json(
        { ok: false, error: 'account_id required' },
        { status: 400 },
      );
    }
    if (jobType.startsWith('contact.') && !body.contact_id) {
      return NextResponse.json(
        { ok: false, error: 'contact_id required' },
        { status: 400 },
      );
    }

    const sb = await createPersistClient({ mode: 'service' });
    const day = new Date().toISOString().slice(0, 10);
    const key =
      body.account_id && jobType.startsWith('account.')
        ? accountBootstrapKey(body.account_id, orgId, day).replace(
            'account.bootstrap',
            jobType,
          )
        : `${jobType}:${body.contact_id || body.account_id || 'org'}:${orgId}:${day}`;

    const { data: job, error } = await sb
      .from('enrichment_jobs')
      .upsert(
        {
          org_id: orgId,
          type: jobType,
          payload: {
            account_id: body.account_id || null,
            contact_id: body.contact_id || null,
            org_id: orgId,
            expand: jobType === 'account.bootstrap',
            enqueued_by: 'copilot',
          },
          idempotency_key: key,
          account_id: body.account_id || null,
          contact_id: body.contact_id || null,
          status: 'queued',
        },
        { onConflict: 'idempotency_key' },
      )
      .select('id, status, type')
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      job,
      note: 'Queued — worker drains; paid providers still fail-closed without LIVE keys',
    });
  }

  if (tool === 'send_email') {
    return NextResponse.json(
      { ok: false, error: 'tool_denied', tool: 'send_email' },
      { status: 403 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: 'unknown_tool',
      allowed: ['list_agents', 'search', 'brief', 'jobs.enqueue'],
    },
    { status: 400 },
  );
}
