import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import type { IdentityAuditAction } from '@/lib/identity/types';

export async function writeIdentityAudit(input: {
  action: IdentityAuditAction | string;
  title: string;
  entity_id: string;
  employee_id?: string | null;
  correlation_id?: string | null;
  case_id?: string | null;
  object_type?: string | null;
  object_id?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  result?: 'success' | 'failure' | 'partial';
  source_system?: string;
  error_code?: string | null;
  actor_type?: 'system' | 'user' | 'ai_cto' | 'worker';
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const sb = await createPersistClient();
    const eventKey = `IDAUD-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const { error } = await sb.from('os_audit_events').insert({
      event_key: eventKey,
      entity_id: input.entity_id,
      action: String(input.action).slice(0, 64),
      object_type: input.object_type ?? 'identity',
      object_id: input.object_id ?? input.case_id ?? null,
      title: input.title.slice(0, 500),
      employee_id: input.employee_id ?? null,
      correlation_id: input.correlation_id ?? null,
      case_id: input.case_id ?? null,
      result: input.result ?? 'success',
      source_system: input.source_system ?? 'orchestrator',
      error_code: input.error_code ?? null,
      before_json: input.before ?? null,
      after_json: input.after ?? null,
      metadata: {
        actor_type: input.actor_type ?? 'system',
        identity_lifecycle: true,
      },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'audit failed' };
  }
}
