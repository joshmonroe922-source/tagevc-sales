import { NextResponse } from 'next/server';
import {
  defaultLifecycleChecklist,
  leaverRevokeOrder,
  MS_P5_CONTRACT_VERSION,
  type LifecycleKind,
} from '@/lib/multi-sub/lifecycle';
import { resolveCanonicalEntityId } from '@/lib/multi-sub/entity-registry';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';
import { createPersistClient } from '@/lib/supabase/persist-client';

async function authorize(request: Request): Promise<
  | { ok: true; source: 'cron' | 'admin' }
  | { ok: false; status: number; error: string }
> {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('x-tagevc-digest-secret');
  const bearer = request.headers.get('authorization');
  const bearerOk =
    Boolean(secret) && Boolean(bearer) && bearer === `Bearer ${secret}`;
  if ((secret && header === secret) || bearerOk) {
    return { ok: true, source: 'cron' };
  }
  const gate = await guardPermission('write:it_assets');
  if (gate.ok) return { ok: true, source: 'admin' };
  if (secret) return { ok: false, status: 401, error: 'Unauthorized' };
  return { ok: false, status: 403, error: gate.error };
}

/** Identity lifecycle control center (P5) — list + start joiner/mover/leaver. */
export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, money_auto_approve: false },
      { status: auth.status },
    );
  }
  try {
    const sb = await createPersistClient();
    const primary = await sb.rpc('list_identity_lifecycle_control_center', {
      p_limit: 50,
    });
    if (!primary.error && primary.data) {
      return NextResponse.json({
        ok: true,
        source: auth.source,
        money_auto_approve: false as const,
        ...(primary.data as Record<string, unknown>),
        revoke_first_order: leaverRevokeOrder(),
      });
    }
    const { data, error } = await sb.rpc(
      'list_identity_lifecycle_control_center_ms_p5',
      { p_limit: 50 },
    );
    if (error) {
      return NextResponse.json({
        ok: true,
        source: auth.source,
        money_auto_approve: false as const,
        contract_version: MS_P5_CONTRACT_VERSION,
        feed_status: 'missing' as const,
        todo: 'TODO: apply phase97_identity_device_lifecycle.sql',
        runs: [],
        failed_steps: [],
        revoke_first_order: leaverRevokeOrder(),
        rpc_error: error.message,
        phase97_error: primary.error?.message,
      });
    }
    return NextResponse.json({
      ok: true,
      source: auth.source,
      money_auto_approve: false as const,
      ...(data as Record<string, unknown>),
      revoke_first_order: leaverRevokeOrder(),
    });
  } catch (e) {
    captureException(e, { route: 'identity/lifecycle GET' });
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'list failed',
        money_auto_approve: false,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error, money_auto_approve: false },
      { status: auth.status },
    );
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const kind = String(body.lifecycle_kind ?? '').toLowerCase() as LifecycleKind;
    if (!['joiner', 'mover', 'leaver'].includes(kind)) {
      return NextResponse.json(
        { ok: false, error: 'lifecycle_kind must be joiner|mover|leaver' },
        { status: 400 },
      );
    }
    const entity =
      resolveCanonicalEntityId(
        (body.home_entity_id as string) ||
          (body.target_entity_id as string) ||
          null,
      ) ?? 'ENT-FIRM';

    const sb = await createPersistClient();
    const { data, error } = await sb.rpc('start_identity_lifecycle_ms_p5', {
      p_kind: kind,
      p_user_id: body.user_id ?? null,
      p_email: body.email ?? null,
      p_home_entity_id: entity,
      p_previous_entity_id: body.previous_entity_id ?? null,
      p_target_entity_id: body.target_entity_id ?? entity,
      p_target_role: body.target_role ?? null,
      p_ticket_id: body.ticket_id ?? null,
      p_source: body.source ?? 'api',
      p_microsoft_oid: body.microsoft_oid ?? null,
      p_actor_id: body.actor_id ?? null,
    });

    // Best-effort: sync messaging home membership when user_id known.
    // Profile trigger also covers joiner/mover updates of entity_id/active.
    let messagingSync: unknown = null;
    const userId =
      typeof body.user_id === 'string' && body.user_id.length > 0
        ? body.user_id
        : null;
    if (userId && (kind === 'joiner' || kind === 'mover' || kind === 'leaver')) {
      const { data: syncData, error: syncError } = await sb.rpc(
        'sync_messaging_membership_for_profile_ms_p3b',
        { p_user_id: userId },
      );
      messagingSync = syncError
        ? { ok: false, error: syncError.message }
        : syncData;
    }

    if (error) {
      // Fail-soft contract preview when SQL not applied
      const checklist = defaultLifecycleChecklist(kind, entity);
      return NextResponse.json({
        ok: true,
        preview: true,
        money_auto_approve: false as const,
        contract_version: MS_P5_CONTRACT_VERSION,
        lifecycle_kind: kind,
        home_entity_id: entity,
        checklist,
        messaging_sync: messagingSync,
        // TODO: apply phase_ms_p5 for durable runs
        todo: 'TODO: apply phase_ms_p5 SQL — returning checklist preview only',
        rpc_error: error.message,
        source: auth.source,
      });
    }

    return NextResponse.json({
      ok: true,
      money_auto_approve: false as const,
      source: auth.source,
      ...(data as Record<string, unknown>),
      messaging_sync: messagingSync,
      checklist_preview: defaultLifecycleChecklist(kind, entity),
    });
  } catch (e) {
    captureException(e, { route: 'identity/lifecycle POST' });
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'start failed',
        money_auto_approve: false,
      },
      { status: 500 },
    );
  }
}
