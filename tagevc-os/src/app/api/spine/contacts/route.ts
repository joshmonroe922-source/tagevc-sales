import { NextResponse } from 'next/server';
import { createContact } from '@/lib/spine/db/crud';
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
  const result = await createContact({
    fullName: String(body.full_name || body.name || ''),
    email: body.email ? String(body.email) : null,
    title: body.title ? String(body.title) : null,
    accountId: body.account_id ? String(body.account_id) : null,
    orgSlug: body.org_slug ? String(body.org_slug) : 'tage',
    linkedinUrl: body.linkedin_url ? String(body.linkedin_url) : null,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: 422 });
  }
  return NextResponse.json({ ok: true, contact: { id: result.contactId } });
}
