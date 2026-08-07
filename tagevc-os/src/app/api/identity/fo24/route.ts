import { NextResponse } from 'next/server';
import { IDENTITY_CONTRACT_VERSION } from '@/lib/identity/types';
import {
  listEntityBootstrapTasks,
  seedEntityIdentityBootstrap,
} from '@/lib/identity/fo24';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

async function authorize(request: Request) {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('x-tagevc-digest-secret');
  const bearer = request.headers.get('authorization');
  const bearerOk =
    Boolean(secret) && Boolean(bearer) && bearer === `Bearer ${secret}`;
  if ((secret && header === secret) || bearerOk) {
    return { ok: true as const, source: 'cron' as const };
  }
  const gate = await guardPermission('write:it_assets');
  if (gate.ok) return { ok: true as const, source: 'admin' as const };
  return { ok: false as const, status: secret ? 401 : 403, error: gate.error || 'Unauthorized' };
}

/** FO §24 identity bootstrap for a new subsidiary entity. */
export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }
  const url = new URL(request.url);
  const entityId = url.searchParams.get('entity_id');
  if (!entityId) {
    return NextResponse.json(
      { ok: false, error: 'entity_id required' },
      { status: 400 },
    );
  }
  const tasks = await listEntityBootstrapTasks(entityId);
  return NextResponse.json({
    ...tasks,
    ok: true as const,
    contract_version: IDENTITY_CONTRACT_VERSION,
    entity_id: entityId,
    source: auth.source,
  });
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }
  try {
    const body = (await request.json()) as { entity_id?: string };
    if (!body.entity_id) {
      return NextResponse.json(
        { ok: false, error: 'entity_id required' },
        { status: 400 },
      );
    }
    const result = await seedEntityIdentityBootstrap(body.entity_id);
    return NextResponse.json({
      ...result,
      contract_version: IDENTITY_CONTRACT_VERSION,
      source: auth.source,
      need_human: [
        'Entra Administrative Unit create (Graph app + admin consent)',
        'Apple ADE / ABM token linkage',
        'Break-glass credential seal (dual control)',
        'CA / APP policy tenant apply (Security sign-off)',
      ],
    });
  } catch (e) {
    captureException(e, { route: 'identity/fo24 POST' });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'fo24 failed' },
      { status: 500 },
    );
  }
}
