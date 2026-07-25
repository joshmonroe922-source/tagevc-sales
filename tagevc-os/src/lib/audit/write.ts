import { randomUUID } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { logActivity, type ActivityModule } from '@/lib/data/activity';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'page_view'
  | 'record_create'
  | 'record_update'
  | 'record_delete'
  | 'stage_change'
  | 'ticket_action'
  | 'message_action'
  | 'export'
  | 'admin_config'
  | 'live_look_start'
  | 'live_look_stop'
  | 'hris_action'
  | 'finance_sync'
  | 'finance_connect'
  | 'impersonation_start'
  | 'impersonation_stop'
  | 'notification_action'
  | 'other';

export type WriteAuditInput = {
  action: AuditAction | string;
  title: string;
  object_type?: string | null;
  object_id?: string | null;
  entity_id?: string | null;
  metadata?: Record<string, unknown>;
  /** Also write activity_events for firm Activity feed (non-Visionary-visible). */
  mirrorActivity?: {
    module: ActivityModule;
    action: string;
  };
};

export async function writeAuditEvent(
  input: WriteAuditInput,
): Promise<{ ok: boolean; audit_id?: string; error?: string }> {
  try {
    let actorProfileId: string | null = null;
    let actorEmail: string | null = null;
    let actorName: string | null = null;
    let actorRole: string | null = null;
    let realRole: string | null = null;

    try {
      const { getSessionContext } = await import('@/lib/rbac/session');
      const ctx = await getSessionContext();
      if (ctx) {
        actorProfileId = ctx.profile.id;
        actorEmail = ctx.profile.email;
        actorName = ctx.profile.full_name;
        actorRole = ctx.profile.role;
        realRole = ctx.realRole;
      }
    } catch {
      /* best-effort */
    }

    const sb = await createPersistClient();
    const eventKey = `AUD-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const { data, error } = await sb
      .from('os_audit_events')
      .insert({
        event_key: eventKey,
        actor_profile_id: actorProfileId,
        actor_email: actorEmail,
        actor_name: actorName,
        actor_role: actorRole,
        real_role: realRole,
        entity_id: input.entity_id ?? null,
        action: String(input.action).slice(0, 64),
        object_type: input.object_type ?? null,
        object_id: input.object_id ?? null,
        title: input.title.slice(0, 500),
        metadata: input.metadata ?? {},
      })
      .select('audit_id')
      .maybeSingle();

    if (error) {
      console.error('writeAuditEvent', error.message);
      return { ok: false, error: error.message };
    }

    if (input.mirrorActivity) {
      await logActivity({
        module: input.mirrorActivity.module,
        action: input.mirrorActivity.action,
        title: input.title,
        detail:
          typeof input.metadata === 'object'
            ? JSON.stringify(input.metadata).slice(0, 400)
            : undefined,
        entity_id: input.entity_id ?? undefined,
        ref_type: input.object_type ?? undefined,
        ref_id: input.object_id ?? undefined,
      });
    }

    return { ok: true, audit_id: data?.audit_id ? String(data.audit_id) : undefined };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'audit write failed',
    };
  }
}

export type AuditListFilters = {
  actorEmail?: string | null;
  entityId?: string | null;
  action?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
};

export async function listAuditEvents(filters: AuditListFilters = {}) {
  try {
    const sb = await createPersistClient();
    let q = sb
      .from('os_audit_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(filters.limit ?? 100, 500));

    if (filters.actorEmail?.trim()) {
      q = q.ilike('actor_email', `%${filters.actorEmail.trim()}%`);
    }
    if (filters.entityId?.trim()) {
      q = q.eq('entity_id', filters.entityId.trim());
    }
    if (filters.action?.trim()) {
      q = q.eq('action', filters.action.trim());
    }
    if (filters.from) {
      q = q.gte('created_at', filters.from);
    }
    if (filters.to) {
      q = q.lte('created_at', filters.to);
    }

    const { data, error } = await q;
    if (error) {
      return { ok: false as const, events: [], error: error.message };
    }
    return { ok: true as const, events: data ?? [], error: null };
  } catch (e) {
    return {
      ok: false as const,
      events: [],
      error: e instanceof Error ? e.message : 'list failed',
    };
  }
}
