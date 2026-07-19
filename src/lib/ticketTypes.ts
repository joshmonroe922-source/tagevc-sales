/** Portal ticketing — shared-services queues (Linear/Jira-style in-app). */

export const TICKET_CATEGORIES = [
  'technology',
  'legal',
  'accounting-finance',
  'marketing',
  'human-resources',
  'admin',
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  technology: 'Technology',
  legal: 'Legal',
  'accounting-finance': 'Finance / Accounting',
  marketing: 'Marketing',
  'human-resources': 'Human Resources',
  admin: 'General / Admin',
};

/** Category → queue route (portal home subtree). */
export const TICKET_CATEGORY_QUEUE_PATH: Record<TicketCategory, string> = {
  technology: '/sales/technology/tickets',
  legal: '/sales/legal/tickets',
  'accounting-finance': '/sales/finance/tickets',
  marketing: '/sales/marketing/tickets',
  'human-resources': '/sales/hr/tickets',
  admin: '/sales/administrative/tickets',
};

/** Portal slug that manages a category (null = admin-only queue). */
export const TICKET_CATEGORY_PORTAL: Record<TicketCategory, string | null> = {
  technology: 'technology',
  legal: 'legal',
  'accounting-finance': 'accounting-finance',
  marketing: 'marketing',
  'human-resources': 'human-resources',
  admin: 'administrative',
};

/**
 * Routing team for each queue (config only — no DB column yet).
 * Future assignee workflows can resolve team_id → members.
 */
export type TicketTeam = {
  id: string;
  label: string;
};

export const TICKET_CATEGORY_TEAM: Record<TicketCategory, TicketTeam> = {
  technology: { id: 'technology', label: 'Technology team' },
  legal: { id: 'legal', label: 'Legal team' },
  'accounting-finance': {
    id: 'accounting-finance',
    label: 'Accounting & Finance team',
  },
  marketing: { id: 'marketing', label: 'Marketing team' },
  'human-resources': { id: 'human-resources', label: 'Human Resources team' },
  admin: { id: 'administrative', label: 'Administrative team' },
};

export function ticketTeamForCategory(category: TicketCategory): TicketTeam {
  return TICKET_CATEGORY_TEAM[category];
}

export const TICKET_STATUSES = [
  'open',
  'in_progress',
  'waiting',
  'resolved',
  'closed',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const TICKET_ATTACHMENT_KINDS = ['page_snapshot', 'upload', 'other'] as const;
export type TicketAttachmentKind = (typeof TICKET_ATTACHMENT_KINDS)[number];

/** Where the ticket originated (Tage hub vs subsidiary sales platforms). */
export const TICKET_SOURCE_PORTALS = [
  'tage',
  'recruit619-desk',
  'instant-nda',
  'signent',
  'other',
] as const;

export type TicketSourcePortal = (typeof TICKET_SOURCE_PORTALS)[number];

export const TICKET_SOURCE_PORTAL_LABELS: Record<TicketSourcePortal, string> = {
  tage: 'Tage Portal',
  'recruit619-desk': 'My Recruiting Desk',
  'instant-nda': 'Instant NDA',
  signent: 'Signent',
  other: 'Other',
};

export const TICKET_CREATED_VIA = [
  'portal_ui',
  'subsidiary_api',
  'system',
] as const;
export type TicketCreatedVia = (typeof TICKET_CREATED_VIA)[number];

export const TICKET_SYNC_STATUSES = [
  'local_only',
  'pending',
  'synced',
  'error',
] as const;
export type TicketSyncStatus = (typeof TICKET_SYNC_STATUSES)[number];

export type TicketDiagnosticContext = {
  url: string;
  pathname: string;
  search: string;
  page_title: string;
  portal_slug: string | null;
  user_id: string;
  user_email: string;
  captured_at: string;
  user_agent: string;
  viewport: { width: number; height: number; device_pixel_ratio: number };
};

export type PortalTicket = {
  id: string;
  ticket_number: number;
  title: string;
  description: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  created_by: string;
  assignee_id: string | null;
  diagnostic_context: TicketDiagnosticContext | Record<string, unknown>;
  assignee_has_unread: boolean;
  creator_has_unread: boolean;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Subsidiary / hub origin */
  source_portal: TicketSourcePortal;
  entity_id: string | null;
  created_via: TicketCreatedVia;
  external_id: string | null;
  external_url: string | null;
  sync_status: TicketSyncStatus;
  last_synced_at: string | null;
  sync_error: string | null;
  sync_meta: Record<string, unknown>;
  /** Joined when requested */
  creator?: { id: string; email: string; full_name: string | null } | null;
  assignee?: { id: string; email: string; full_name: string | null } | null;
};

/** Local draft before upload (create modal / reply). */
export type TicketAttachmentDraft = {
  id: string;
  file: File | Blob;
  fileName: string;
  mimeType: string;
  /** Object URL for image previews — revoke on remove */
  previewUrl?: string | null;
};

export type PortalTicketComment = {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  is_internal: boolean;
  created_at: string;
  author?: { id: string; email: string; full_name: string | null } | null;
};

export type PortalTicketAttachment = {
  id: string;
  ticket_id: string;
  comment_id: string | null;
  uploaded_by: string;
  kind: TicketAttachmentKind;
  file_name: string;
  mime_type: string;
  byte_size: number;
  storage_path: string;
  created_at: string;
};

export const TICKET_ATTACHMENTS_BUCKET = 'ticket-attachments';
