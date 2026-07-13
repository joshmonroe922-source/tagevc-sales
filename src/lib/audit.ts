import { supabase } from './supabase';
import type { SalesUser } from './types';

/** Josh allowlist — audit rows for these actors are private (only they can SELECT). */
export const AUDIT_PROTECTED_EMAILS = [
  'josh@tagevc.com',
  'joshmonroe@tagevc.com',
  'joshmonroe922@gmail.com',
] as const;

export type AuditEventType =
  | 'login'
  | 'logout'
  | 'login_failed'
  | 'session_heartbeat'
  | 'portal_opened'
  | 'page_view'
  | 'entity_view'
  | 'link_click'
  | 'download'
  | 'export'
  | 'print'
  | 'email_sent'
  | 'permission_request';

export type AuditEvent = {
  id: string;
  user_id: string | null;
  email: string | null;
  event_type: string;
  path: string | null;
  metadata: Record<string, unknown>;
  actor_protected: boolean;
  created_at: string;
};

export type LogAuditInput = {
  eventType: AuditEventType | string;
  path?: string | null;
  metadata?: Record<string, unknown>;
  /** Optional override when salesUser not yet in React state (e.g. right after login). */
  user?: Pick<SalesUser, 'id' | 'email'> | null;
  email?: string | null;
  userId?: string | null;
};

export function auditActorIsProtected(
  email?: string | null,
  _userId?: string | null,
): boolean {
  const normalized = (email ?? '').trim().toLowerCase();
  return (AUDIT_PROTECTED_EMAILS as readonly string[]).includes(normalized);
}

function clientMeta(): Record<string, unknown> {
  if (typeof navigator === 'undefined') return {};
  return {
    user_agent: navigator.userAgent,
    language: navigator.language,
    // IP / geo: capture later via edge function request headers if needed.
  };
}

/**
 * Fire-and-forget audit insert. Never throws to callers.
 * Records everyone including Josh; RLS keeps Josh's rows private to Josh.
 */
export async function logAuditEvent(input: LogAuditInput): Promise<void> {
  if (!supabase) return;

  try {
    const email =
      input.email?.trim().toLowerCase() ||
      input.user?.email?.trim().toLowerCase() ||
      null;
    const userId = input.userId ?? input.user?.id ?? null;

    // Prefer JWT identity when available so RLS with-check passes.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? null;

    const resolvedEmail = email || sessionEmail;
    if (!resolvedEmail && !userId && input.eventType !== 'login_failed') {
      return;
    }

    if (input.eventType === 'login_failed') {
      await supabase.rpc('log_audit_login_failed', {
        p_email: resolvedEmail ?? input.email ?? '',
        p_metadata: { ...clientMeta(), ...(input.metadata ?? {}) },
      });
      return;
    }

    if (!session) return;

    const actorProtected = auditActorIsProtected(resolvedEmail, userId);

    const { error } = await supabase.from('audit_events').insert({
      user_id: userId,
      email: resolvedEmail,
      event_type: input.eventType,
      path: input.path ?? (typeof window !== 'undefined' ? window.location.pathname : null),
      metadata: { ...clientMeta(), ...(input.metadata ?? {}) },
      actor_protected: actorProtected,
    });

    if (error) {
      console.warn('audit log failed:', error.message);
    }
  } catch (err) {
    console.warn('audit log error:', err);
  }
}

/** Stub for future email-permission / access-request flows. */
export function logPermissionRequest(opts: {
  user?: Pick<SalesUser, 'id' | 'email'> | null;
  path?: string;
  metadata?: Record<string, unknown>;
}): void {
  void logAuditEvent({
    eventType: 'permission_request',
    path: opts.path,
    user: opts.user,
    metadata: {
      status: 'stub',
      note: 'Permission-request flow not built yet',
      ...(opts.metadata ?? {}),
    },
  });
}

export type AuditListFilters = {
  eventType?: string;
  email?: string;
  userId?: string;
  since?: string;
  until?: string;
  limit?: number;
};

export async function listAuditEvents(
  filters: AuditListFilters = {},
): Promise<AuditEvent[]> {
  if (!supabase) throw new Error('Supabase is not configured');

  let query = supabase
    .from('audit_events')
    .select('id, user_id, email, event_type, path, metadata, actor_protected, created_at')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.eventType) query = query.eq('event_type', filters.eventType);
  if (filters.email) query = query.ilike('email', filters.email.trim());
  if (filters.userId) query = query.eq('user_id', filters.userId);
  if (filters.since) query = query.gte('created_at', filters.since);
  if (filters.until) query = query.lte('created_at', filters.until);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AuditEvent[];
}

export const AUDIT_EVENT_TYPE_LABELS: Record<string, string> = {
  login: 'Login',
  logout: 'Logout',
  login_failed: 'Failed login',
  session_heartbeat: 'Session active',
  portal_opened: 'Portal opened',
  page_view: 'Page view',
  entity_view: 'Entity / portfolio view',
  link_click: 'Link click',
  download: 'Download',
  export: 'Export',
  print: 'Print',
  email_sent: 'Outbound email',
  permission_request: 'Permission request',
};
