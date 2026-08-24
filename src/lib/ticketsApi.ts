import { requireSupabase } from './supabase';
import {
  TEXT_SEARCH_OPTS,
  orderByIdList,
  rankedSearchIds,
  toWebsearchQuery,
} from './textSearch';
import {
  TICKET_ATTACHMENTS_BUCKET,
  type PortalTicket,
  type PortalTicketAttachment,
  type PortalTicketComment,
  type TicketCategory,
  type TicketDiagnosticContext,
  type TicketPriority,
  type TicketStatus,
} from './ticketTypes';
import type { SalesUser } from './types';

const TICKET_SELECT = `
  *,
  creator:sales_users!portal_tickets_created_by_fkey ( id, email, full_name ),
  assignee:sales_users!portal_tickets_assignee_id_fkey ( id, email, full_name )
`;

function mapTicket(row: Record<string, unknown>): PortalTicket {
  const r = row as unknown as PortalTicket;
  return {
    ...r,
    source_portal: r.source_portal ?? 'tage',
    entity_id: r.entity_id ?? null,
    created_via: r.created_via ?? 'portal_ui',
    external_id: r.external_id ?? null,
    external_url: r.external_url ?? null,
    sync_status: r.sync_status ?? 'local_only',
    last_synced_at: r.last_synced_at ?? null,
    sync_error: r.sync_error ?? null,
    sync_meta: r.sync_meta ?? {},
  };
}

export type ListTicketsFilter = {
  category?: TicketCategory | TicketCategory[];
  status?: TicketStatus | TicketStatus[] | 'openish' | 'all';
  createdBy?: string;
  assigneeId?: string | null;
  mineFor?: string;
  search?: string;
  limit?: number;
};

/** Open-ish = not resolved/closed (queue badge). */
export function isOpenishStatus(status: TicketStatus): boolean {
  return status === 'open' || status === 'in_progress' || status === 'waiting';
}

export async function listTickets(
  filter: ListTicketsFilter = {},
): Promise<PortalTicket[]> {
  const sb = requireSupabase();
  let q = sb
    .from('portal_tickets')
    .select(TICKET_SELECT)
    .order('updated_at', { ascending: false })
    .limit(filter.limit ?? 200);

  if (filter.category) {
    const cats = Array.isArray(filter.category)
      ? filter.category
      : [filter.category];
    q = q.in('category', cats);
  }

  if (filter.status && filter.status !== 'all') {
    if (filter.status === 'openish') {
      q = q.in('status', ['open', 'in_progress', 'waiting']);
    } else if (Array.isArray(filter.status)) {
      q = q.in('status', filter.status);
    } else {
      q = q.eq('status', filter.status);
    }
  }

  if (filter.createdBy) q = q.eq('created_by', filter.createdBy);
  if (filter.assigneeId === null) q = q.is('assignee_id', null);
  else if (filter.assigneeId) q = q.eq('assignee_id', filter.assigneeId);

  if (filter.mineFor) {
    q = q.or(
      `created_by.eq.${filter.mineFor},assignee_id.eq.${filter.mineFor}`,
    );
  }

  let rankedIds: string[] | null = null;
  if (filter.search?.trim()) {
    const s = filter.search.trim().replace(/%/g, '');
    const asNum = Number(s.replace(/^#/, ''));
    if (Number.isFinite(asNum) && asNum > 0 && String(asNum) === s.replace(/^#/, '')) {
      q = q.eq('ticket_number', asNum);
    } else {
      const fts = toWebsearchQuery(s);
      if (fts) {
        rankedIds = await rankedSearchIds(sb, 'search_portal_tickets_ranked', {
          p_query: fts,
          p_limit: filter.limit ?? 200,
        });
        if (rankedIds) {
          if (rankedIds.length === 0) return [];
          q = q.in('id', rankedIds);
        } else {
          q = q.textSearch('search_vector', fts, TEXT_SEARCH_OPTS);
        }
      }
    }
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => mapTicket(r as Record<string, unknown>));
  return rankedIds ? orderByIdList(rows, rankedIds) : rows;
}

export async function countOpenTicketsByCategory(
  category: TicketCategory,
): Promise<number> {
  const sb = requireSupabase();
  const { count, error } = await sb
    .from('portal_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('category', category)
    .in('status', ['open', 'in_progress', 'waiting']);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function countMyUnread(salesUserId: string): Promise<number> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('portal_tickets')
    .select('id, created_by, assignee_id, creator_has_unread, assignee_has_unread')
    .or(`created_by.eq.${salesUserId},assignee_id.eq.${salesUserId}`)
    .in('status', ['open', 'in_progress', 'waiting', 'resolved']);
  if (error) throw new Error(error.message);
  let n = 0;
  for (const row of data ?? []) {
    const r = row as {
      created_by: string;
      assignee_id: string | null;
      creator_has_unread: boolean;
      assignee_has_unread: boolean;
    };
    if (r.created_by === salesUserId && r.creator_has_unread) n += 1;
    else if (r.assignee_id === salesUserId && r.assignee_has_unread) n += 1;
  }
  return n;
}

export async function getTicket(id: string): Promise<PortalTicket | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('portal_tickets')
    .select(TICKET_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapTicket(data as Record<string, unknown>) : null;
}

export type CreateTicketInput = {
  title: string;
  description?: string;
  category: TicketCategory;
  priority?: TicketPriority;
  createdBy: string;
  diagnostic: TicketDiagnosticContext;
  /** Optional PNG blob from portal tab snapshot */
  pageSnapshot?: Blob | null;
  /** Manual uploads / pasted screenshots (create modal) */
  attachments?: Array<{
    file: Blob;
    fileName: string;
    mimeType?: string;
  }>;
  sourcePortal?: PortalTicket['source_portal'];
  entityId?: string | null;
  createdVia?: PortalTicket['created_via'];
  externalId?: string | null;
  externalUrl?: string | null;
  syncStatus?: PortalTicket['sync_status'];
};

export async function createTicket(
  input: CreateTicketInput,
): Promise<PortalTicket> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('portal_tickets')
    .insert({
      title: input.title.trim(),
      description: (input.description ?? '').trim(),
      category: input.category,
      priority: input.priority ?? 'normal',
      created_by: input.createdBy,
      diagnostic_context: input.diagnostic,
      source_portal: input.sourcePortal ?? 'tage',
      entity_id: input.entityId ?? null,
      created_via: input.createdVia ?? 'portal_ui',
      external_id: input.externalId ?? null,
      external_url: input.externalUrl ?? null,
      sync_status: input.syncStatus ?? 'local_only',
      // Queue managers see new work as unread
      assignee_has_unread: true,
      creator_has_unread: false,
    })
    .select(TICKET_SELECT)
    .single();

  if (error) throw new Error(error.message);
  const ticket = mapTicket(data as Record<string, unknown>);

  if (input.pageSnapshot && input.pageSnapshot.size > 0) {
    try {
      await uploadTicketAttachment({
        ticketId: ticket.id,
        uploadedBy: input.createdBy,
        kind: 'page_snapshot',
        file: input.pageSnapshot,
        fileName: `page-snapshot-${ticket.ticket_number}.png`,
        mimeType: 'image/png',
      });
    } catch (err) {
      console.warn('Ticket snapshot upload failed', err);
    }
  }

  for (const att of input.attachments ?? []) {
    try {
      await uploadTicketAttachment({
        ticketId: ticket.id,
        uploadedBy: input.createdBy,
        kind: 'upload',
        file: att.file,
        fileName: att.fileName,
        mimeType: att.mimeType,
      });
    } catch (err) {
      console.warn('Ticket attachment upload failed', err);
    }
  }

  // Soft notify (Resend) — fire-and-forget
  void notifyTicketEvent({
    ticketId: ticket.id,
    event: 'created',
  }).catch(() => undefined);

  return ticket;
}

export async function updateTicket(
  id: string,
  patch: {
    title?: string;
    description?: string;
    status?: TicketStatus;
    priority?: TicketPriority;
    category?: TicketCategory;
    assignee_id?: string | null;
  },
  opts?: { notifyAssignee?: boolean },
): Promise<PortalTicket> {
  const sb = requireSupabase();
  const updates: Record<string, unknown> = { ...patch };
  if (patch.assignee_id !== undefined) {
    updates.assignee_has_unread = patch.assignee_id != null;
  }
  if (patch.status) {
    // Staff status change → creator should check
    updates.creator_has_unread = true;
  }

  const { data, error } = await sb
    .from('portal_tickets')
    .update(updates)
    .eq('id', id)
    .select(TICKET_SELECT)
    .single();
  if (error) throw new Error(error.message);
  const ticket = mapTicket(data as Record<string, unknown>);

  if (opts?.notifyAssignee && patch.assignee_id) {
    void notifyTicketEvent({
      ticketId: id,
      event: 'assigned',
    }).catch(() => undefined);
  }

  return ticket;
}

export async function markTicketRead(ticketId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('mark_portal_ticket_read', {
    p_ticket_id: ticketId,
  });
  if (error) throw new Error(error.message);
}

export async function listTicketComments(
  ticketId: string,
): Promise<PortalTicketComment[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('portal_ticket_comments')
    .select(
      `
      *,
      author:sales_users!portal_ticket_comments_author_id_fkey ( id, email, full_name )
    `,
    )
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PortalTicketComment[];
}

export async function addTicketComment(input: {
  ticketId: string;
  authorId: string;
  body: string;
  isInternal?: boolean;
  /** Who is commenting relative to ticket parties — flips unread flags */
  ticket: Pick<PortalTicket, 'created_by' | 'assignee_id'>;
  /** Optional files / pasted screenshots on the reply */
  attachments?: Array<{
    file: Blob;
    fileName: string;
    mimeType?: string;
  }>;
}): Promise<PortalTicketComment> {
  const sb = requireSupabase();
  const body = input.body.trim();
  const hasFiles = (input.attachments?.length ?? 0) > 0;
  if (!body && !hasFiles) {
    throw new Error('Comment or attachment required');
  }

  const { data, error } = await sb
    .from('portal_ticket_comments')
    .insert({
      ticket_id: input.ticketId,
      author_id: input.authorId,
      body: body || '(attachment)',
      is_internal: input.isInternal ?? false,
    })
    .select(
      `
      *,
      author:sales_users!portal_ticket_comments_author_id_fkey ( id, email, full_name )
    `,
    )
    .single();
  if (error) throw new Error(error.message);

  const comment = data as unknown as PortalTicketComment;

  for (const att of input.attachments ?? []) {
    try {
      await uploadTicketAttachment({
        ticketId: input.ticketId,
        uploadedBy: input.authorId,
        kind: 'upload',
        file: att.file,
        fileName: att.fileName,
        mimeType: att.mimeType,
        commentId: comment.id,
      });
    } catch (err) {
      console.warn('Comment attachment upload failed', err);
    }
  }

  const isCreator = input.authorId === input.ticket.created_by;
  await sb
    .from('portal_tickets')
    .update({
      creator_has_unread: !isCreator,
      assignee_has_unread: isCreator,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.ticketId);

  void notifyTicketEvent({
    ticketId: input.ticketId,
    event: 'comment',
  }).catch(() => undefined);

  return comment;
}

export async function listTicketAttachments(
  ticketId: string,
): Promise<PortalTicketAttachment[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('portal_ticket_attachments')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PortalTicketAttachment[];
}

export async function uploadTicketAttachment(input: {
  ticketId: string;
  uploadedBy: string;
  kind: PortalTicketAttachment['kind'];
  file: Blob;
  fileName: string;
  mimeType?: string;
  commentId?: string | null;
}): Promise<PortalTicketAttachment> {
  const sb = requireSupabase();
  const safe = input.fileName.replace(/[^\w.\-]+/g, '_');
  const path = `${input.ticketId}/${Date.now()}_${safe}`;
  const mime = input.mimeType || input.file.type || 'application/octet-stream';

  const { error: upErr } = await sb.storage
    .from(TICKET_ATTACHMENTS_BUCKET)
    .upload(path, input.file, {
      contentType: mime,
      upsert: false,
    });
  if (upErr) throw new Error(upErr.message);

  const { data, error } = await sb
    .from('portal_ticket_attachments')
    .insert({
      ticket_id: input.ticketId,
      comment_id: input.commentId ?? null,
      uploaded_by: input.uploadedBy,
      kind: input.kind,
      file_name: input.fileName,
      mime_type: mime,
      byte_size: input.file.size,
      storage_path: path,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as PortalTicketAttachment;
}

export async function getTicketAttachmentUrl(
  storagePath: string,
  expiresIn = 3600,
): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.storage
    .from(TICKET_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** List active sales users for assign dropdown (limited fields). */
export async function listSalesUsersForAssign(): Promise<
  Pick<SalesUser, 'id' | 'email' | 'full_name' | 'role'>[]
> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('sales_users')
    .select('id, email, full_name, role')
    .eq('active', true)
    .order('full_name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Pick<SalesUser, 'id' | 'email' | 'full_name' | 'role'>[];
}

async function notifyTicketEvent(input: {
  ticketId: string;
  event: 'created' | 'assigned' | 'comment';
}): Promise<void> {
  const sb = requireSupabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return;

  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
  if (!base) return;

  await fetch(`${base}/functions/v1/portal-ticket-notify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export function formatTicketRef(ticket: Pick<PortalTicket, 'ticket_number'>): string {
  return `#${ticket.ticket_number}`;
}

export function userDisplayName(
  u: { full_name: string | null; email: string } | null | undefined,
): string {
  if (!u) return '—';
  return u.full_name?.trim() || u.email;
}
