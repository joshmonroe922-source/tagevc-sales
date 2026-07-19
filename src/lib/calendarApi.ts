import { supabase } from './supabase';

async function authHeaders(): Promise<HeadersInit> {
  if (!supabase) throw new Error('Supabase is not configured');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  return {
    Authorization: `Bearer ${session.access_token}`,
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
}

async function postFn<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json;
}

export type CalendarViewMode = 'month' | 'week' | 'agenda';

export type CalendarStatus = {
  configured: boolean;
  connected: boolean;
  work_email: string | null;
  login_email: string;
  preferred_work_email: string;
  microsoft_email: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  calendar_default_view: CalendarViewMode;
  needs_scope_upgrade: boolean;
  capabilities: {
    list_events: boolean;
    create_events: boolean;
    edit_events: boolean;
    delete_events: boolean;
    todo: boolean;
    planner: boolean;
    chat?: boolean;
    files?: boolean;
    mail?: boolean;
    mailbox_settings?: boolean;
    online_meetings?: boolean;
    directory_search?: boolean;
    people_search?: boolean;
    location_suggest?: boolean;
    room_finder?: boolean;
  };
  setup_hint: string | null;
  healthy: boolean;
};

export type OutlookCalendar = {
  id: string;
  name: string;
  color: string | null;
  is_default: boolean;
  can_edit?: boolean;
  owner_name?: string | null;
  owner_email?: string | null;
  /** graph = Outlook mailbox; ics = personal Google/ICS feed added in portal */
  source?: 'graph' | 'ics';
};

export type PersonalCalendarFeed = {
  id: string;
  name: string;
  color: string | null;
  source: 'ics';
  created_at: string;
};

export type CalendarEvent = {
  id: string;
  subject: string;
  body_preview: string | null;
  is_all_day: boolean;
  show_as: string | null;
  web_link: string | null;
  location: string | null;
  start: string | null;
  start_timezone: string;
  end: string | null;
  end_timezone: string;
  organizer_name: string | null;
  organizer_email: string | null;
  is_online_meeting?: boolean;
  online_meeting_url?: string | null;
  /** Present when events are loaded from multi-calendar overlay. */
  calendar_id?: string | null;
  calendar_name?: string | null;
  calendar_color?: string | null;
};

const CALENDAR_DISABLED_KEY = 'ms_calendar_disabled_ids';

/**
 * Disabled calendar IDs (localStorage). Default is empty → all calendars overlaid.
 * Storing disabled (not enabled) keeps newly added Outlook calendars visible by default.
 */
export function loadDisabledCalendarIds(): string[] {
  try {
    const raw = localStorage.getItem(CALENDAR_DISABLED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id)).filter(Boolean);
  } catch {
    return [];
  }
}

export function saveDisabledCalendarIds(ids: string[]): string[] {
  const unique = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  try {
    localStorage.setItem(CALENDAR_DISABLED_KEY, JSON.stringify(unique));
  } catch {
    /* ignore quota */
  }
  return unique;
}

export function filterEnabledCalendars(
  calendars: OutlookCalendar[],
  disabledIds: string[] = loadDisabledCalendarIds(),
): OutlookCalendar[] {
  if (!disabledIds.length) return calendars;
  const disabled = new Set(disabledIds);
  return calendars.filter((c) => !disabled.has(c.id));
}

export function eventCalendarKey(ev: CalendarEvent): string {
  return `${ev.calendar_id ?? 'default'}:${ev.id}`;
}

export type TodoTask = {
  id: string;
  title: string;
  status: string;
  importance: string | null;
  due: string | null;
  due_timezone: string | null;
  created_at: string | null;
  updated_at: string | null;
  body_preview: string | null;
  completed: boolean;
  /** Present on master aggregate rows. */
  portal_slug?: string | null;
  list_id?: string | null;
};

export type TodoList = {
  id: string;
  display_name: string;
  wellknown: string | null;
};

export type PortalTodoBucket = {
  portal_slug: string;
  list_id: string;
  display_name: string;
  tasks: TodoTask[];
};

export type PlannerPlan = {
  id: string;
  title: string;
  owner: string | null;
};

export type PlannerTask = {
  id: string;
  title: string;
  plan_id: string;
  percent_complete: number;
  due: string | null;
  created_at: string | null;
  completed: boolean;
};

export async function fetchCalendarStatus(): Promise<CalendarStatus> {
  return postFn<CalendarStatus>('microsoft-calendar-status');
}

export async function startCalendarOAuth(
  redirectPath = '/sales/calendar',
): Promise<{ url: string; login_hint: string }> {
  return postFn('microsoft-calendar-oauth-start', { redirect_path: redirectPath });
}

export async function disconnectCalendar(): Promise<void> {
  await postFn('microsoft-calendar-disconnect');
}

export class CalendarApiError extends Error {
  needs_reconnect?: boolean;
  needs_scope_upgrade?: boolean;

  constructor(
    message: string,
    flags: { needs_reconnect?: boolean; needs_scope_upgrade?: boolean } = {},
  ) {
    super(message);
    this.name = 'CalendarApiError';
    this.needs_reconnect = flags.needs_reconnect;
    this.needs_scope_upgrade = flags.needs_scope_upgrade;
  }
}

export type CalendarEventsResult = {
  events: CalendarEvent[];
  calendars: OutlookCalendar[];
  calendar_errors?: Array<{
    calendar_id: string | null;
    calendar_name: string | null;
    error: string;
  }>;
  personal_calendar_hint?: string | null;
};

export async function fetchCalendarEvents(
  start: string,
  end: string,
  opts: {
    audit?: boolean;
    /** When set, only these calendars. Omit = server returns all calendars (client may filter). */
    calendar_ids?: string[] | null;
  } = {},
): Promise<CalendarEvent[]> {
  const res = await fetchCalendarEventsDetailed(start, end, opts);
  return res.events;
}

export async function fetchCalendarEventsDetailed(
  start: string,
  end: string,
  opts: {
    audit?: boolean;
    calendar_ids?: string[] | null;
  } = {},
): Promise<CalendarEventsResult> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/microsoft-calendar-events`;
  const res = await fetch(url, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      start,
      end,
      audit: opts.audit !== false,
      ...(opts.calendar_ids?.length ? { calendar_ids: opts.calendar_ids } : {}),
    }),
  });
  const json = (await res.json()) as CalendarEventsResult & {
    error?: string;
    needs_reconnect?: boolean;
    needs_scope_upgrade?: boolean;
  };
  if (!res.ok) {
    throw new CalendarApiError(json.error ?? `Request failed (${res.status})`, {
      needs_reconnect: Boolean(json.needs_reconnect),
      needs_scope_upgrade: Boolean(json.needs_scope_upgrade),
    });
  }
  return {
    events: json.events ?? [],
    calendars: json.calendars ?? [],
    calendar_errors: json.calendar_errors,
    personal_calendar_hint: json.personal_calendar_hint ?? null,
  };
}

export async function listPersonalCalendarFeeds(): Promise<{
  feeds: PersonalCalendarFeed[];
  hint: string | null;
}> {
  const res = await postFn<{ feeds: PersonalCalendarFeed[]; hint?: string }>(
    'microsoft-calendar-feeds',
    { action: 'list' },
  );
  return { feeds: res.feeds ?? [], hint: res.hint ?? null };
}

export async function addPersonalCalendarFeed(input: {
  name?: string;
  url: string;
  color?: string;
}): Promise<PersonalCalendarFeed> {
  const res = await postFn<{ feed: PersonalCalendarFeed }>('microsoft-calendar-feeds', {
    action: 'add',
    ...input,
  });
  return res.feed;
}

export async function removePersonalCalendarFeed(feedId: string): Promise<void> {
  await postFn('microsoft-calendar-feeds', {
    action: 'remove',
    feed_id: feedId,
  });
}

export type PeopleSuggestion = {
  id: string;
  display_name: string | null;
  email: string;
  source: 'people' | 'contacts';
};

export type LocationSuggestion = {
  display_name: string;
  source: 'recent' | 'room';
  email?: string | null;
};

export async function createCalendarMeeting(input: {
  subject: string;
  body?: string;
  location?: string;
  start: string;
  end: string;
  time_zone?: string;
  attendees?: string[];
  is_online_meeting?: boolean;
}): Promise<CalendarEvent> {
  const res = await postFn<{ event: CalendarEvent }>('microsoft-calendar-create-event', input);
  return res.event;
}

export async function searchMeetingPeople(
  query: string,
  top = 8,
): Promise<PeopleSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await postFn<{ people: PeopleSuggestion[] }>(
    'microsoft-calendar-people-search',
    { q, top },
  );
  return res.people ?? [];
}

export async function suggestMeetingLocations(
  query: string,
  top = 10,
): Promise<LocationSuggestion[]> {
  const res = await postFn<{ locations: LocationSuggestion[] }>(
    'microsoft-calendar-location-suggest',
    { q: query.trim(), top },
  );
  return res.locations ?? [];
}

export async function fetchTodoLists(): Promise<TodoList[]> {
  const res = await postFn<{ lists: TodoList[] }>('microsoft-todo', { action: 'lists' });
  return res.lists ?? [];
}

export async function ensurePortalTodoList(portalSlug: string): Promise<{
  list_id: string;
  display_name: string;
  portal_slug: string;
  created: boolean;
}> {
  return postFn('microsoft-todo', {
    action: 'ensure_list',
    portal_slug: portalSlug,
  });
}

export async function fetchTodoTasks(
  listId?: string,
  portalSlug?: string,
): Promise<{
  list_id: string;
  portal_slug?: string | null;
  tasks: TodoTask[];
}> {
  return postFn('microsoft-todo', {
    action: 'list',
    ...(listId ? { list_id: listId } : {}),
    ...(portalSlug ? { portal_slug: portalSlug } : {}),
  });
}

export async function fetchMasterPortalTodos(portalSlugs: string[]): Promise<{
  portals: PortalTodoBucket[];
}> {
  return postFn('microsoft-todo', {
    action: 'master',
    portal_slugs: portalSlugs,
  });
}

export type TodoImportance = 'low' | 'normal' | 'high';

export async function createTodoTask(input: {
  title: string;
  body?: string;
  due?: string | null;
  importance?: TodoImportance;
  time_zone?: string;
  list_id?: string;
  portal_slug?: string;
}): Promise<{ list_id: string; portal_slug?: string | null; task: TodoTask }> {
  return postFn('microsoft-todo', {
    action: 'create',
    ...input,
  });
}

export async function updateTodoTask(input: {
  list_id: string;
  task_id: string;
  title?: string;
  due?: string | null;
  importance?: TodoImportance;
  time_zone?: string;
  portal_slug?: string;
}): Promise<{ list_id: string; portal_slug?: string | null; task: TodoTask }> {
  return postFn('microsoft-todo', {
    action: 'update',
    ...input,
  });
}

export async function completeTodoTask(
  listId: string,
  taskId: string,
  portalSlug?: string,
): Promise<{ list_id: string; portal_slug?: string | null; task: TodoTask }> {
  return postFn('microsoft-todo', {
    action: 'complete',
    list_id: listId,
    task_id: taskId,
    ...(portalSlug ? { portal_slug: portalSlug } : {}),
  });
}

export async function fetchPlannerPlans(): Promise<{
  plans: PlannerPlan[];
  hint: string | null;
  error?: string;
}> {
  return postFn('microsoft-planner', { action: 'plans' });
}

export async function fetchPlannerTasks(planId: string): Promise<PlannerTask[]> {
  const res = await postFn<{ tasks: PlannerTask[] }>('microsoft-planner', {
    action: 'list',
    plan_id: planId,
  });
  return res.tasks ?? [];
}

export async function createPlannerTask(planId: string, title: string): Promise<PlannerTask> {
  const res = await postFn<{ task: PlannerTask }>('microsoft-planner', {
    action: 'create',
    plan_id: planId,
    title,
    assign_to_me: true,
  });
  return res.task;
}

export async function completePlannerTask(taskId: string): Promise<PlannerTask> {
  const res = await postFn<{ task: PlannerTask }>('microsoft-planner', {
    action: 'complete',
    task_id: taskId,
  });
  return res.task;
}

export type TeamsChat = {
  id: string;
  topic: string | null;
  chat_type: string | null;
  title: string;
  web_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  members: Array<{
    id: string | null;
    display_name: string | null;
    email: string | null;
    user_id: string | null;
  }>;
  last_message: {
    id: string | null;
    created_at: string | null;
    from_id: string | null;
    from_name: string | null;
    preview: string;
  } | null;
};

export type TeamsChatMessage = {
  id: string;
  created_at: string | null;
  message_type: string | null;
  from_id: string | null;
  from_name: string | null;
  body: string;
  body_html: string | null;
};

export async function fetchTeamsChats(opts: { audit?: boolean } = {}): Promise<{
  me_id: string | null;
  chats: TeamsChat[];
}> {
  return postFn('microsoft-chat', {
    action: 'list',
    audit: opts.audit !== false,
  });
}

export async function fetchTeamsChatMessages(
  chatId: string,
  opts: { audit?: boolean; top?: number } = {},
): Promise<{ chat_id: string; me_id: string | null; messages: TeamsChatMessage[] }> {
  return postFn('microsoft-chat', {
    action: 'messages',
    chat_id: chatId,
    top: opts.top ?? 50,
    audit: opts.audit !== false,
  });
}

export async function sendTeamsChatMessage(
  chatId: string,
  content: string,
): Promise<TeamsChatMessage> {
  const res = await postFn<{ message: TeamsChatMessage }>('microsoft-chat', {
    action: 'send',
    chat_id: chatId,
    content,
  });
  return res.message;
}

export async function createTeamsChat(input: {
  chat_type?: 'oneOnOne' | 'group';
  member?: string;
  members?: string[];
  topic?: string;
}): Promise<TeamsChat> {
  const res = await postFn<{ chat: TeamsChat }>('microsoft-chat', {
    action: 'create',
    ...input,
  });
  return res.chat;
}

/** Soft-hide chat for the signed-in user (Teams “Remove from list”). */
export type HideTeamsChatResult = {
  ok: true;
  chat_id: string;
  mode: 'hide_for_user' | 'ui_dismiss';
  reason?: string | null;
};

export async function hideTeamsChat(chatId: string): Promise<HideTeamsChatResult> {
  return postFn<HideTeamsChatResult>('microsoft-chat', {
    action: 'hide',
    chat_id: chatId,
  });
}

export type OnlineMeeting = {
  id: string;
  subject: string;
  start: string | null;
  end: string | null;
  join_url: string | null;
  web_link?: string | null;
};

export async function createTeamsOnlineMeeting(input: {
  subject?: string;
  start?: string;
  end?: string;
  attendees?: string[];
  /** When set, posts the join URL into this chat */
  chat_id?: string;
}): Promise<OnlineMeeting> {
  const res = await postFn<{ meeting: OnlineMeeting }>('microsoft-online-meetings', {
    action: 'create',
    ...input,
  });
  return res.meeting;
}

export async function fetchUpcomingOnlineMeetings(opts: {
  start?: string;
  end?: string;
  top?: number;
  audit?: boolean;
} = {}): Promise<OnlineMeeting[]> {
  const res = await postFn<{ meetings: OnlineMeeting[] }>('microsoft-online-meetings', {
    action: 'list',
    start: opts.start,
    end: opts.end,
    top: opts.top ?? 20,
    audit: opts.audit !== false,
  });
  return res.meetings ?? [];
}

/* ---------------------------------------------------------------------------
   OneDrive / Files
   --------------------------------------------------------------------------- */

export type DriveItem = {
  id: string;
  name: string;
  size: number | null;
  web_url: string | null;
  created_at: string | null;
  modified_at: string | null;
  is_folder: boolean;
  child_count: number | null;
  mime_type: string | null;
  parent_id: string | null;
  parent_path: string | null;
  drive_id: string | null;
  remote_item_id: string | null;
  shared_scope: string | null;
};

export type VaultFolderRef = {
  drive_id: string | null;
  item_id: string;
  name: string;
  web_url: string | null;
  path_label: string;
};

export type PortalVaultInfo = {
  downloads: VaultFolderRef;
  company: {
    available: boolean;
    mode: 'configured_drive' | 'sharepoint_site' | 'shared_with_me' | 'unavailable';
    root: VaultFolderRef | null;
    resumes: VaultFolderRef | null;
    message: string | null;
    needs_sites_scope: boolean;
  };
};

export type DriveListSource =
  | 'my_drive'
  | 'shared_with_me'
  | 'downloads'
  | 'company'
  | 'company_resumes';

export type DriveListResult = {
  source: DriveListSource;
  parent_id: string | null;
  drive_id?: string | null;
  breadcrumb: Array<{ id: string | null; name: string; drive_id?: string | null }>;
  items: DriveItem[];
  vault?: PortalVaultInfo | null;
};

export type DriveShareLink = {
  id: string | null;
  roles: string[];
  link_type: string | null;
  link_scope: string | null;
  web_url: string | null;
};

export type DrivePreview = {
  get_url: string | null;
  post_url: string | null;
  post_parameters: string | null;
  name: string | null;
  mime_type: string | null;
  web_url: string | null;
  office_embed_url: string | null;
  previewable: boolean;
};

export async function fetchDriveItems(
  parentId?: string | null,
  opts: {
    audit?: boolean;
    drive_id?: string | null;
    source?: DriveListSource | null;
  } = {},
): Promise<DriveListResult> {
  return postFn('microsoft-files', {
    action: 'list',
    parent_id: parentId ?? null,
    drive_id: opts.drive_id ?? null,
    source: opts.source ?? null,
    audit: opts.audit !== false,
  });
}

export async function fetchSharedDriveItems(
  opts: { audit?: boolean } = {},
): Promise<DriveListResult> {
  return postFn('microsoft-files', {
    action: 'shared',
    audit: opts.audit !== false,
  });
}

export async function ensureDocumentVault(): Promise<PortalVaultInfo> {
  const res = await postFn<{ vault: PortalVaultInfo }>('microsoft-files', {
    action: 'ensure_vault',
  });
  return res.vault;
}

/** In-portal Graph / Office embed preview (downloads are disabled). */
export async function getDrivePreview(
  itemId: string,
  opts: { drive_id?: string | null } = {},
): Promise<DrivePreview> {
  const res = await postFn<{ preview: DrivePreview }>('microsoft-files', {
    action: 'preview',
    item_id: itemId,
    drive_id: opts.drive_id ?? null,
  });
  return res.preview;
}

export async function uploadDriveFile(input: {
  file_name: string;
  content_base64: string;
  content_type?: string;
  parent_id?: string | null;
  drive_id?: string | null;
  destination?: 'downloads' | 'company_resumes' | null;
}): Promise<DriveItem> {
  const res = await postFn<{ item: DriveItem }>('microsoft-files', {
    action: 'upload',
    ...input,
  });
  return res.item;
}

export async function stubCopyToSalesforce(input: {
  item_id: string;
  drive_id?: string | null;
}): Promise<{ ok: boolean; wired: boolean; message: string }> {
  return postFn('microsoft-files', {
    action: 'salesforce_copy_stub',
    item_id: input.item_id,
    drive_id: input.drive_id ?? null,
  });
}

export async function createDriveFolder(
  name: string,
  parentId?: string | null,
): Promise<DriveItem> {
  const res = await postFn<{ item: DriveItem }>('microsoft-files', {
    action: 'mkdir',
    name,
    parent_id: parentId ?? null,
  });
  return res.item;
}

export async function renameDriveItem(itemId: string, name: string): Promise<DriveItem> {
  const res = await postFn<{ item: DriveItem }>('microsoft-files', {
    action: 'rename',
    item_id: itemId,
    name,
  });
  return res.item;
}

export async function deleteDriveItem(itemId: string, name?: string): Promise<void> {
  await postFn('microsoft-files', {
    action: 'delete',
    item_id: itemId,
    name: name ?? null,
  });
}

export async function createOrgShareLink(
  itemId: string,
  shareType: 'view' | 'edit' = 'view',
): Promise<DriveShareLink> {
  const res = await postFn<{ permission: DriveShareLink }>('microsoft-files', {
    action: 'share_link',
    item_id: itemId,
    share_type: shareType,
    share_scope: 'organization',
  });
  return res.permission;
}

export async function inviteDriveShare(input: {
  item_id: string;
  emails: string[];
  role?: 'read' | 'write';
  message?: string;
}): Promise<Array<{ id: string | null; roles: string[]; email: string | null }>> {
  const res = await postFn<{
    permissions: Array<{ id: string | null; roles: string[]; email: string | null }>;
  }>('microsoft-files', {
    action: 'share_invite',
    ...input,
  });
  return res.permissions ?? [];
}

/* ---------------------------------------------------------------------------
   Outlook / Mail
   --------------------------------------------------------------------------- */

export type MailFolder = {
  id: string;
  display_name: string;
  well_known: 'inbox' | 'sentitems' | 'drafts' | 'archive' | 'deleteditems' | null;
  parent_folder_id: string | null;
  child_folder_count: number;
  total_count: number | null;
  unread_count: number | null;
};

export type MailRecipient = {
  name: string | null;
  email: string | null;
};

export type MailMessageSummary = {
  id: string;
  subject: string;
  preview: string;
  from: MailRecipient;
  to: MailRecipient[];
  cc: MailRecipient[];
  received_at: string | null;
  is_read: boolean;
  is_draft: boolean;
  has_attachments: boolean;
  importance: string | null;
  conversation_id: string | null;
  parent_folder_id: string | null;
  web_link: string | null;
};

export type MailAttachmentMeta = {
  id: string;
  name: string;
  content_type: string | null;
  size: number | null;
  is_inline: boolean;
  content_id: string | null;
  is_file: boolean;
};

export type MailMessageDetail = MailMessageSummary & {
  body_html: string | null;
  body_text: string | null;
  attachments: MailAttachmentMeta[];
};

export type MailAttachmentPreview = MailAttachmentMeta & {
  content_type: string;
  content_base64: string | null;
  previewable: boolean;
  looks_like_resume?: boolean;
  suggested_destination?: 'downloads' | 'company_resumes';
};

/** Graph simple fileAttachment limits (also enforced server-side). */
export const MAIL_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
export const MAIL_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAIL_ATTACHMENT_MAX_COUNT = 10;

export type MailOutboundAttachment = {
  name: string;
  content_type: string;
  content_base64: string;
};

export class MailExternalConfirmError extends Error {
  external_recipients: string[];
  org_domains: string[];

  constructor(message: string, external: string[], orgDomains: string[]) {
    super(message);
    this.name = 'MailExternalConfirmError';
    this.external_recipients = external;
    this.org_domains = orgDomains;
  }
}

async function postMailFn<T>(body: Record<string, unknown>): Promise<T> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/microsoft-mail`;
  const res = await fetch(url, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & {
    error?: string;
    needs_external_confirm?: boolean;
    external_recipients?: string[];
    org_domains?: string[];
  };
  if (res.status === 409 && json.needs_external_confirm) {
    throw new MailExternalConfirmError(
      json.error ?? 'External recipients require confirmation',
      json.external_recipients ?? [],
      json.org_domains ?? [],
    );
  }
  if (!res.ok) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json;
}

export async function fetchMailFolders(opts: { audit?: boolean } = {}): Promise<{
  folders: MailFolder[];
  org_domains: string[];
}> {
  return postMailFn({
    action: 'folders',
    audit: opts.audit !== false,
  });
}

export async function fetchMailMessages(
  opts: {
    folder_id?: string | null;
    well_known?: MailFolder['well_known'];
    top?: number;
    skip?: number;
    audit?: boolean;
  } = {},
): Promise<{ folder_id: string | null; messages: MailMessageSummary[] }> {
  return postMailFn({
    action: 'list',
    folder_id: opts.folder_id ?? null,
    well_known: opts.well_known ?? null,
    top: opts.top ?? 40,
    skip: opts.skip ?? 0,
    audit: opts.audit !== false,
  });
}

export async function searchMail(
  query: string,
  opts: {
    top?: number;
    folder_id?: string | null;
    /** Limit Graph $search to the given folder; default whole mailbox. */
    search_in_folder?: boolean;
  } = {},
): Promise<{
  query: string;
  folder_id: string | null;
  scope: 'folder' | 'mailbox';
  messages: MailMessageSummary[];
}> {
  return postMailFn({
    action: 'search',
    q: query,
    top: opts.top ?? 25,
    folder_id: opts.folder_id ?? null,
    search_in_folder: Boolean(opts.search_in_folder && opts.folder_id),
  });
}

export async function createMailFolderApi(input: {
  display_name: string;
  parent_folder_id?: string | null;
}): Promise<{ folder: MailFolder }> {
  return postMailFn({
    action: 'create_folder',
    display_name: input.display_name,
    parent_folder_id: input.parent_folder_id ?? null,
  });
}

export async function renameMailFolderApi(input: {
  folder_id: string;
  display_name: string;
}): Promise<{ folder: MailFolder }> {
  return postMailFn({
    action: 'rename_folder',
    folder_id: input.folder_id,
    display_name: input.display_name,
  });
}

export async function fetchMailMessage(messageId: string): Promise<{
  message: MailMessageDetail;
  /** Full conversation bodies, oldest → newest (via Graph conversationId). */
  thread: MailMessageDetail[];
}> {
  return postMailFn({
    action: 'get',
    message_id: messageId,
  });
}

/** Load a conversation by Graph conversationId (full message bodies). */
export async function fetchMailThread(conversationId: string): Promise<{
  conversation_id: string;
  thread: MailMessageDetail[];
}> {
  return postMailFn({
    action: 'thread',
    conversation_id: conversationId,
  });
}

export async function fetchMailAttachmentPreview(
  messageId: string,
  attachmentId: string,
): Promise<MailAttachmentPreview> {
  const res = await postMailFn<{ attachment: MailAttachmentPreview }>({
    action: 'attachment',
    message_id: messageId,
    attachment_id: attachmentId,
  });
  return res.attachment;
}

/** Save inbound attachment into OneDrive vault (Downloads or Company Resumes). No local disk. */
export async function saveMailAttachmentToVault(
  messageId: string,
  attachmentId: string,
  destination?: 'downloads' | 'company_resumes' | null,
): Promise<{
  ok: boolean;
  destination: 'downloads' | 'company_resumes';
  message: string;
  item: {
    id: string | null;
    name: string;
    size: number | null;
    web_url: string | null;
    drive_id: string | null;
  };
}> {
  return postMailFn({
    action: 'save_attachment',
    message_id: messageId,
    attachment_id: attachmentId,
    destination: destination ?? null,
  });
}

export async function ensureMailDocumentVault(): Promise<PortalVaultInfo> {
  const res = await postMailFn<{ vault: PortalVaultInfo }>({
    action: 'ensure_vault',
  });
  return res.vault;
}

export async function sendMail(input: {
  subject: string;
  body_html: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  from?: string | null;
  allow_external?: boolean;
  attachments?: MailOutboundAttachment[];
}): Promise<void> {
  await postMailFn({ action: 'send', ...input });
}

export async function replyMail(input: {
  message_id: string;
  comment: string;
  reply_all?: boolean;
  from?: string | null;
  allow_external?: boolean;
  attachments?: MailOutboundAttachment[];
}): Promise<void> {
  await postMailFn({ action: 'reply', ...input });
}

export async function forwardMail(input: {
  message_id: string;
  to: string[];
  comment?: string;
  from?: string | null;
  allow_external?: boolean;
  attachments?: MailOutboundAttachment[];
}): Promise<void> {
  await postMailFn({ action: 'forward', ...input });
}

export async function markMailRead(messageId: string, isRead = true): Promise<void> {
  await postMailFn({
    action: 'mark_read',
    message_id: messageId,
    is_read: isRead,
  });
}

export async function deleteMail(
  messageId: string,
  opts: { permanent?: boolean; parent_folder_id?: string | null } = {},
): Promise<{ ok: boolean; mode: 'soft' | 'permanent'; microsoft_email?: string | null }> {
  return postMailFn({
    action: 'delete',
    message_id: messageId,
    permanent: opts.permanent === true,
    parent_folder_id: opts.parent_folder_id ?? null,
  });
}

export async function archiveMail(messageId: string): Promise<void> {
  await postMailFn({ action: 'archive', message_id: messageId });
}

export async function moveMail(
  messageIds: string | string[],
  destinationId: string,
): Promise<{ messages: MailMessageSummary[] }> {
  const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
  return postMailFn({
    action: 'move',
    message_id: ids[0],
    message_ids: ids,
    destination_id: destinationId,
  });
}

export type MailSendAsAddress = {
  address: string;
  is_primary: boolean;
};

export type MailSendAsPayload = {
  primary: string | null;
  display_name: string | null;
  addresses: MailSendAsAddress[];
  org_domains: string[];
  note?: string;
};

export async function fetchMailSendAsAddresses(): Promise<MailSendAsPayload> {
  return postMailFn({ action: 'send_as_addresses' });
}

export type MailboxAutomaticReplies = {
  status?: string;
  externalAudience?: string;
  internalReplyMessage?: string;
  externalReplyMessage?: string;
  scheduledStartDateTime?: { dateTime?: string; timeZone?: string } | null;
  scheduledEndDateTime?: { dateTime?: string; timeZone?: string } | null;
};

export type MailboxSettingsPayload = {
  portal_signature: {
    mail_signature_html: string | null;
    mail_signature_enabled: boolean;
    note: string;
  };
  mailbox: {
    timeZone: string | null;
    language: { locale?: string; displayName?: string } | null;
    dateFormat?: string | null;
    timeFormat?: string | null;
    automaticRepliesSetting: MailboxAutomaticReplies | null;
  } | null;
  needs_scope_upgrade?: boolean;
  error?: string;
};

export async function fetchMailboxSettings(): Promise<MailboxSettingsPayload> {
  return postMailFn({ action: 'mailbox_settings' });
}

export async function updateMailboxAutomaticReplies(
  automatic_replies: MailboxAutomaticReplies,
): Promise<{ ok: boolean; mailbox: MailboxSettingsPayload['mailbox'] }> {
  return postMailFn({
    action: 'update_mailbox_settings',
    automatic_replies,
  });
}

export async function setMyWorkEmail(email: string | null): Promise<string | null> {
  const { data, error } = await requireRpc().rpc('set_my_work_email', {
    p_email: email?.trim() || null,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export async function setMyMailSignature(
  html: string | null,
  enabled = true,
): Promise<{ mail_signature_html: string | null; mail_signature_enabled: boolean }> {
  const { data, error } = await requireRpc().rpc('set_my_mail_signature', {
    p_html: html?.trim() || null,
    p_enabled: enabled,
  });
  if (error) throw error;
  const row = data as {
    mail_signature_html?: string | null;
    mail_signature_enabled?: boolean;
  } | null;
  return {
    mail_signature_html: row?.mail_signature_html ?? null,
    mail_signature_enabled: row?.mail_signature_enabled !== false,
  };
}

export async function setMyCalendarDefaultView(
  view: CalendarViewMode,
): Promise<CalendarViewMode> {
  const { data, error } = await requireRpc().rpc('set_my_calendar_default_view', {
    p_view: view,
  });
  if (error) throw error;
  return (data as CalendarViewMode) ?? view;
}

/** Persist IANA timezone for digest cron (null/empty clears → mailbox/auto). */
export async function setMyTimezone(timezone: string | null): Promise<string | null> {
  const { data, error } = await requireRpc().rpc('set_my_timezone', {
    p_timezone: timezone?.trim() || null,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** Opt in/out of the 6:00 AM Today digest email (default on). */
export async function setMyMorningDigestEnabled(enabled: boolean): Promise<boolean> {
  const { data, error } = await requireRpc().rpc('set_my_morning_digest_enabled', {
    p_enabled: enabled,
  });
  if (error) throw error;
  return data !== false;
}

function requireRpc() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}
