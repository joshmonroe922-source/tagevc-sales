import { NextResponse } from 'next/server';
import { searchGraph } from '@/lib/spine/db/crud';
import { getSessionContext } from '@/lib/rbac/session';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get('q') || '';
  const result = await searchGraph(q, 20);
  return NextResponse.json({ ok: true, ...result });
}
