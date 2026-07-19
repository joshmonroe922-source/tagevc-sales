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
  | 'permission_request'
  | 'calendar_connect'
  | 'calendar_disconnect'
  | 'calendar_view'
  | 'meeting_create'
  | 'people_search'
  | 'location_suggest'
  | 'todo_create'
  | 'todo_update'
  | 'todo_complete'
  | 'planner_create'
  | 'planner_complete'
  | 'planner_view'
  | 'chat_list'
  | 'chat_open'
  | 'chat_send'
  | 'chat_create'
  | 'chat_hide'
  | 'chat_search'
  | 'online_meeting_create'
  | 'online_meeting_list'
  | 'files_browse'
  | 'files_open'
  | 'files_download'
  | 'files_upload'
  | 'files_mkdir'
  | 'files_rename'
  | 'files_delete'
  | 'files_share'
  | 'mail_folders'
  | 'mail_list'
  | 'mail_open'
  | 'mail_send'
  | 'mail_delete'
  | 'mail_move'
  | 'mail_search'
  | 'mail_attachment_view'
  | 'notification_permission'
  | 'notification_sent'
  | 'audit_control_reviewed'
  | 'audit_control_status'
  | 'audit_task_complete'
  | 'finance_close_item_complete'
  | 'finance_close_period_complete'
  | 'hr_checklist_item_update'
  | 'hr_checklist_complete'
  | 'ops_compliance_complete';

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

/** Structured metadata for compliance / checklist completion events. */
export type AuditCompletionLogInput = {
  eventType:
    | 'audit_control_reviewed'
    | 'audit_control_status'
    | 'audit_task_complete'
    | 'finance_close_item_complete'
    | 'finance_close_period_complete'
    | 'hr_checklist_item_update'
    | 'hr_checklist_complete'
    | 'ops_compliance_complete';
  portal: string;
  entityType: string;
  entityId: string;
  title?: string | null;
  fromStatus?: string | null;
  toStatus: string;
  completedAt?: string | null;
  extra?: Record<string, unknown>;
  path?: string | null;
};

/** Fire-and-forget completion / status-change audit row (actor via session). */
export function logAuditCompletion(input: AuditCompletionLogInput): void {
  void logAuditEvent({
    eventType: input.eventType,
    path: input.path,
    metadata: {
      portal: input.portal,
      entity_type: input.entityType,
      entity_id: input.entityId,
      title: input.title ?? null,
      from_status: input.fromStatus ?? null,
      to_status: input.toStatus,
      completed_at: input.completedAt ?? null,
      ...(input.extra ?? {}),
    },
  });
}

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
  calendar_connect: 'Calendar connected',
  calendar_disconnect: 'Calendar disconnected',
  calendar_view: 'Calendar viewed',
  meeting_create: 'Meeting created',
  people_search: 'People search',
  location_suggest: 'Location suggestions',
  todo_create: 'To Do task created',
  todo_update: 'To Do task updated',
  todo_complete: 'To Do task completed',
  planner_create: 'Planner task created',
  planner_complete: 'Planner task completed',
  planner_view: 'Planner viewed',
  chat_list: 'Teams chats listed',
  chat_open: 'Teams chat opened',
  chat_send: 'Teams message sent',
  chat_create: 'Teams chat created',
  chat_hide: 'Teams chat removed from list',
  chat_search: 'Teams chat search',
  online_meeting_create: 'Teams online meeting created',
  online_meeting_list: 'Teams online meetings listed',
  files_browse: 'OneDrive folder browsed',
  files_open: 'OneDrive file opened (in-portal preview)',
  files_download: 'OneDrive file downloaded (disabled)',
  files_upload: 'OneDrive file uploaded',
  files_mkdir: 'OneDrive folder created',
  files_rename: 'OneDrive item renamed',
  files_delete: 'OneDrive item deleted',
  files_share: 'OneDrive item shared',
  mail_folders: 'Mail folders listed',
  mail_list: 'Mail folder listed',
  mail_open: 'Mail message opened',
  mail_send: 'Mail sent',
  mail_delete: 'Mail deleted',
  mail_move: 'Mail moved / archived',
  mail_search: 'Mail searched',
  mail_attachment_view: 'Mail attachment previewed',
  notification_permission: 'Desktop notification permission',
  notification_sent: 'Desktop notification sent',
  audit_control_reviewed: 'Audit control marked reviewed',
  audit_control_status: 'Audit control status changed',
  audit_task_complete: 'Audit task completed',
  finance_close_item_complete: 'Finance close item completed',
  finance_close_period_complete: 'Finance close period closed',
  hr_checklist_item_update: 'HR checklist item updated',
  hr_checklist_complete: 'HR checklist completed',
  ops_compliance_complete: 'Ops compliance item completed',
};
