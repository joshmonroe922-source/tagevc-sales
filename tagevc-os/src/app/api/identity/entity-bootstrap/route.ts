import { NextResponse } from 'next/server';
import { bootstrapEntityIdentity } from '@/lib/identity/fo24';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

/** FO §24 identity/device bootstrap for a new entity. */
export async function POST(request: Request) {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: 403 },
    );
  }
  try {
    const body = (await request.json()) as {
      entity_id?: string;
      email_domain?: string;
      default_usage_location?: string;
      byod_allowed?: boolean;
    };
    if (!body.entity_id) {
      return NextResponse.json(
        { ok: false, error: 'entity_id required' },
        { status: 400 },
      );
    }
    const result = await bootstrapEntityIdentity({
      entity_id: body.entity_id,
      email_domain: body.email_domain,
      default_usage_location: body.default_usage_location,
      byod_allowed: body.byod_allowed,
    });
    return NextResponse.json({
      ...result,
      money_auto_approve: false as const,
    });
  } catch (e) {
    captureException(e, { route: 'identity/entity-bootstrap POST' });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'bootstrap failed' },
      { status: 500 },
    );
  }
}
