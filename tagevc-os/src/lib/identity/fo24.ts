/**
 * FO §24 new-entity identity bootstrap (sheet 21).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeIdentityAudit } from '@/lib/identity/audit';

/** Alias used by entity-bootstrap API (FO §24 phases 4/5/7/8). */
export async function bootstrapEntityIdentity(input: {
  entity_id: string;
  email_domain?: string | null;
  default_usage_location?: string | null;
  byod_allowed?: boolean;
}): Promise<{
  ok: boolean;
  correlation_id?: string;
  tasks: Array<{ task_key: string; status: string }>;
  needs_human: string[];
  error?: string;
}> {
  const sb = await createPersistClient();
  if (input.email_domain || input.default_usage_location != null || input.byod_allowed != null) {
    await sb
      .from('entities')
      .update({
        email_domain: input.email_domain ?? undefined,
        default_usage_location: input.default_usage_location ?? undefined,
        byod_allowed: input.byod_allowed ?? undefined,
      })
      .eq('entity_id', input.entity_id);
  }
  const seeded = await seedEntityIdentityBootstrap(input.entity_id);
  const listed = seeded.ok
    ? await listEntityBootstrapTasks(input.entity_id)
    : { ok: false as const, tasks: [] as Array<Record<string, unknown>> };
  const rows = listed.tasks as Array<Record<string, unknown>>;
  const needs_human = rows
    .filter((t) => t.status === 'needs_human')
    .map((t) => String(t.task_key));
  return {
    ok: seeded.ok,
    error: seeded.error,
    correlation_id: undefined,
    tasks: rows.map((t) => ({
      task_key: String(t.task_key),
      status: String(t.status),
    })),
    needs_human,
  };
}

export async function seedEntityIdentityBootstrap(entityId: string): Promise<{
  ok: boolean;
  tasks?: number;
  error?: string;
  detail?: Record<string, unknown>;
}> {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('identity_seed_entity_bootstrap', {
    p_entity_id: entityId,
  });
  if (error) return { ok: false, error: error.message };

  const detail = (data ?? {}) as Record<string, unknown>;
  if (detail.ok === false) {
    return { ok: false, error: String(detail.error ?? 'seed failed'), detail };
  }

  // Best-effort local config stamps (Graph AU/scope tags need NEED_HUMAN)
  await sb
    .from('entities')
    .update({
      intune_scope_tag: `scope-${entityId.toLowerCase()}`,
      identity_bootstrap_status: 'in_progress',
    })
    .eq('entity_id', entityId);

  await writeIdentityAudit({
    action: 'fo24_bootstrap',
    entity_id: entityId,
    title: `FO§24 identity bootstrap seeded for ${entityId}`,
    after: detail,
    source_system: 'orchestrator',
  });

  return {
    ok: true,
    tasks: typeof detail.tasks === 'number' ? detail.tasks : undefined,
    detail,
  };
}

export async function listEntityBootstrapTasks(entityId: string) {
  const sb = await createPersistClient();
  const { data, error } = await sb
    .from('identity_entity_bootstrap_tasks')
    .select('*')
    .eq('entity_id', entityId)
    .order('fo24_phase', { ascending: true });
  if (error) return { ok: false as const, error: error.message, tasks: [] };
  return { ok: true as const, tasks: data ?? [] };
}
