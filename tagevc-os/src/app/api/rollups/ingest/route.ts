import { NextResponse } from 'next/server';

import { createPersistClient } from '@/lib/supabase/persist-client';

/**
 * Recruit Phase 34 rollups → Tage ingest.
 * Auth: Authorization Bearer === TAGE_ROLLUP_SECRET
 */
function authorize(request: Request): boolean {
  const secret = process.env.TAGE_ROLLUP_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return token === secret;
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const entityId =
    typeof payload.entityId === 'string' ? payload.entityId : 'ENT-R619';

  try {
    const admin = await createPersistClient();
    const { error } = await admin.from('os_recruit_feed_metrics').insert({
      entity_id: entityId,
      as_of: new Date().toISOString(),
      payload,
      source: 'recruit_portal',
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'persist unavailable',
        stub: true,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, entityId });
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const admin = await createPersistClient();
    const { data, error } = await admin
      .from('os_recruit_feed_metrics')
      .select('*')
      .eq('entity_id', 'ENT-R619')
      .order('as_of', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, latest: data });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'unavailable',
      },
      { status: 503 },
    );
  }
}
