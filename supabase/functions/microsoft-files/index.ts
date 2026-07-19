import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  ensurePortalVault,
  looksLikeResume,
  uploadDriveFileByDrive,
  uploadToVaultDestination,
  type PortalVaultState,
} from '../_shared/documentVault.ts';
import {
  createDriveFolder,
  createDriveSharingLink,
  deleteDriveItem,
  fetchDriveItem,
  fetchDriveItemByDrive,
  fetchDriveItemChildren,
  fetchDriveItemChildrenByDrive,
  fetchDriveRootChildren,
  fetchSharedWithMe,
  getMsConfig,
  getValidAccessToken,
  inviteDriveItem,
  previewDriveItem,
  renameDriveItem,
  requireActiveSalesUser,
  uploadDriveFile,
  type GraphDriveItem,
} from '../_shared/microsoftGraph.ts';
import { auditMsAction } from '../_shared/msAudit.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  action?:
    | 'list'
    | 'shared'
    | 'download'
    | 'preview'
    | 'upload'
    | 'mkdir'
    | 'rename'
    | 'delete'
    | 'share_link'
    | 'share_invite'
    | 'item'
    | 'ensure_vault'
    | 'salesforce_copy_stub';
  item_id?: string;
  parent_id?: string | null;
  /** When set, list/preview against /drives/{drive_id}/items/... (shared folders). */
  drive_id?: string | null;
  /**
   * Special list sources: downloads | company | company_resumes | my_drive (default) | shared_with_me
   * Ignored when parent_id is set (except company drive browse).
   */
  source?:
    | 'my_drive'
    | 'shared_with_me'
    | 'downloads'
    | 'company'
    | 'company_resumes';
  /** Upload destination shortcut: downloads | company_resumes | (omit = parent_id / root) */
  destination?: 'downloads' | 'company_resumes' | null;
  name?: string;
  file_name?: string;
  content_type?: string;
  /** Base64 file content for simple upload (≤4 MB). */
  content_base64?: string;
  share_type?: 'view' | 'edit';
  /** Only organization is allowed by default; anonymous rejected. */
  share_scope?: 'organization' | 'anonymous' | 'users';
  emails?: string[];
  message?: string;
  role?: 'read' | 'write';
  send_invitation?: boolean;
  audit?: boolean;
};

const PATH = '/sales/files';

function mapItem(item: GraphDriveItem) {
  const remote = item.remoteItem;
  const isFolder = Boolean(item.folder || remote?.folder);
  const name = item.name ?? remote?.name ?? 'Untitled';
  const size = item.size ?? remote?.size ?? null;
  const webUrl = item.webUrl ?? remote?.webUrl ?? null;
  const mime = item.file?.mimeType ?? remote?.file?.mimeType ?? null;
  const driveId =
    item.parentReference?.driveId ?? remote?.parentReference?.driveId ?? null;
  const remoteId = remote?.id ?? null;

  return {
    id: item.id,
    name,
    size,
    web_url: webUrl,
    created_at: item.createdDateTime ?? null,
    modified_at: item.lastModifiedDateTime ?? null,
    is_folder: isFolder,
    child_count: item.folder?.childCount ?? remote?.folder?.childCount ?? null,
    mime_type: mime,
    parent_id: item.parentReference?.id ?? null,
    parent_path: item.parentReference?.path ?? null,
    drive_id: driveId,
    remote_item_id: remoteId,
    shared_scope: item.shared?.scope ?? null,
  };
}

/** Prefer remote item id when browsing/previewing shared items. */
function resolveSharedItemIds(item: {
  id: string;
  drive_id: string | null;
  remote_item_id: string | null;
}) {
  return {
    driveId: item.drive_id,
    itemId: item.remote_item_id || item.id,
  };
}

function decodeBase64(b64: string): Uint8Array {
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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
    const action = body.action ?? 'list';

    let accessToken: string;
    let grantedScopes: string | null = null;
    try {
      const result = await getValidAccessToken(service, config, salesUser.id);
      accessToken = result.accessToken;
      grantedScopes = result.connection.scopes ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Not connected';
      return jsonResponse({ error: message, needs_reconnect: true }, 401, origin);
    }

    if (action === 'ensure_vault') {
      const vault = await ensurePortalVault(accessToken, grantedScopes);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'files_vault_ensure',
        path: PATH,
        metadata: {
          downloads_id: vault.downloads.item_id,
          company_available: vault.company.available,
          company_mode: vault.company.mode,
          resumes_id: vault.company.resumes?.item_id ?? null,
        },
      });
      return jsonResponse({ vault }, 200, origin);
    }

    if (action === 'salesforce_copy_stub') {
      const itemId = (body.item_id ?? '').trim();
      if (!itemId) {
        return jsonResponse({ error: 'item_id is required' }, 400, origin);
      }
      const driveId = (body.drive_id ?? '').trim() || null;
      const item = driveId
        ? await fetchDriveItemByDrive(accessToken, driveId, itemId)
        : await fetchDriveItem(accessToken, itemId);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'files_salesforce_copy_stub',
        path: PATH,
        metadata: {
          item_id: itemId,
          drive_id: driveId,
          name: item.name ?? null,
          status: 'not_wired',
        },
      });
      return jsonResponse(
        {
          ok: false,
          wired: false,
          message:
            'Salesforce Files upload is not wired yet. Configure Connected App credentials and see SETUP_SALESFORCE_RESUMES.md. Recruit 619 resume sync uses the salesforce-resume-sync edge function when SF_ env secrets are set.',
          item: mapItem(item),
        },
        200,
        origin,
      );
    }

    if (action === 'list') {
      const parentId = (body.parent_id ?? body.item_id ?? '').trim();
      let driveId = (body.drive_id ?? '').trim();
      const sourceReq = (body.source ?? '').trim() || null;

      let vault: PortalVaultState | null = null;
      const needVault =
        sourceReq === 'downloads' ||
        sourceReq === 'company' ||
        sourceReq === 'company_resumes' ||
        (!parentId && !driveId && !sourceReq);

      if (needVault || sourceReq === 'downloads' || sourceReq === 'company' || sourceReq === 'company_resumes') {
        try {
          vault = await ensurePortalVault(accessToken, grantedScopes);
        } catch (err) {
          console.warn('ensurePortalVault', err);
        }
      }

      let listParentId = parentId;
      let listDriveId = driveId;
      let listSource:
        | 'my_drive'
        | 'shared_with_me'
        | 'downloads'
        | 'company'
        | 'company_resumes' = 'my_drive';
      let breadcrumbRoot = 'My files';

      if (!parentId && sourceReq === 'downloads' && vault) {
        listParentId = vault.downloads.item_id;
        listDriveId = vault.downloads.drive_id ?? '';
        listSource = 'downloads';
        breadcrumbRoot = 'Downloads';
      } else if (!parentId && sourceReq === 'company_resumes' && vault?.company.resumes) {
        listParentId = vault.company.resumes.item_id;
        listDriveId = vault.company.resumes.drive_id ?? '';
        listSource = 'company_resumes';
        breadcrumbRoot = 'Company Resumes';
      } else if (!parentId && sourceReq === 'company' && vault?.company.root) {
        listParentId = vault.company.root.item_id;
        listDriveId = vault.company.root.drive_id ?? '';
        listSource = 'company';
        breadcrumbRoot = 'Company Shared';
      } else if (driveId) {
        listSource = sourceReq === 'company' || sourceReq === 'company_resumes'
          ? (sourceReq as 'company' | 'company_resumes')
          : 'shared_with_me';
        breadcrumbRoot =
          listSource === 'company'
            ? 'Company Shared'
            : listSource === 'company_resumes'
              ? 'Company Resumes'
              : 'Shared with me';
      } else if (sourceReq === 'company' || sourceReq === 'company_resumes') {
        return jsonResponse(
          {
            error:
              vault?.company.message ||
              'Company shared vault is not available. Configure MS_COMPANY_SITE_PATH + Sites.ReadWrite.All or share a "Company Files" folder.',
            company: vault?.company ?? null,
            vault,
          },
          503,
          origin,
        );
      }

      driveId = listDriveId;

      let items: GraphDriveItem[];
      if (listParentId && driveId) {
        items = await fetchDriveItemChildrenByDrive(accessToken, driveId, listParentId);
      } else if (listParentId) {
        items = await fetchDriveItemChildren(accessToken, listParentId);
      } else {
        items = await fetchDriveRootChildren(accessToken);
        listSource = 'my_drive';
      }

      let breadcrumb: Array<{ id: string | null; name: string; drive_id?: string | null }> = [
        { id: null, name: breadcrumbRoot, drive_id: driveId || null },
      ];
      if (listParentId) {
        try {
          const folder = driveId
            ? await fetchDriveItemByDrive(accessToken, driveId, listParentId)
            : await fetchDriveItem(accessToken, listParentId);
          const path = folder.parentReference?.path ?? '';
          const parts = path
            .replace(/^\/drive\/root:?/, '')
            .replace(/^\/drives\/[^/]+\/root:?/, '')
            .split('/')
            .map((p) => decodeURIComponent(p))
            .filter(Boolean);
          if (
            listSource === 'downloads' ||
            listSource === 'company' ||
            listSource === 'company_resumes'
          ) {
            breadcrumb = [
              {
                id: listSource === 'downloads'
                  ? vault?.downloads.item_id ?? null
                  : listSource === 'company_resumes'
                    ? vault?.company.resumes?.item_id ?? null
                    : vault?.company.root?.item_id ?? null,
                name: breadcrumbRoot,
                drive_id: driveId || null,
              },
            ];
            if (folder.id !== breadcrumb[0].id) {
              breadcrumb.push({
                id: folder.id,
                name: folder.name ?? 'Folder',
                drive_id: driveId || folder.parentReference?.driveId || null,
              });
            }
          } else {
            breadcrumb = [
              { id: null, name: driveId ? 'Shared with me' : 'My files' },
              ...parts.map((name) => ({ id: null as string | null, name })),
              {
                id: folder.id,
                name: folder.name ?? 'Folder',
                drive_id: driveId || folder.parentReference?.driveId || null,
              },
            ];
          }
        } catch {
          breadcrumb = [
            { id: null, name: breadcrumbRoot, drive_id: driveId || null },
            { id: listParentId, name: 'Folder', drive_id: driveId || null },
          ];
        }
      }

      if (body.audit !== false) {
        await auditMsAction(service, {
          userId: salesUser.id,
          email: salesUser.email,
          eventType: 'files_browse',
          path: PATH,
          metadata: {
            parent_id: listParentId || null,
            drive_id: driveId || null,
            source: listSource,
            count: items.length,
          },
        });
      }

      return jsonResponse(
        {
          source: listSource,
          parent_id: listParentId || null,
          drive_id: driveId || null,
          breadcrumb,
          items: items.map(mapItem),
          vault: vault
            ? {
                downloads: vault.downloads,
                company: vault.company,
              }
            : null,
        },
        200,
        origin,
      );
    }

    if (action === 'shared') {
      const items = await fetchSharedWithMe(accessToken);
      if (body.audit !== false) {
        await auditMsAction(service, {
          userId: salesUser.id,
          email: salesUser.email,
          eventType: 'files_browse',
          path: PATH,
          metadata: { source: 'shared_with_me', count: items.length },
        });
      }
      return jsonResponse(
        {
          source: 'shared_with_me',
          parent_id: null,
          drive_id: null,
          breadcrumb: [{ id: null, name: 'Shared with me' }],
          items: items.map(mapItem),
        },
        200,
        origin,
      );
    }

    if (action === 'item') {
      const itemId = (body.item_id ?? '').trim();
      if (!itemId) {
        return jsonResponse({ error: 'item_id is required' }, 400, origin);
      }
      const driveId = (body.drive_id ?? '').trim();
      const item = driveId
        ? await fetchDriveItemByDrive(accessToken, driveId, itemId)
        : await fetchDriveItem(accessToken, itemId);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'files_open',
        path: PATH,
        metadata: { item_id: itemId, drive_id: driveId || null, name: item.name ?? null },
      });
      return jsonResponse({ item: mapItem(item) }, 200, origin);
    }

    if (action === 'download') {
      // Intentionally disabled: files stay in-system; use in-portal preview + org share.
      return jsonResponse(
        {
          error:
            'Downloads are disabled in the sales portal. Open files in the in-portal viewer or share with org permissions.',
          downloads_disabled: true,
        },
        403,
        origin,
      );
    }

    if (action === 'preview') {
      const rawItemId = (body.item_id ?? '').trim();
      if (!rawItemId) {
        return jsonResponse({ error: 'item_id is required' }, 400, origin);
      }
      let driveId = (body.drive_id ?? '').trim() || null;
      let itemId = rawItemId;

      // If client passed a sharedWithMe wrapper id without drive_id, resolve via item fetch
      if (!driveId) {
        try {
          const wrapper = await fetchDriveItem(accessToken, rawItemId);
          const mapped = mapItem(wrapper);
          if (mapped.remote_item_id && mapped.drive_id) {
            const resolved = resolveSharedItemIds(mapped);
            driveId = resolved.driveId;
            itemId = resolved.itemId;
          }
        } catch {
          // fall through with raw ids
        }
      }

      const preview = await previewDriveItem(accessToken, { itemId, driveId });
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'files_open',
        path: PATH,
        metadata: {
          item_id: itemId,
          drive_id: driveId,
          name: preview.name,
          mime_type: preview.mime_type,
          mode: 'preview',
          previewable: preview.previewable,
          has_get_url: Boolean(preview.get_url),
          has_post_url: Boolean(preview.post_url),
          has_office_embed: Boolean(preview.office_embed_url),
        },
      });
      return jsonResponse({ preview }, 200, origin);
    }

    if (action === 'upload') {
      const fileName = (body.file_name ?? body.name ?? '').trim();
      const b64 = (body.content_base64 ?? '').trim();
      if (!fileName) {
        return jsonResponse({ error: 'file_name is required' }, 400, origin);
      }
      if (!b64) {
        return jsonResponse({ error: 'content_base64 is required' }, 400, origin);
      }
      let bytes: Uint8Array;
      try {
        bytes = decodeBase64(b64);
      } catch {
        return jsonResponse({ error: 'Invalid base64 content' }, 400, origin);
      }

      const dest =
        body.destination === 'company_resumes'
          ? 'company_resumes'
          : body.destination === 'downloads'
            ? 'downloads'
            : null;

      let item: GraphDriveItem;
      let destinationLabel: string | null = null;
      let vaultDest: string | null = null;

      if (dest) {
        const uploaded = await uploadToVaultDestination(accessToken, {
          destination: dest,
          fileName,
          contentType: body.content_type,
          bytes,
          grantedScopes,
        });
        item = uploaded.item;
        destinationLabel = uploaded.destination;
        vaultDest = dest;
      } else if ((body.drive_id ?? '').trim() && (body.parent_id ?? '').trim()) {
        item = await uploadDriveFileByDrive(accessToken, {
          driveId: (body.drive_id ?? '').trim(),
          parentId: (body.parent_id ?? '').trim(),
          fileName,
          contentType: body.content_type,
          bytes,
        });
      } else {
        item = await uploadDriveFile(accessToken, {
          parentId: body.parent_id,
          fileName,
          contentType: body.content_type,
          bytes,
        });
      }

      const eventType =
        vaultDest === 'company_resumes'
          ? 'files_save_company_resumes'
          : vaultDest === 'downloads'
            ? 'files_save_downloads'
            : 'files_upload';

      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType,
        path: PATH,
        metadata: {
          item_id: item.id,
          name: item.name ?? fileName,
          size: item.size ?? bytes.byteLength,
          parent_id: body.parent_id ?? null,
          drive_id: body.drive_id ?? null,
          destination: vaultDest ?? destinationLabel,
          looks_like_resume: looksLikeResume(fileName, body.content_type),
        },
      });
      return jsonResponse(
        {
          item: mapItem(item),
          destination: destinationLabel,
          vault_destination: vaultDest,
        },
        200,
        origin,
      );
    }

    if (action === 'mkdir') {
      const name = (body.name ?? '').trim();
      if (!name) {
        return jsonResponse({ error: 'name is required' }, 400, origin);
      }
      const item = await createDriveFolder(accessToken, {
        parentId: body.parent_id,
        name,
      });
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'files_mkdir',
        path: PATH,
        metadata: {
          item_id: item.id,
          name: item.name ?? name,
          parent_id: body.parent_id ?? null,
        },
      });
      return jsonResponse({ item: mapItem(item) }, 200, origin);
    }

    if (action === 'rename') {
      const itemId = (body.item_id ?? '').trim();
      const name = (body.name ?? '').trim();
      if (!itemId) {
        return jsonResponse({ error: 'item_id is required' }, 400, origin);
      }
      if (!name) {
        return jsonResponse({ error: 'name is required' }, 400, origin);
      }
      const item = await renameDriveItem(accessToken, itemId, name);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'files_rename',
        path: PATH,
        metadata: { item_id: itemId, name },
      });
      return jsonResponse({ item: mapItem(item) }, 200, origin);
    }

    if (action === 'delete') {
      const itemId = (body.item_id ?? '').trim();
      if (!itemId) {
        return jsonResponse({ error: 'item_id is required' }, 400, origin);
      }
      await deleteDriveItem(accessToken, itemId);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'files_delete',
        path: PATH,
        metadata: { item_id: itemId, name: body.name ?? null },
      });
      return jsonResponse({ ok: true, item_id: itemId }, 200, origin);
    }

    if (action === 'share_link') {
      const itemId = (body.item_id ?? '').trim();
      if (!itemId) {
        return jsonResponse({ error: 'item_id is required' }, 400, origin);
      }
      // Reject anonymous public links — prefer org-only
      if (body.share_scope === 'anonymous') {
        return jsonResponse(
          {
            error:
              'Anonymous public links are disabled. Use organization scope or invite by email.',
          },
          400,
          origin,
        );
      }
      const perm = await createDriveSharingLink(accessToken, itemId, {
        type: body.share_type === 'edit' ? 'edit' : 'view',
        scope: 'organization',
      });
      const linkUrl = perm.link?.webUrl ?? null;
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'files_share',
        path: PATH,
        metadata: {
          item_id: itemId,
          mode: 'link',
          scope: 'organization',
          type: body.share_type === 'edit' ? 'edit' : 'view',
          has_url: Boolean(linkUrl),
        },
      });
      return jsonResponse(
        {
          permission: {
            id: perm.id ?? null,
            roles: perm.roles ?? [],
            link_type: perm.link?.type ?? null,
            link_scope: perm.link?.scope ?? 'organization',
            web_url: linkUrl,
          },
        },
        200,
        origin,
      );
    }

    if (action === 'share_invite') {
      const itemId = (body.item_id ?? '').trim();
      const emails = (body.emails ?? []).map((e) => e.trim()).filter(Boolean);
      if (!itemId) {
        return jsonResponse({ error: 'item_id is required' }, 400, origin);
      }
      if (!emails.length) {
        return jsonResponse({ error: 'emails required' }, 400, origin);
      }
      const result = await inviteDriveItem(accessToken, itemId, {
        emails,
        role: body.role === 'write' ? 'write' : 'read',
        message: body.message,
        sendInvitation: body.send_invitation !== false,
      });
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'files_share',
        path: PATH,
        metadata: {
          item_id: itemId,
          mode: 'invite',
          emails,
          role: body.role === 'write' ? 'write' : 'read',
          count: result.value?.length ?? emails.length,
        },
      });
      return jsonResponse(
        {
          permissions: (result.value ?? []).map((p) => ({
            id: p.id ?? null,
            roles: p.roles ?? [],
            email: p.invitation?.email ?? p.grantedToV2?.user?.email ?? null,
          })),
        },
        200,
        origin,
      );
    }

    return jsonResponse({ error: 'Unknown action' }, 400, origin);
  } catch (err) {
    console.error('microsoft-files', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Files request failed' },
      500,
      origin,
    );
  }
});
