import { NextResponse } from 'next/server';
import { assertWipeAllowed } from '@/lib/identity/wipe-guard';
import { assertAiActionAllowed } from '@/lib/identity/ai-policy';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeIdentityAudit } from '@/lib/identity/audit';
import { guardPermission } from '@/lib/rbac/session';

/** Preflight wipe / AI action guard — used by portal + workers. */
export async function POST(request: Request) {
  const gate = await guardPermission('write:it_assets');
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: 403 },
    );
  }
  const body = (await request.json()) as {
    action?: string;
    employee_id?: string;
    entity_id?: string;
    enrollment_type?: string;
    device_ownership?: string;
    actor?: 'human' | 'ai_cto';
    human_approved?: boolean;
    case_id?: string;
    correlation_id?: string;
  };

  const action = String(body.action || 'wipe');

  if (body.actor === 'ai_cto') {
    const ai = assertAiActionAllowed({
      action,
      human_approved: body.human_approved,
      case_linked: Boolean(body.case_id),
    });
    if (!ai.ok) {
      if (body.entity_id) {
        await writeIdentityAudit({
          action: 'ai_action_blocked',
          entity_id: body.entity_id,
          employee_id: body.employee_id,
          case_id: body.case_id,
          correlation_id: body.correlation_id,
          title: `AI blocked: ${action}`,
          error_code: ai.code,
          result: 'failure',
          source_system: 'portal',
          actor_type: 'ai_cto',
        });
      }
      return NextResponse.json(
        {
          ok: false as const,
          allowed: false as const,
          band: ai.band,
          code: ai.code,
          reason: ai.reason,
        },
        { status: 403 },
      );
    }
  }

  const ownership = body.device_ownership;
  if (!ownership && body.employee_id) {
    const sb = await createPersistClient();
    const { data } = await sb.rpc('identity_assert_wipe_allowed', {
      p_employee_id: body.employee_id,
      p_enrollment_type: body.enrollment_type ?? null,
      p_device_ownership: null,
    });
    const rpc = data as { allowed?: boolean; code?: string; reason?: string };
    if (rpc && rpc.allowed === false) {
      if (body.entity_id) {
        await writeIdentityAudit({
          action: 'byod_wipe_blocked',
          entity_id: body.entity_id,
          employee_id: body.employee_id,
          case_id: body.case_id,
          correlation_id: body.correlation_id,
          title: 'Wipe blocked (RPC)',
          error_code: rpc.code ?? 'byod_wipe_blocked',
          result: 'failure',
          source_system: 'portal',
        });
      }
      return NextResponse.json(
        {
          ok: false,
          allowed: false,
          code: rpc.code,
          reason: rpc.reason,
          money_auto_approve: false,
        },
        { status: 403 },
      );
    }
  }

  const guard = assertWipeAllowed({
    action,
    device_ownership: ownership,
    enrollment_type: body.enrollment_type,
  });

  if (!guard.allowed) {
    if (body.entity_id) {
      await writeIdentityAudit({
        action: 'byod_wipe_blocked',
        entity_id: body.entity_id,
        employee_id: body.employee_id,
        case_id: body.case_id,
        correlation_id: body.correlation_id,
        title: 'Wipe blocked',
        error_code: guard.code,
        result: 'failure',
        source_system: 'portal',
      });
    }
    return NextResponse.json(
      { ok: false, ...guard, money_auto_approve: false },
      { status: 403 },
    );
  }

  return NextResponse.json({
    ok: true,
    allowed: true,
    money_auto_approve: false as const,
  });
}
