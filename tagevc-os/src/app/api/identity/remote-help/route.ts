import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeIdentityAudit } from '@/lib/identity/audit';
import { guardPermission } from '@/lib/rbac/session';

/** Attended Remote Help only — unattended forbidden in v1. */
export async function POST(request: Request) {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: 403 },
    );
  }
  const body = (await request.json()) as {
    entity_id?: string;
    employee_id?: string;
    device_ref?: string;
    mode?: string;
    helper_profile_id?: string;
  };
  if (!body.entity_id) {
    return NextResponse.json(
      { ok: false, error: 'entity_id required' },
      { status: 400 },
    );
  }
  if (body.mode && body.mode !== 'attended') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Unattended Remote Help forbidden in v1',
        code: 'unattended_remote_help',
      },
      { status: 403 },
    );
  }

  const sb = await createPersistClient();
  const id = randomUUID();
  const { error } = await sb.from('identity_remote_help_sessions').insert({
    id,
    entity_id: body.entity_id,
    employee_id: body.employee_id ?? null,
    helper_profile_id: body.helper_profile_id ?? null,
    device_ref: body.device_ref ?? null,
    mode: 'attended',
    status: 'consent_pending',
  });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  await writeIdentityAudit({
    action: 'needs_human',
    entity_id: body.entity_id,
    employee_id: body.employee_id,
    title: 'Remote Help session requested (attended, consent pending)',
    object_type: 'remote_help',
    object_id: id,
    source_system: 'portal',
  });

  return NextResponse.json({
    ok: true,
    session_id: id,
    mode: 'attended',
    status: 'consent_pending',
    money_auto_approve: false as const,
  });
}
