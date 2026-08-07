/**
 * Identity worker dispatcher — drains identity_worker_jobs with idempotency.
 */

import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  handleEntraUserDisable,
  handleEntraUserUpsert,
} from '@/lib/identity/workers/entra';
import {
  handleByodEnsureMam,
  handleByodRetire,
  handleByodSelectiveWipe,
  handleDeviceAssignUser,
  handleIntuneDeviceWipe,
} from '@/lib/identity/workers/intune';
import {
  handleEntitlementMaterialize,
  handleEntitlementRevokeAll,
} from '@/lib/identity/workers/entitlements';
import { handleNotifySend } from '@/lib/identity/workers/notify';
import type { HrisHiredBody } from '@/lib/identity/types';
import { assertAiActionAllowed } from '@/lib/identity/ai-policy';

type JobRow = {
  id: string;
  command: string;
  entity_id: string;
  employee_id: string | null;
  case_id: string | null;
  correlation_id: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
};

async function recordIdempotency(
  key: string,
  entityId: string,
  correlationId: string,
  response: Record<string, unknown>,
) {
  const sb = await createPersistClient();
  await sb.from('integration_idempotency').upsert(
    {
      idempotency_key: key,
      entity_id: entityId,
      correlation_id: correlationId,
      response_ref: response,
      request_hash: key,
      expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
    },
    { onConflict: 'idempotency_key' },
  );
}

async function dispatchOne(job: JobRow): Promise<{
  ok: boolean;
  result: Record<string, unknown>;
  error?: string;
  dead_letter?: boolean;
}> {
  if (job.payload?.actor_type === 'ai_cto') {
    const gate = assertAiActionAllowed({
      action: job.command,
      human_approved: Boolean(job.payload.human_approved),
      case_linked: Boolean(job.case_id),
    });
    if (!gate.ok) {
      return {
        ok: false,
        dead_letter: true,
        error: gate.reason,
        result: { code: gate.code, band: gate.band },
      };
    }
  }

  const base = {
    employee_id: String(job.employee_id ?? job.payload.employee_id ?? ''),
    entity_id: job.entity_id,
    case_id: String(job.case_id ?? job.payload.case_id ?? ''),
    correlation_id: job.correlation_id,
  };

  switch (job.command) {
    case 'entra.user.upsert': {
      const r = await handleEntraUserUpsert({
        ...base,
        hired: job.payload.hired as HrisHiredBody,
        device_path: job.payload.device_path as string | undefined,
      });
      return { ok: r.ok, result: r as unknown as Record<string, unknown>, error: r.ok ? undefined : r.detail };
    }
    case 'entra.user.disable': {
      const r = await handleEntraUserDisable({
        ...base,
        revoke_sessions: Boolean(job.payload.revoke_sessions ?? true),
      });
      return { ok: r.ok, result: r as unknown as Record<string, unknown>, error: r.ok ? undefined : r.detail };
    }
    case 'entitlement.materialize': {
      const r = await handleEntitlementMaterialize({
        ...base,
        primary_role_id: String(job.payload.primary_role_id ?? ''),
        secondary_role_ids: (job.payload.secondary_role_ids as string[]) ?? [],
        hired: job.payload.hired as HrisHiredBody | undefined,
      });
      return { ok: r.ok, result: r as unknown as Record<string, unknown> };
    }
    case 'entitlement.revoke_all': {
      const r = await handleEntitlementRevokeAll(base);
      return { ok: r.ok, result: r as unknown as Record<string, unknown> };
    }
    case 'intune.byod.ensure_mam': {
      const r = await handleByodEnsureMam({
        ...base,
        platforms: (job.payload.platforms as string[]) ?? [],
        byod_enforcement_level: job.payload.byod_enforcement_level as
          | string
          | null
          | undefined,
        device_path: job.payload.device_path as
          | 'company_mdm'
          | 'byod_mam'
          | 'byod_mam_mdm'
          | 'none'
          | undefined,
      });
      return { ok: r.ok, result: r as unknown as Record<string, unknown>, error: r.ok ? undefined : r.detail };
    }
    case 'intune.byod.selective_wipe': {
      const r = await handleByodSelectiveWipe(base);
      return { ok: r.ok, result: r as unknown as Record<string, unknown> };
    }
    case 'intune.byod.retire': {
      const r = await handleByodRetire(base);
      return { ok: r.ok, result: r as unknown as Record<string, unknown>, error: r.ok ? undefined : r.detail };
    }
    case 'intune.device.wipe': {
      const r = await handleIntuneDeviceWipe({
        ...base,
        device_ownership: job.payload.device_ownership as string | undefined,
      });
      return {
        ok: r.ok,
        dead_letter: Boolean(r.blocked),
        result: r as unknown as Record<string, unknown>,
        error: r.ok ? undefined : r.detail,
      };
    }
    case 'intune.device.assign_user': {
      const r = await handleDeviceAssignUser({
        ...base,
        hired: job.payload.hired as { device_preference?: string | null },
      });
      return { ok: r.ok, result: r as unknown as Record<string, unknown> };
    }
    case 'notify.send': {
      const r = await handleNotifySend({
        ...base,
        template: job.payload.template as string | undefined,
        to: job.payload.to as string | undefined,
      });
      return { ok: r.ok, result: r as unknown as Record<string, unknown> };
    }
    default:
      return {
        ok: false,
        error: `Unknown command ${job.command}`,
        result: { command: job.command },
      };
  }
}

export async function runIdentityWorkerBatch(opts?: {
  limit?: number;
  commands?: string[];
}): Promise<{
  claimed: number;
  succeeded: number;
  failed: number;
  blocked: number;
}> {
  const sb = await createPersistClient();
  const workerId = `identity-worker-${randomUUID().slice(0, 8)}`;
  const { data: jobs, error } = await sb.rpc('claim_identity_worker_jobs', {
    p_worker_id: workerId,
    p_commands: opts?.commands ?? null,
    p_limit: opts?.limit ?? 10,
    p_lease_seconds: 90,
  });

  if (error) {
    throw new Error(error.message);
  }

  let succeeded = 0;
  let failed = 0;
  let blocked = 0;
  const rows = (jobs ?? []) as JobRow[];

  for (const job of rows) {
    const started = Date.now();
    try {
      const out = await dispatchOne(job);
      await sb.rpc('finish_identity_worker_job', {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_ok: out.ok,
        p_result: out.result,
        p_error: out.error ?? null,
        p_dead_letter: Boolean(out.dead_letter),
      });
      await recordIdempotency(
        job.idempotency_key,
        job.entity_id,
        job.correlation_id,
        out.result,
      );
      await sb.from('identity_activity_events').insert({
        job_id: job.id,
        worker: workerId,
        duration_ms: Date.now() - started,
        retry_count: 0,
        entity_id: job.entity_id,
        correlation_id: job.correlation_id,
        detail: { command: job.command, ok: out.ok },
      });
      if (out.ok) succeeded += 1;
      else if (out.dead_letter) blocked += 1;
      else failed += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'dispatch failed';
      await sb.rpc('finish_identity_worker_job', {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_ok: false,
        p_result: null,
        p_error: msg,
        p_dead_letter: false,
      });
      failed += 1;
    }
  }

  return { claimed: rows.length, succeeded, failed, blocked };
}
