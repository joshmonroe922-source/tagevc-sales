import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  ensurePortalVault,
  looksLikeResume,
  uploadToVaultDestination,
} from '../_shared/documentVault.ts';
import {
  createMailFolder,
  deleteMailMessage,
  estimateBase64Bytes,
  extractMailAddresses,
  fetchMailAttachment,
  fetchMailConversation,
  fetchMailFolderByWellKnown,
  fetchMailFolders,
  fetchMailMessage,
  fetchMailMessages,
  fetchMailboxSendAsAddresses,
  fetchMailboxSettings,
  forwardMailMessage,
  getMsConfig,
  getValidAccessToken,
  isOrgMailAddress,
  MAIL_ATTACHMENT_MAX_BYTES,
  MAIL_ATTACHMENT_MAX_COUNT,
  MAIL_ATTACHMENT_MAX_TOTAL_BYTES,
  moveMailMessage,
  normalizeSendAsAddress,
  orgMailDomains,
  patchMailMessage,
  patchMailboxSettings,
  preferredWorkEmail,
  renameMailFolder,
  replyMailMessage,
  requireActiveSalesUser,
  scopesInclude,
  searchMailMessages,
  sendMailMessage,
  type GraphAutomaticRepliesSetting,
  type GraphMailAttachment,
  type GraphMailMessage,
  type GraphMailRecipient,
  type MailboxSendAsAddress,
  type MailFileAttachmentInput,
  type SalesUserRow,
  type WellKnownMailFolder,
} from '../_shared/microsoftGraph.ts';
import { auditMsAction } from '../_shared/msAudit.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  action?:
    | 'folders'
    | 'list'
    | 'search'
    | 'get'
    | 'thread'
    | 'attachment'
    | 'save_attachment'
    | 'ensure_vault'
    | 'send'
    | 'reply'
    | 'forward'
    | 'mark_read'
    | 'delete'
    | 'archive'
    | 'move'
    | 'create_folder'
    | 'rename_folder'
    | 'mailbox_settings'
    | 'update_mailbox_settings'
    | 'send_as_addresses';
  folder_id?: string | null;
  parent_folder_id?: string | null;
  well_known?: WellKnownMailFolder | null;
  message_id?: string;
  message_ids?: string[];
  /** When true, Graph DELETE (permanent). Default soft-deletes to Deleted Items. */
  permanent?: boolean;
  parent_folder_id?: string | null;
  conversation_id?: string;
  attachment_id?: string;
  /** Save target: downloads (default) | company_resumes */
  destination?: 'downloads' | 'company_resumes';
  q?: string;
  /** When true with search, limit $search to folder_id (else whole mailbox). */
  search_in_folder?: boolean;
  display_name?: string;
  top?: number;
  skip?: number;
  subject?: string;
  body_html?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  /** Own mailbox alias (proxyAddress) to send From. */
  from?: string | null;
  comment?: string;
  reply_all?: boolean;
  is_read?: boolean;
  destination_id?: string;
  /** Confirm sending to non-org domains after a soft warning. */
  allow_external?: boolean;
  /** When false, skip portal signature even if enabled. Default true. */
  include_signature?: boolean;
  /** Outbound file attachments (base64). Counts audited; contents never logged. */
  attachments?: Array<{
    name?: string;
    content_type?: string;
    content_base64?: string;
  }>;
  automatic_replies?: GraphAutomaticRepliesSetting;
  audit?: boolean;
};

const PATH = '/sales/mail';

const FOLDER_LABELS: Record<WellKnownMailFolder, string> = {
  inbox: 'Inbox',
  sentitems: 'Sent',
  drafts: 'Drafts',
  archive: 'Archive',
  deleteditems: 'Deleted',
};

function mapRecipient(r: GraphMailRecipient) {
  return {
    name: r.emailAddress?.name ?? null,
    email: r.emailAddress?.address ?? null,
  };
}

function mapMessageSummary(msg: GraphMailMessage) {
  return {
    id: msg.id,
    subject: msg.subject ?? '(no subject)',
    preview: (msg.bodyPreview ?? '').slice(0, 200),
    from: mapRecipient(msg.from ?? {}),
    to: (msg.toRecipients ?? []).map(mapRecipient),
    cc: (msg.ccRecipients ?? []).map(mapRecipient),
    received_at: msg.receivedDateTime ?? msg.sentDateTime ?? msg.createdDateTime ?? null,
    is_read: Boolean(msg.isRead),
    is_draft: Boolean(msg.isDraft),
    has_attachments: Boolean(msg.hasAttachments),
    importance: msg.importance ?? null,
    conversation_id: msg.conversationId ?? null,
    parent_folder_id: msg.parentFolderId ?? null,
    web_link: msg.webLink ?? null,
  };
}

function mapAttachmentMeta(a: GraphMailAttachment) {
  const odata = a['@odata.type'] ?? '';
  return {
    id: a.id ?? '',
    name: a.name ?? 'attachment',
    content_type: a.contentType ?? null,
    size: a.size ?? null,
    is_inline: Boolean(a.isInline),
    content_id: a.contentId ?? null,
    is_file: odata.includes('fileAttachment') || Boolean(a.contentType),
  };
}

function mapMessageDetail(msg: GraphMailMessage) {
  const contentType = msg.body?.contentType ?? 'text';
  const raw = msg.body?.content ?? '';
  return {
    ...mapMessageSummary(msg),
    body_html: contentType.toLowerCase() === 'html' ? raw : null,
    body_text: contentType.toLowerCase() === 'html' ? null : raw,
    attachments: (msg.attachments ?? []).map(mapAttachmentMeta),
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Rewrite cid: inline images to data URLs when Graph provides fileAttachment bytes. */
async function embedInlineCidImages(
  accessToken: string,
  msg: GraphMailMessage,
): Promise<GraphMailMessage> {
  const contentType = (msg.body?.contentType ?? '').toLowerCase();
  let html = msg.body?.content ?? '';
  if (contentType !== 'html' || !html || !msg.id) return msg;

  // contentId is not on base attachment $select; resolve it from the full GET.
  const inline = (msg.attachments ?? []).filter((a) => a.isInline && a.id);
  if (!inline.length) return msg;

  for (const meta of inline) {
    try {
      const full = await fetchMailAttachment(accessToken, msg.id, meta.id!);
      if (!full.contentBytes) continue;
      const cidRaw = (full.contentId ?? meta.contentId ?? '').trim();
      const cid = cidRaw.replace(/^<|>$/g, '');
      if (!cid) continue;
      const ct = (full.contentType ?? 'application/octet-stream').trim() ||
        'application/octet-stream';
      const dataUrl = `data:${ct};base64,${full.contentBytes}`;
      const patterns = [
        new RegExp(`cid:${escapeRegExp(cid)}`, 'gi'),
        new RegExp(`cid:${escapeRegExp(cidRaw)}`, 'gi'),
      ];
      for (const re of patterns) {
        html = html.replace(re, dataUrl);
      }
    } catch {
      /* leave cid: reference if fetch fails */
    }
  }

  return {
    ...msg,
    body: { ...(msg.body ?? {}), contentType: 'html', content: html },
  };
}

function parseOutboundAttachments(
  raw: Body['attachments'],
): { ok: true; attachments: MailFileAttachmentInput[] } | { ok: false; error: string } {
  if (!raw?.length) return { ok: true, attachments: [] };
  if (raw.length > MAIL_ATTACHMENT_MAX_COUNT) {
    return {
      ok: false,
      error: `Too many attachments (max ${MAIL_ATTACHMENT_MAX_COUNT}).`,
    };
  }
  const attachments: MailFileAttachmentInput[] = [];
  let total = 0;
  for (const item of raw) {
    const name = (item.name ?? '').trim() || 'attachment';
    const contentType =
      (item.content_type ?? '').trim() || 'application/octet-stream';
    const contentBytes = (item.content_base64 ?? '').replace(/\s/g, '');
    if (!contentBytes) {
      return { ok: false, error: `Attachment "${name}" is empty.` };
    }
    const size = estimateBase64Bytes(contentBytes);
    if (size > MAIL_ATTACHMENT_MAX_BYTES) {
      return {
        ok: false,
        error:
          `Attachment "${name}" is ${Math.round(size / (1024 * 1024) * 10) / 10} MB. ` +
          `Graph simple attachments are limited to ${MAIL_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB each.`,
      };
    }
    total += size;
    if (total > MAIL_ATTACHMENT_MAX_TOTAL_BYTES) {
      return {
        ok: false,
        error:
          `Total attachment size exceeds ${MAIL_ATTACHMENT_MAX_TOTAL_BYTES / (1024 * 1024)} MB ` +
          `(under Outlook’s ~25 MB message limit, with room for the message body).`,
      };
    }
    attachments.push({ name, contentType, contentBytes });
  }
  return { ok: true, attachments };
}

function normalizeEmails(list: string[] | undefined): string[] {
  if (!list?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const e = raw.trim().toLowerCase();
    if (!e || !e.includes('@') || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function externalRecipients(
  emails: string[],
  orgDomains: string[],
): string[] {
  return emails.filter((e) => !isOrgMailAddress(e, orgDomains));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textToHtml(text: string): string {
  const escaped = escapeHtml(text.trim());
  if (!escaped) return '<p></p>';
  return `<p>${escaped.replace(/\n/g, '<br/>')}</p>`;
}

function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function portalSignature(user: SalesUserRow): string | null {
  if (user.mail_signature_enabled === false) return null;
  const sig = (user.mail_signature_html ?? '').trim();
  return sig || null;
}

function appendHtmlSignature(bodyHtml: string, signature: string): string {
  const sigHtml = looksLikeHtml(signature) ? signature : textToHtml(signature);
  return `${bodyHtml}<div class="portal-mail-signature" style="margin-top:1em;border-top:1px solid #ddd;padding-top:0.75em">${sigHtml}</div>`;
}

function appendPlainSignature(comment: string, signature: string): string {
  const plain = looksLikeHtml(signature) ? htmlToPlain(signature) : signature.trim();
  if (!plain) return comment;
  return `${comment}\n\n--\n${plain}`;
}

async function resolveOutboundFrom(
  accessToken: string,
  requestedFrom: string | null | undefined,
): Promise<{
  from: string | null;
  displayName: string | null;
  addresses: MailboxSendAsAddress[];
  aliasDomains: string[];
}> {
  const want = (requestedFrom ?? '').trim();
  if (!want) {
    return { from: null, displayName: null, addresses: [], aliasDomains: [] };
  }
  const sendAs = await fetchMailboxSendAsAddresses(accessToken);
  const from = normalizeSendAsAddress(want, sendAs.addresses);
  const primary = sendAs.primary;
  // Omit from when primary so Graph uses mailbox default.
  const effective =
    from && primary && from === primary ? null : from;
  const aliasDomains = [
    ...new Set(
      sendAs.addresses
        .map((a) => a.address.split('@')[1]?.toLowerCase())
        .filter((d): d is string => Boolean(d)),
    ),
  ];
  return {
    from: effective,
    displayName: sendAs.display_name,
    addresses: sendAs.addresses,
    aliasDomains,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const config = getMsConfig();
    if (!config.configured) {
      return jsonResponse(
        { error: 'Microsoft Graph is not configured', configured: false },
        503,
        origin,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const userClient = createUserClient(authHeader);
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const service = createServiceClient();
    const salesUser = await requireActiveSalesUser(service, user.email);
    if (!salesUser) {
      return jsonResponse({ error: 'Forbidden' }, 403, origin);
    }

    const body = (await req.json()) as Body;
    const action = body.action ?? 'folders';

    let accessToken: string;
    let microsoftEmail: string | null = null;
    let connectionScopes: string | null = null;
    try {
      const result = await getValidAccessToken(service, config, salesUser.id);
      accessToken = result.accessToken;
      microsoftEmail = result.connection.microsoft_email;
      connectionScopes = result.connection.scopes;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Not connected';
      return jsonResponse({ error: message, needs_reconnect: true }, 401, origin);
    }

    const domains = orgMailDomains(
      preferredWorkEmail(salesUser),
      microsoftEmail,
    );
    const canMailboxSettings = scopesInclude(
      connectionScopes,
      'MailboxSettings.ReadWrite',
    );
    const wantSignature = body.include_signature !== false;
    const signature = wantSignature ? portalSignature(salesUser) : null;

    if (action === 'mailbox_settings') {
      const portalSig = {
        mail_signature_html: salesUser.mail_signature_html ?? null,
        mail_signature_enabled: salesUser.mail_signature_enabled !== false,
        note:
          'Graph does not expose Outlook compose signatures. Portal signature is stored on your sales profile and appended when sending from this Mail page. Outlook desktop/mobile may use a separate signature.',
      };
      if (!canMailboxSettings) {
        return jsonResponse(
          {
            portal_signature: portalSig,
            mailbox: null,
            needs_scope_upgrade: true,
            error:
              'Reconnect Microsoft to grant MailboxSettings.ReadWrite for automatic replies and timezone.',
          },
          200,
          origin,
        );
      }
      const mailbox = await fetchMailboxSettings(accessToken);
      if (body.audit !== false) {
        await auditMsAction(service, {
          userId: salesUser.id,
          email: salesUser.email,
          eventType: 'mail_mailbox_settings',
          path: PATH,
          metadata: {
            ooo_status: mailbox.automaticRepliesSetting?.status ?? null,
          },
        });
      }
      return jsonResponse(
        {
          portal_signature: portalSig,
          mailbox: {
            timeZone: mailbox.timeZone ?? null,
            language: mailbox.language ?? null,
            dateFormat: mailbox.dateFormat ?? null,
            timeFormat: mailbox.timeFormat ?? null,
            automaticRepliesSetting: mailbox.automaticRepliesSetting ?? null,
          },
          needs_scope_upgrade: false,
        },
        200,
        origin,
      );
    }

    if (action === 'update_mailbox_settings') {
      if (!canMailboxSettings) {
        return jsonResponse(
          {
            error:
              'MailboxSettings.ReadWrite required. Reconnect Microsoft to update automatic replies.',
            needs_reconnect: true,
          },
          403,
          origin,
        );
      }
      const ooo = body.automatic_replies;
      if (!ooo || typeof ooo !== 'object') {
        return jsonResponse(
          { error: 'automatic_replies is required' },
          400,
          origin,
        );
      }
      const status = String(ooo.status ?? 'disabled').trim();
      if (!['disabled', 'alwaysEnabled', 'scheduled'].includes(status)) {
        return jsonResponse(
          { error: 'automatic_replies.status must be disabled, alwaysEnabled, or scheduled' },
          400,
          origin,
        );
      }
      const patch: GraphAutomaticRepliesSetting = {
        status,
        externalAudience: ooo.externalAudience ?? 'all',
        internalReplyMessage: ooo.internalReplyMessage ?? '',
        externalReplyMessage: ooo.externalReplyMessage ?? '',
      };
      if (status === 'scheduled') {
        if (!ooo.scheduledStartDateTime?.dateTime || !ooo.scheduledEndDateTime?.dateTime) {
          return jsonResponse(
            { error: 'scheduled automatic replies require start and end dateTimes' },
            400,
            origin,
          );
        }
        patch.scheduledStartDateTime = {
          dateTime: ooo.scheduledStartDateTime.dateTime,
          timeZone: ooo.scheduledStartDateTime.timeZone ?? 'UTC',
        };
        patch.scheduledEndDateTime = {
          dateTime: ooo.scheduledEndDateTime.dateTime,
          timeZone: ooo.scheduledEndDateTime.timeZone ?? 'UTC',
        };
      }
      const mailbox = await patchMailboxSettings(accessToken, {
        automaticRepliesSetting: patch,
      });
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'mail_mailbox_settings_update',
        path: PATH,
        metadata: { ooo_status: status },
      });
      return jsonResponse(
        {
          ok: true,
          mailbox: {
            timeZone: mailbox.timeZone ?? null,
            language: mailbox.language ?? null,
            automaticRepliesSetting: mailbox.automaticRepliesSetting ?? null,
          },
        },
        200,
        origin,
      );
    }

    if (action === 'send_as_addresses') {
      const sendAs = await fetchMailboxSendAsAddresses(accessToken);
      const aliasDomains = [
        ...new Set(
          sendAs.addresses
            .map((a) => a.address.split('@')[1]?.toLowerCase())
            .filter((d): d is string => Boolean(d)),
        ),
      ];
      const mergedDomains = [...new Set([...domains, ...aliasDomains])];
      return jsonResponse(
        {
          primary: sendAs.primary,
          display_name: sendAs.display_name,
          addresses: sendAs.addresses,
          org_domains: mergedDomains,
          note:
            'Own proxyAddresses (SMTP aliases) can be used as From with Mail.Send + User.Read. Sending as another mailbox requires Exchange Send As + Mail.Send.Shared.',
        },
        200,
        origin,
      );
    }

    if (action === 'folders') {
      const folders = await fetchMailFolders(accessToken);
      if (body.audit !== false) {
        await auditMsAction(service, {
          userId: salesUser.id,
          email: salesUser.email,
          eventType: 'mail_folders',
          path: PATH,
          metadata: { count: folders.length },
        });
      }
      return jsonResponse(
        {
          folders: folders.map((f) => ({
            id: f.id,
            display_name:
              (f.well_known ? FOLDER_LABELS[f.well_known] : null) ??
              f.displayName ??
              'Folder',
            well_known: f.well_known,
            parent_folder_id: f.parentFolderId ?? null,
            child_folder_count: f.childFolderCount ?? 0,
            total_count: f.totalItemCount ?? null,
            unread_count: f.unreadItemCount ?? null,
          })),
          org_domains: domains,
        },
        200,
        origin,
      );
    }

    if (action === 'create_folder') {
      const displayName = (body.display_name ?? '').trim();
      if (!displayName) {
        return jsonResponse({ error: 'display_name is required' }, 400, origin);
      }
      const parentId = (body.parent_folder_id ?? body.folder_id ?? '').trim() || null;
      const folder = await createMailFolder(accessToken, displayName, parentId);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'mail_folders',
        path: PATH,
        metadata: {
          mode: 'create',
          folder_id: folder.id,
          parent_folder_id: parentId,
          display_name: displayName.slice(0, 80),
        },
      });
      return jsonResponse(
        {
          folder: {
            id: folder.id,
            display_name: folder.displayName ?? displayName,
            well_known: null,
            parent_folder_id: folder.parentFolderId ?? parentId,
            child_folder_count: folder.childFolderCount ?? 0,
            total_count: folder.totalItemCount ?? 0,
            unread_count: folder.unreadItemCount ?? 0,
          },
        },
        200,
        origin,
      );
    }

    if (action === 'rename_folder') {
      const folderId = (body.folder_id ?? '').trim();
      const displayName = (body.display_name ?? '').trim();
      if (!folderId || !displayName) {
        return jsonResponse(
          { error: 'folder_id and display_name are required' },
          400,
          origin,
        );
      }
      const folder = await renameMailFolder(accessToken, folderId, displayName);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'mail_folders',
        path: PATH,
        metadata: {
          mode: 'rename',
          folder_id: folderId,
          display_name: displayName.slice(0, 80),
        },
      });
      return jsonResponse(
        {
          folder: {
            id: folder.id,
            display_name: folder.displayName ?? displayName,
            well_known: null,
            parent_folder_id: folder.parentFolderId ?? null,
            child_folder_count: folder.childFolderCount ?? 0,
            total_count: folder.totalItemCount ?? null,
            unread_count: folder.unreadItemCount ?? null,
          },
        },
        200,
        origin,
      );
    }

    if (action === 'list') {
      let folderId = (body.folder_id ?? '').trim() || null;
      if (!folderId && body.well_known) {
        const folder = await fetchMailFolderByWellKnown(accessToken, body.well_known);
        folderId = folder.id;
      }
      const messages = await fetchMailMessages(accessToken, {
        folderId,
        top: body.top,
        skip: body.skip,
      });
      if (body.audit !== false) {
        await auditMsAction(service, {
          userId: salesUser.id,
          email: salesUser.email,
          eventType: 'mail_list',
          path: PATH,
          metadata: {
            folder_id: folderId,
            well_known: body.well_known ?? null,
            count: messages.length,
          },
        });
      }
      return jsonResponse(
        {
          folder_id: folderId,
          messages: messages.map(mapMessageSummary),
        },
        200,
        origin,
      );
    }

    if (action === 'search') {
      const q = (body.q ?? '').trim();
      if (q.length < 2) {
        return jsonResponse({ messages: [], query: q }, 200, origin);
      }
      const folderId = (body.folder_id ?? '').trim() || null;
      const searchInFolder = Boolean(body.search_in_folder && folderId);
      const messages = await searchMailMessages(accessToken, q, {
        top: body.top,
        folderId: searchInFolder ? folderId : null,
      });
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'mail_search',
        path: PATH,
        metadata: {
          query: q.slice(0, 80),
          count: messages.length,
          folder_id: searchInFolder ? folderId : null,
          scope: searchInFolder ? 'folder' : 'mailbox',
        },
      });
      return jsonResponse(
        {
          query: q,
          folder_id: searchInFolder ? folderId : null,
          scope: searchInFolder ? 'folder' : 'mailbox',
          messages: messages.map(mapMessageSummary),
        },
        200,
        origin,
      );
    }

    if (action === 'get') {
      const messageId = (body.message_id ?? '').trim();
      if (!messageId) {
        return jsonResponse({ error: 'message_id is required' }, 400, origin);
      }
      let msg = await fetchMailMessage(accessToken, messageId);
      // Mark read when opening (Outlook-like); ignore failure
      if (msg.isRead === false) {
        try {
          await patchMailMessage(accessToken, messageId, { isRead: true });
          msg.isRead = true;
        } catch {
          /* keep unread if patch fails */
        }
      }
      msg = await embedInlineCidImages(accessToken, msg);
      let threadIds: GraphMailMessage[] = [];
      if (msg.conversationId) {
        try {
          threadIds = await fetchMailConversation(accessToken, msg.conversationId, {
            top: 30,
          });
        } catch {
          threadIds = [];
        }
      }
      // Missing conversationId, empty conversation filter, or opened msg not in list → still show at least this message.
      if (!threadIds.length) {
        threadIds = [msg];
      } else if (msg.id && !threadIds.some((row) => row.id === msg.id)) {
        threadIds = [...threadIds, msg].sort((a, b) => {
          const ta = a.receivedDateTime ? Date.parse(a.receivedDateTime) : 0;
          const tb = b.receivedDateTime ? Date.parse(b.receivedDateTime) : 0;
          return ta - tb;
        });
      }
      // Full bodies for every message in the conversation (oldest → newest).
      const thread: GraphMailMessage[] = await Promise.all(
        threadIds.map(async (row) => {
          if (row.id && row.id === msg.id) return msg;
          if (!row.id) return row;
          try {
            let full = await fetchMailMessage(accessToken, row.id);
            full = await embedInlineCidImages(accessToken, full);
            return full;
          } catch {
            return row;
          }
        }),
      );
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'mail_open',
        path: PATH,
        metadata: {
          message_id: messageId,
          conversation_id: msg.conversationId ?? null,
          subject: (msg.subject ?? '').slice(0, 80),
          thread_count: thread.length,
          attachment_count: (msg.attachments ?? []).filter((a) => !a.isInline).length,
        },
      });
      return jsonResponse(
        {
          message: mapMessageDetail(msg),
          thread: thread.map(mapMessageDetail),
        },
        200,
        origin,
      );
    }

    if (action === 'thread') {
      const conversationId = (body.conversation_id ?? '').trim();
      if (!conversationId) {
        return jsonResponse({ error: 'conversation_id is required' }, 400, origin);
      }
      const threadIds = await fetchMailConversation(accessToken, conversationId, {
        top: 30,
      });
      const thread: GraphMailMessage[] = await Promise.all(
        threadIds.map(async (row) => {
          if (!row.id) return row;
          try {
            let full = await fetchMailMessage(accessToken, row.id);
            full = await embedInlineCidImages(accessToken, full);
            return full;
          } catch {
            return row;
          }
        }),
      );
      return jsonResponse(
        {
          conversation_id: conversationId,
          thread: thread.map(mapMessageDetail),
        },
        200,
        origin,
      );
    }

    if (action === 'ensure_vault') {
      const vault = await ensurePortalVault(accessToken, connectionScopes);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'files_vault_ensure',
        path: PATH,
        metadata: {
          downloads_id: vault.downloads.item_id,
          company_available: vault.company.available,
          source: 'mail',
        },
      });
      return jsonResponse({ vault }, 200, origin);
    }

    if (action === 'attachment') {
      const messageId = (body.message_id ?? '').trim();
      const attachmentId = (body.attachment_id ?? '').trim();
      if (!messageId || !attachmentId) {
        return jsonResponse(
          { error: 'message_id and attachment_id are required' },
          400,
          origin,
        );
      }
      const att = await fetchMailAttachment(accessToken, messageId, attachmentId);
      const odata = att['@odata.type'] ?? '';
      if (!odata.includes('fileAttachment') && !att.contentBytes) {
        return jsonResponse(
          {
            error:
              'This attachment type cannot be previewed in the portal (item/reference attachment).',
            previewable: false,
          },
          400,
          origin,
        );
      }
      const contentType = (att.contentType ?? 'application/octet-stream').toLowerCase();
      const previewable =
        contentType.startsWith('image/') ||
        contentType === 'application/pdf' ||
        contentType.startsWith('text/') ||
        contentType === 'application/json' ||
        contentType === 'application/xml' ||
        contentType === 'application/xhtml+xml';
      // Prefer in-portal preview; Office types are opened client-side via vault + Graph preview.
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'mail_attachment_view',
        path: PATH,
        metadata: {
          message_id: messageId,
          attachment_id: attachmentId,
          name: att.name ?? null,
          content_type: contentType,
          previewable,
        },
      });
      return jsonResponse(
        {
          attachment: {
            ...mapAttachmentMeta(att),
            content_type: contentType,
            content_base64: previewable ? att.contentBytes ?? null : null,
            previewable,
            // Soft Outlook web link is not used; attachments stay in-portal when previewable.
            looks_like_resume: looksLikeResume(att.name ?? '', contentType),
            suggested_destination: looksLikeResume(att.name ?? '', contentType)
              ? 'company_resumes'
              : 'downloads',
          },
        },
        200,
        origin,
      );
    }

    if (action === 'save_attachment') {
      const messageId = (body.message_id ?? '').trim();
      const attachmentId = (body.attachment_id ?? '').trim();
      if (!messageId || !attachmentId) {
        return jsonResponse(
          { error: 'message_id and attachment_id are required' },
          400,
          origin,
        );
      }
      const att = await fetchMailAttachment(accessToken, messageId, attachmentId);
      const odata = att['@odata.type'] ?? '';
      if (!odata.includes('fileAttachment') || !att.contentBytes) {
        return jsonResponse(
          {
            error:
              'This attachment cannot be saved to the document vault (missing file bytes).',
          },
          400,
          origin,
        );
      }
      const fileName = (att.name ?? 'attachment').trim() || 'attachment';
      const contentType = (att.contentType ?? 'application/octet-stream').toLowerCase();
      const resumeLike = looksLikeResume(fileName, contentType);
      let destination =
        body.destination === 'company_resumes' || body.destination === 'downloads'
          ? body.destination
          : resumeLike
            ? 'company_resumes'
            : 'downloads';

      const cleaned = att.contentBytes.replace(/\s/g, '');
      const sizeEstimate = estimateBase64Bytes(cleaned);
      if (sizeEstimate > 4 * 1024 * 1024) {
        return jsonResponse(
          {
            error:
              'Attachment exceeds the 4 MB portal vault upload limit. Ask the sender for a OneDrive link or reduce the file size.',
          },
          400,
          origin,
        );
      }

      let bytes: Uint8Array;
      try {
        const binary = atob(cleaned);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } catch {
        return jsonResponse({ error: 'Invalid attachment encoding' }, 400, origin);
      }

      let uploaded;
      try {
        uploaded = await uploadToVaultDestination(accessToken, {
          destination,
          fileName,
          contentType,
          bytes,
          grantedScopes: connectionScopes,
        });
      } catch (err) {
        // If defaulted to company resumes but company vault missing, fall back to Downloads
        if (destination === 'company_resumes' && body.destination !== 'company_resumes') {
          uploaded = await uploadToVaultDestination(accessToken, {
            destination: 'downloads',
            fileName,
            contentType,
            bytes,
            grantedScopes: connectionScopes,
          });
          destination = 'downloads';
        } else {
          throw err;
        }
      }

      const eventType =
        destination === 'company_resumes'
          ? 'mail_save_company_resumes'
          : 'mail_save_downloads';

      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType,
        path: PATH,
        metadata: {
          message_id: messageId,
          attachment_id: attachmentId,
          name: fileName,
          content_type: contentType,
          size: bytes.byteLength,
          destination,
          folder: uploaded.destination,
          drive_item_id: uploaded.item.id ?? null,
          looks_like_resume: resumeLike,
        },
      });

      return jsonResponse(
        {
          ok: true,
          destination,
          folder: uploaded.folder,
          item: {
            id: uploaded.item.id,
            name: uploaded.item.name ?? fileName,
            size: uploaded.item.size ?? bytes.byteLength,
            web_url: uploaded.item.webUrl ?? null,
            drive_id: uploaded.folder.drive_id,
          },
          message:
            destination === 'company_resumes'
              ? `Saved to Company Shared / Resumes (${uploaded.destination}).`
              : `Saved to ${uploaded.destination} (opens in Files → Downloads).`,
        },
        200,
        origin,
      );
    }

    if (action === 'send') {
      const to = normalizeEmails(body.to);
      const cc = normalizeEmails(body.cc);
      const bcc = normalizeEmails(body.bcc);
      if (!to.length) {
        return jsonResponse({ error: 'to is required' }, 400, origin);
      }
      const parsedAtt = parseOutboundAttachments(body.attachments);
      if (!parsedAtt.ok) {
        return jsonResponse({ error: parsedAtt.error }, 400, origin);
      }
      let fromAddress: string | null = null;
      let fromDisplay: string | null = null;
      try {
        const resolved = await resolveOutboundFrom(accessToken, body.from);
        fromAddress = resolved.from;
        fromDisplay = resolved.displayName;
        for (const d of resolved.aliasDomains) domains.push(d);
      } catch (err) {
        return jsonResponse(
          { error: err instanceof Error ? err.message : 'Invalid From address' },
          400,
          origin,
        );
      }
      const orgDomains = [...new Set(domains)];
      const all = [...to, ...cc, ...bcc];
      const external = externalRecipients(all, orgDomains);
      if (external.length && !body.allow_external) {
        return jsonResponse(
          {
            error:
              'Recipients include addresses outside your org domains. Confirm to send externally.',
            needs_external_confirm: true,
            external_recipients: external,
            org_domains: orgDomains,
          },
          409,
          origin,
        );
      }
      const subject = (body.subject ?? '').trim() || '(no subject)';
      let bodyHtml = (body.body_html ?? '').trim() || textToHtml('');
      if (signature) {
        bodyHtml = appendHtmlSignature(bodyHtml, signature);
      }
      await sendMailMessage(accessToken, {
        subject,
        bodyHtml,
        to,
        cc,
        bcc,
        from: fromAddress,
        displayName: fromDisplay,
        attachments: parsedAtt.attachments,
      });
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'mail_send',
        path: PATH,
        metadata: {
          subject: subject.slice(0, 80),
          to_count: to.length,
          cc_count: cc.length,
          external_count: external.length,
          signature: Boolean(signature),
          from: fromAddress ?? body.from ?? null,
          attachment_count: parsedAtt.attachments.length,
        },
      });
      return jsonResponse({ ok: true, sent: true }, 200, origin);
    }

    if (action === 'reply') {
      const messageId = (body.message_id ?? '').trim();
      let comment = (body.comment ?? '').trim();
      if (!messageId) {
        return jsonResponse({ error: 'message_id is required' }, 400, origin);
      }
      if (!comment) {
        return jsonResponse({ error: 'comment is required' }, 400, origin);
      }
      const parsedAtt = parseOutboundAttachments(body.attachments);
      if (!parsedAtt.ok) {
        return jsonResponse({ error: parsedAtt.error }, 400, origin);
      }
      if (signature) {
        comment = appendPlainSignature(comment, signature);
      }
      let fromAddress: string | null = null;
      let fromDisplay: string | null = null;
      try {
        const resolved = await resolveOutboundFrom(accessToken, body.from);
        fromAddress = resolved.from;
        fromDisplay = resolved.displayName;
        for (const d of resolved.aliasDomains) domains.push(d);
      } catch (err) {
        return jsonResponse(
          { error: err instanceof Error ? err.message : 'Invalid From address' },
          400,
          origin,
        );
      }
      const orgDomains = [...new Set(domains)];
      // Soft org check against original recipients when reply-all
      if (body.reply_all) {
        try {
          const original = await fetchMailMessage(accessToken, messageId, {
            expandAttachments: false,
          });
          const addrs = [
            ...extractMailAddresses(original.toRecipients),
            ...extractMailAddresses(original.ccRecipients),
            ...(original.from?.emailAddress?.address
              ? [original.from.emailAddress.address.toLowerCase()]
              : []),
          ];
          const external = externalRecipients(addrs, orgDomains);
          if (external.length && !body.allow_external) {
            return jsonResponse(
              {
                error:
                  'Reply all includes external recipients. Confirm to send externally.',
                needs_external_confirm: true,
                external_recipients: external,
                org_domains: orgDomains,
              },
              409,
              origin,
            );
          }
        } catch {
          /* proceed if we cannot load original */
        }
      }
      await replyMailMessage(accessToken, messageId, {
        comment,
        replyAll: Boolean(body.reply_all),
        from: fromAddress,
        displayName: fromDisplay,
        attachments: parsedAtt.attachments,
      });
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'mail_send',
        path: PATH,
        metadata: {
          message_id: messageId,
          mode: body.reply_all ? 'reply_all' : 'reply',
          signature: Boolean(signature),
          from: fromAddress ?? body.from ?? null,
          attachment_count: parsedAtt.attachments.length,
        },
      });
      return jsonResponse({ ok: true, sent: true }, 200, origin);
    }

    if (action === 'forward') {
      const messageId = (body.message_id ?? '').trim();
      const to = normalizeEmails(body.to);
      if (!messageId) {
        return jsonResponse({ error: 'message_id is required' }, 400, origin);
      }
      if (!to.length) {
        return jsonResponse({ error: 'to is required' }, 400, origin);
      }
      const parsedAtt = parseOutboundAttachments(body.attachments);
      if (!parsedAtt.ok) {
        return jsonResponse({ error: parsedAtt.error }, 400, origin);
      }
      let fromAddress: string | null = null;
      let fromDisplay: string | null = null;
      try {
        const resolved = await resolveOutboundFrom(accessToken, body.from);
        fromAddress = resolved.from;
        fromDisplay = resolved.displayName;
        for (const d of resolved.aliasDomains) domains.push(d);
      } catch (err) {
        return jsonResponse(
          { error: err instanceof Error ? err.message : 'Invalid From address' },
          400,
          origin,
        );
      }
      const orgDomains = [...new Set(domains)];
      const external = externalRecipients(to, orgDomains);
      if (external.length && !body.allow_external) {
        return jsonResponse(
          {
            error:
              'Forward recipients include addresses outside your org domains. Confirm to send externally.',
            needs_external_confirm: true,
            external_recipients: external,
            org_domains: orgDomains,
          },
          409,
          origin,
        );
      }
      await forwardMailMessage(accessToken, messageId, {
        to,
        comment: signature
          ? appendPlainSignature((body.comment ?? '').trim(), signature)
          : (body.comment ?? ''),
        from: fromAddress,
        displayName: fromDisplay,
        attachments: parsedAtt.attachments,
      });
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'mail_send',
        path: PATH,
        metadata: {
          message_id: messageId,
          mode: 'forward',
          to_count: to.length,
          external_count: external.length,
          signature: Boolean(signature),
          from: fromAddress ?? body.from ?? null,
          attachment_count: parsedAtt.attachments.length,
        },
      });
      return jsonResponse({ ok: true, sent: true }, 200, origin);
    }

    if (action === 'mark_read') {
      const messageId = (body.message_id ?? '').trim();
      if (!messageId) {
        return jsonResponse({ error: 'message_id is required' }, 400, origin);
      }
      const isRead = body.is_read !== false;
      const updated = await patchMailMessage(accessToken, messageId, { isRead });
      return jsonResponse(
        { message: mapMessageSummary(updated), is_read: isRead },
        200,
        origin,
      );
    }

    if (action === 'delete') {
      const messageId = (body.message_id ?? '').trim();
      if (!messageId) {
        return jsonResponse({ error: 'message_id is required' }, 400, origin);
      }
      const permanent = body.permanent === true;
      const parentFolderId = (body.parent_folder_id ?? '').trim() || null;
      const result = await deleteMailMessage(accessToken, messageId, {
        permanent,
        parentFolderId,
      });
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'mail_delete',
        path: PATH,
        metadata: {
          message_id: messageId,
          mode: result.mode,
          microsoft_email: microsoftEmail,
        },
      });
      return jsonResponse(
        {
          ok: true,
          message_id: messageId,
          mode: result.mode,
          microsoft_email: microsoftEmail,
        },
        200,
        origin,
      );
    }

    if (action === 'archive' || action === 'move') {
      const ids = Array.from(
        new Set(
          [
            (body.message_id ?? '').trim(),
            ...(body.message_ids ?? []).map((id) => String(id ?? '').trim()),
          ].filter(Boolean),
        ),
      );
      if (!ids.length) {
        return jsonResponse(
          { error: 'message_id or message_ids is required' },
          400,
          origin,
        );
      }
      let destinationId = (body.destination_id ?? '').trim();
      if (action === 'archive' || !destinationId) {
        const archive = await fetchMailFolderByWellKnown(accessToken, 'archive');
        destinationId = archive.id;
      }
      const moved = [];
      for (const messageId of ids) {
        moved.push(await moveMailMessage(accessToken, messageId, destinationId));
      }
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'mail_move',
        path: PATH,
        metadata: {
          message_ids: ids,
          destination_id: destinationId,
          mode: action === 'archive' ? 'archive' : 'move',
          count: moved.length,
        },
      });
      return jsonResponse(
        {
          messages: moved.map(mapMessageSummary),
          message: mapMessageSummary(moved[0]!),
        },
        200,
        origin,
      );
    }

    return jsonResponse({ error: 'Unknown action' }, 400, origin);
  } catch (err) {
    console.error('microsoft-mail', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Mail request failed' },
      500,
      origin,
    );
  }
});
