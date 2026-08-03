import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/rbac/session';
import {
  countPendingSuggestions,
  decideSuggestedUpdate,
} from '@/lib/spine/db/crud';
import { createPersistClient } from '@/lib/supabase/persist-client';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  if (url.searchParams.get('count') === '1') {
    const count = await countPendingSuggestions();
    return NextResponse.json({ ok: true, count });
  }
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('suggested_updates')
      .select(
        'id, entity_type, entity_id, field_name, suggested_value, confidence, status, rationale, created_at',
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, rows: data ?? [] });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'suggestions_failed',
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    status?: 'accepted' | 'rejected';
  };
  if (!body.id || (body.status !== 'accepted' && body.status !== 'rejected')) {
    return NextResponse.json(
      { ok: false, error: 'id and status required' },
      { status: 400 },
    );
  }
  const result = await decideSuggestedUpdate({
    id: body.id,
    status: body.status,
    userProfileId: session.profile.id,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
