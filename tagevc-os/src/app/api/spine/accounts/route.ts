import { NextResponse } from 'next/server';
import { createAccount } from '@/lib/spine/db/crud';
import { getSessionContext } from '@/lib/rbac/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const result = await createAccount({
    name: String(body.name || ''),
    domain: body.domain ? String(body.domain) : null,
    website: body.website ? String(body.website) : null,
    orgSlug: body.org_slug ? String(body.org_slug) : 'tage',
    expand: body.expand !== false,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: 422 });
  }
  return NextResponse.json({
    ok: true,
    account: { id: result.accountId },
    job_id: result.jobId,
  });
}
