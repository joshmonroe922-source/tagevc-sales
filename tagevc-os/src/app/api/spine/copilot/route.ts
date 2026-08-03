import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/rbac/session';
import { SPINE_AGENTS } from '@/lib/spine/agents/catalog';
import { generateAccountBrief } from '@/lib/spine/agents/brief';
import { searchGraph } from '@/lib/spine/db/crud';

export const runtime = 'nodejs';

/**
 * Tool-gated copilot (C10) — no send_email, no paid enrich.
 * Tools: search, brief, list_agents.
 */
export async function POST(req: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    tool?: string;
    account_id?: string;
    q?: string;
  };

  const tool = (body.tool || '').trim();
  if (tool === 'list_agents') {
    return NextResponse.json({
      ok: true,
      agents: SPINE_AGENTS,
      forbid: ['send_email', 'docusign_capital_send', 'paid_enrich_without_LIVE'],
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

  return NextResponse.json(
    {
      ok: false,
      error: 'unknown_tool',
      allowed: ['list_agents', 'search', 'brief'],
    },
    { status: 400 },
  );
}
