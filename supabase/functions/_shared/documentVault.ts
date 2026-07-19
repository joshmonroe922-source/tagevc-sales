/**
 * Tage Portal document vault — personal Downloads + company shared Resumes.
 *
 * Folder layout (personal OneDrive):
 *   Tage Portal/
 *     Downloads/          ← mail save / portal "download" destination (not local disk)
 *
 * Company shared (SharePoint site drive or shared folder):
 *   Company Files/        ← or env-configured root
 *     Resumes/            ← recruiting resumes (survives user offboarding)
 *
 * Company vault resolution order:
 *   1. MS_COMPANY_DRIVE_ID (+ optional MS_COMPANY_ROOT_ITEM_ID)
 *   2. MS_COMPANY_SITE_PATH with Sites.ReadWrite.All (or Sites.Read.All + write if granted)
 *   3. sharedWithMe folder named "Company Files" / "Tage Company Files" / "Tage Portal Company Files"
 */

import {
  createDriveFolder,
  fetchDriveItem,
  fetchDriveItemByDrive,
  fetchDriveItemChildren,
  fetchDriveItemChildrenByDrive,
  fetchSharedWithMe,
  scopesInclude,
  uploadDriveFile,
  type GraphDriveItem,
} from './microsoftGraph.ts';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export const PERSONAL_VAULT_ROOT = 'Tage Portal';
export const PERSONAL_DOWNLOADS = 'Downloads';
export const COMPANY_FILES_NAME = 'Company Files';
export const COMPANY_RESUMES = 'Resumes';

const COMPANY_SHARED_ALIASES = [
  'Company Files',
  'Tage Company Files',
  'Tage Portal Company Files',
  'Company Shared',
];

export type VaultFolderRef = {
  drive_id: string | null;
  item_id: string;
  name: string;
  web_url: string | null;
  path_label: string;
};

export type PortalVaultState = {
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

function encodePathSegment(name: string): string {
  return encodeURIComponent(name.trim()).replace(/%2F/gi, '/');
}

function buildRootPath(segments: string[]): string {
  return segments.map(encodePathSegment).join('/');
}

/** GET /me/drive/root:/path: — 404 → null */
export async function fetchDriveItemByPath(
  accessToken: string,
  pathSegments: string[],
): Promise<GraphDriveItem | null> {
  if (!pathSegments.length) return null;
  const path = buildRootPath(pathSegments);
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/root:/${path}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph path lookup failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphDriveItem;
}

/** GET /drives/{id}/root:/path: — 404 → null */
export async function fetchDriveItemByPathOnDrive(
  accessToken: string,
  driveId: string,
  pathSegments: string[],
): Promise<GraphDriveItem | null> {
  if (!pathSegments.length) {
    const res = await fetch(
      `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/root`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph drive root failed: ${res.status} ${text}`);
    }
    return (await res.json()) as GraphDriveItem;
  }
  const path = buildRootPath(pathSegments);
  const res = await fetch(
    `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/root:/${path}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph drive path lookup failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphDriveItem;
}

export async function createDriveFolderByDrive(
  accessToken: string,
  opts: { driveId: string; parentId: string; name: string },
): Promise<GraphDriveItem> {
  const name = opts.name.trim();
  if (!name) throw new Error('Folder name is required');
  const res = await fetch(
    `${GRAPH_BASE}/drives/${encodeURIComponent(opts.driveId)}/items/${encodeURIComponent(opts.parentId)}/children`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    },
  );
  if (res.status === 409) {
    // Already exists — list children and return match
    const kids = await fetchDriveItemChildrenByDrive(
      accessToken,
      opts.driveId,
      opts.parentId,
    );
    const found = kids.find(
      (k) => (k.name ?? '').toLowerCase() === name.toLowerCase() && k.folder,
    );
    if (found) return found;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph create folder (drive) failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphDriveItem;
}

export async function uploadDriveFileByDrive(
  accessToken: string,
  opts: {
    driveId: string;
    parentId: string;
    fileName: string;
    contentType?: string;
    bytes: Uint8Array;
  },
): Promise<GraphDriveItem> {
  const name = opts.fileName.trim();
  if (!name) throw new Error('fileName is required');
  if (opts.bytes.byteLength > 4 * 1024 * 1024) {
    throw new Error(
      'File too large for portal upload (max 4 MB). Use a smaller file or upload via OneDrive outside this download-restricted portal.',
    );
  }
  const encodedName = encodeURIComponent(name);
  const path =
    `${GRAPH_BASE}/drives/${encodeURIComponent(opts.driveId)}/items/${encodeURIComponent(opts.parentId)}:/${encodedName}:/content`;
  const res = await fetch(path, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': opts.contentType?.trim() || 'application/octet-stream',
    },
    body: opts.bytes,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph upload (drive) failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GraphDriveItem;
}

/** Get-or-create a child folder by name under a personal-drive parent. */
async function ensureChildFolderPersonal(
  accessToken: string,
  parentId: string | null,
  name: string,
): Promise<GraphDriveItem> {
  const kids = parentId
    ? await fetchDriveItemChildren(accessToken, parentId)
    : await (async () => {
        const res = await fetch(
          `${GRAPH_BASE}/me/drive/root/children?$top=200&$select=id,name,folder,webUrl,parentReference`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Graph list root failed: ${res.status} ${text}`);
        }
        const json = (await res.json()) as { value?: GraphDriveItem[] };
        return json.value ?? [];
      })();

  const existing = kids.find(
    (k) => (k.name ?? '').toLowerCase() === name.toLowerCase() && k.folder,
  );
  if (existing) return existing;

  try {
    return await createDriveFolder(accessToken, { parentId, name });
  } catch (err) {
    // Race / conflictBehavior rename — re-list
    const again = parentId
      ? await fetchDriveItemChildren(accessToken, parentId)
      : kids;
    const found = again.find(
      (k) => (k.name ?? '').toLowerCase() === name.toLowerCase() && k.folder,
    );
    if (found) return found;
    throw err;
  }
}

async function ensureChildFolderOnDrive(
  accessToken: string,
  driveId: string,
  parentId: string,
  name: string,
): Promise<GraphDriveItem> {
  const kids = await fetchDriveItemChildrenByDrive(accessToken, driveId, parentId);
  const existing = kids.find(
    (k) => (k.name ?? '').toLowerCase() === name.toLowerCase() && k.folder,
  );
  if (existing) return existing;
  return createDriveFolderByDrive(accessToken, { driveId, parentId, name });
}

function toRef(
  item: GraphDriveItem,
  pathLabel: string,
  driveIdOverride?: string | null,
): VaultFolderRef {
  return {
    drive_id:
      driveIdOverride ??
      item.parentReference?.driveId ??
      null,
    item_id: item.id!,
    name: item.name ?? pathLabel,
    web_url: item.webUrl ?? null,
    path_label: pathLabel,
  };
}

/** Ensure Tage Portal/Downloads exists on the signed-in user's OneDrive. */
export async function ensurePersonalDownloads(
  accessToken: string,
): Promise<VaultFolderRef> {
  const byPath = await fetchDriveItemByPath(accessToken, [
    PERSONAL_VAULT_ROOT,
    PERSONAL_DOWNLOADS,
  ]);
  if (byPath?.id) {
    return toRef(byPath, `${PERSONAL_VAULT_ROOT}/${PERSONAL_DOWNLOADS}`);
  }

  const root = await ensureChildFolderPersonal(accessToken, null, PERSONAL_VAULT_ROOT);
  const downloads = await ensureChildFolderPersonal(
    accessToken,
    root.id!,
    PERSONAL_DOWNLOADS,
  );
  return toRef(downloads, `${PERSONAL_VAULT_ROOT}/${PERSONAL_DOWNLOADS}`);
}

type SiteDrive = { id?: string; name?: string; webUrl?: string };

async function resolveSharePointSiteDrive(
  accessToken: string,
  sitePath: string,
): Promise<{ driveId: string; rootItemId: string } | null> {
  // sitePath examples:
  //   netorgft15674001.sharepoint.com                      (Tage tenant root/default site)
  //   netorgft15674001.sharepoint.com:/sites/CompanyFiles   (a dedicated sub-site, if created)
  const trimmed = sitePath.trim().replace(/^https?:\/\//i, '');
  const res = await fetch(
    `${GRAPH_BASE}/sites/${trimmed}?$select=id,name,webUrl`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 403 || res.status === 401) {
    return null;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SharePoint site lookup failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const site = (await res.json()) as { id?: string };
  if (!site.id) return null;

  const driveRes = await fetch(
    `${GRAPH_BASE}/sites/${encodeURIComponent(site.id)}/drive?$select=id,name,webUrl`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!driveRes.ok) {
    const text = await driveRes.text();
    throw new Error(`SharePoint drive lookup failed: ${driveRes.status} ${text.slice(0, 200)}`);
  }
  const drive = (await driveRes.json()) as SiteDrive;
  if (!drive.id) return null;

  const root = await fetchDriveItemByPathOnDrive(accessToken, drive.id, []);
  if (!root?.id) return null;
  return { driveId: drive.id, rootItemId: root.id };
}

async function findCompanyFolderInShared(
  accessToken: string,
): Promise<{ driveId: string; itemId: string; item: GraphDriveItem } | null> {
  const shared = await fetchSharedWithMe(accessToken);
  for (const item of shared) {
    const name = (item.name ?? item.remoteItem?.name ?? '').trim();
    const isFolder = Boolean(item.folder || item.remoteItem?.folder);
    if (!isFolder) continue;
    const match = COMPANY_SHARED_ALIASES.some(
      (a) => a.toLowerCase() === name.toLowerCase(),
    );
    if (!match) continue;
    const driveId =
      item.remoteItem?.parentReference?.driveId ??
      item.parentReference?.driveId ??
      null;
    const itemId = item.remoteItem?.id ?? item.id ?? null;
    if (driveId && itemId) {
      return { driveId, itemId, item };
    }
  }
  return null;
}

/**
 * Resolve company shared root + ensure Resumes child folder when writable.
 */
export async function ensureCompanyResumesVault(
  accessToken: string,
  grantedScopes: string | null | undefined,
): Promise<PortalVaultState['company']> {
  const configuredDriveId = (Deno.env.get('MS_COMPANY_DRIVE_ID') ?? '').trim();
  const configuredRootId = (Deno.env.get('MS_COMPANY_ROOT_ITEM_ID') ?? '').trim();
  const sitePath = (Deno.env.get('MS_COMPANY_SITE_PATH') ?? '').trim();
  const hasSitesWrite = scopesInclude(grantedScopes, 'Sites.ReadWrite.All');
  const hasSitesRead = scopesInclude(grantedScopes, 'Sites.Read.All') || hasSitesWrite;

  const ensureResumes = async (
    driveId: string,
    rootItemId: string,
    mode: PortalVaultState['company']['mode'],
  ): Promise<PortalVaultState['company']> => {
    const rootItem = await fetchDriveItemByDrive(accessToken, driveId, rootItemId);
    const rootRef = toRef(
      rootItem,
      COMPANY_FILES_NAME,
      driveId,
    );
    // Optional nested "Company Files" under site root when MS_COMPANY_CREATE_NESTED=1
    let parentId = rootItemId;
    const nest = (Deno.env.get('MS_COMPANY_CREATE_NESTED') ?? '').trim() === '1';
    if (nest) {
      const companyFolder = await ensureChildFolderOnDrive(
        accessToken,
        driveId,
        rootItemId,
        COMPANY_FILES_NAME,
      );
      parentId = companyFolder.id!;
      rootRef.item_id = parentId;
      rootRef.name = companyFolder.name ?? COMPANY_FILES_NAME;
      rootRef.web_url = companyFolder.webUrl ?? rootRef.web_url;
      rootRef.path_label = COMPANY_FILES_NAME;
    }

    const resumes = await ensureChildFolderOnDrive(
      accessToken,
      driveId,
      parentId,
      COMPANY_RESUMES,
    );
    return {
      available: true,
      mode,
      root: rootRef,
      resumes: toRef(resumes, `${COMPANY_FILES_NAME}/${COMPANY_RESUMES}`, driveId),
      message: null,
      needs_sites_scope: false,
    };
  };

  try {
    if (configuredDriveId) {
      let rootId = configuredRootId;
      if (!rootId) {
        const root = await fetchDriveItemByPathOnDrive(accessToken, configuredDriveId, []);
        rootId = root?.id ?? '';
      }
      if (!rootId) {
        return {
          available: false,
          mode: 'unavailable',
          root: null,
          resumes: null,
          message:
            'MS_COMPANY_DRIVE_ID is set but the drive root could not be resolved. Set MS_COMPANY_ROOT_ITEM_ID.',
          needs_sites_scope: false,
        };
      }
      return await ensureResumes(configuredDriveId, rootId, 'configured_drive');
    }

    if (sitePath) {
      if (!hasSitesRead && !hasSitesWrite) {
        return {
          available: false,
          mode: 'unavailable',
          root: null,
          resumes: null,
          message:
            'MS_COMPANY_SITE_PATH is set but the token lacks Sites.ReadWrite.All (or Sites.Read.All). Add the scope in Azure, update MS_GRAPH_SCOPES, admin-consent, and Reconnect.',
          needs_sites_scope: true,
        };
      }
      const resolved = await resolveSharePointSiteDrive(accessToken, sitePath);
      if (!resolved) {
        return {
          available: false,
          mode: 'unavailable',
          root: null,
          resumes: null,
          message:
            'Could not open the configured SharePoint site (missing Sites scope or site path). See SETUP_CALENDAR.md / SETUP_SALESFORCE_RESUMES.md.',
          needs_sites_scope: !hasSitesWrite,
        };
      }
      return await ensureResumes(resolved.driveId, resolved.rootItemId, 'sharepoint_site');
    }

    const shared = await findCompanyFolderInShared(accessToken);
    if (shared) {
      return await ensureResumes(shared.driveId, shared.itemId, 'shared_with_me');
    }

    return {
      available: false,
      mode: 'unavailable',
      root: null,
      resumes: null,
      message:
        'Company shared vault not configured. Prefer SharePoint: set MS_COMPANY_SITE_PATH and grant Sites.ReadWrite.All (least privilege: Sites.Selected if your tenant supports it), or share a folder named "Company Files" with each portal user. See SETUP_CALENDAR.md.',
      needs_sites_scope: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Company vault setup failed';
    return {
      available: false,
      mode: 'unavailable',
      root: null,
      resumes: null,
      message: msg,
      needs_sites_scope: /403|401|Sites\.|site/i.test(msg),
    };
  }
}

export async function ensurePortalVault(
  accessToken: string,
  grantedScopes: string | null | undefined,
): Promise<PortalVaultState> {
  const downloads = await ensurePersonalDownloads(accessToken);
  const company = await ensureCompanyResumesVault(accessToken, grantedScopes);
  return { downloads, company };
}

export function looksLikeResume(fileName: string, contentType?: string | null): boolean {
  const n = fileName.toLowerCase();
  if (/\b(resume|curriculum|cv)\b/.test(n.replace(/[_\-.]/g, ' '))) return true;
  if (n.includes('resume') || n.includes('curriculum') || /(^|[^a-z])cv([^a-z]|$)/.test(n)) {
    return true;
  }
  const mime = (contentType ?? '').toLowerCase();
  // Heuristic only — UI still offers explicit "Save to company Resumes"
  if (
    (mime.includes('pdf') || mime.includes('word') || n.endsWith('.pdf') || n.endsWith('.docx')) &&
    /\b(resume|cv)\b/i.test(fileName)
  ) {
    return true;
  }
  return false;
}

/** Upload bytes into personal Downloads or company Resumes. */
export async function uploadToVaultDestination(
  accessToken: string,
  opts: {
    destination: 'downloads' | 'company_resumes';
    fileName: string;
    contentType?: string;
    bytes: Uint8Array;
    grantedScopes?: string | null;
    vault?: PortalVaultState;
  },
): Promise<{ item: GraphDriveItem; destination: string; folder: VaultFolderRef }> {
  const vault = opts.vault ?? (await ensurePortalVault(accessToken, opts.grantedScopes));

  if (opts.destination === 'downloads') {
    const item = await uploadDriveFile(accessToken, {
      parentId: vault.downloads.item_id,
      fileName: opts.fileName,
      contentType: opts.contentType,
      bytes: opts.bytes,
    });
    return {
      item,
      destination: vault.downloads.path_label,
      folder: vault.downloads,
    };
  }

  if (!vault.company.available || !vault.company.resumes) {
    throw new Error(
      vault.company.message ||
        'Company Resumes folder is not available. Configure SharePoint company vault (SETUP_CALENDAR.md).',
    );
  }
  const folder = vault.company.resumes;
  if (!folder.drive_id) {
    throw new Error('Company Resumes folder is missing drive_id');
  }
  const item = await uploadDriveFileByDrive(accessToken, {
    driveId: folder.drive_id,
    parentId: folder.item_id,
    fileName: opts.fileName,
    contentType: opts.contentType,
    bytes: opts.bytes,
  });
  return {
    item,
    destination: folder.path_label,
    folder,
  };
}

/** Soft text extract for resume sync — DOCX XML + naive PDF strings. OCR/AI later. */
export function extractResumeTextHint(
  fileName: string,
  bytes: Uint8Array,
): { text: string; method: 'docx_xml' | 'pdf_strings' | 'none'; needs_ocr: boolean } {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.docx')) {
    // DOCX is a zip; without a zip lib we only note that structured extract needs tooling.
    // Try UTF-8 scan for email-like / phone patterns in raw bytes (often present in XML uncompressed streams — unreliable).
    const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const emails = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    const phones = raw.match(/\+?1?[\s\-.]?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g) ?? [];
    const text = [...new Set([...emails, ...phones])].join('\n');
    return {
      text,
      method: text ? 'docx_xml' : 'none',
      needs_ocr: !text,
    };
  }
  if (lower.endsWith('.pdf') || bytes[0] === 0x25 /* % */) {
    const raw = new TextDecoder('latin1', { fatal: false }).decode(bytes);
    // Pull printable strings between parentheses (PDF literal strings) — weak but free.
    const chunks: string[] = [];
    const re = /\((?:\\.|[^\\)]){3,120}\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) && chunks.length < 80) {
      const inner = m[0]
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (/[A-Za-z]{3,}/.test(inner)) chunks.push(inner);
    }
    const text = chunks.join('\n').slice(0, 8000);
    const hasContact = /@|phone|\d{3}[\s\-.]?\d{3}/i.test(text);
    return {
      text,
      method: text ? 'pdf_strings' : 'none',
      needs_ocr: !hasContact,
    };
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, 8000);
  return { text, method: text.trim() ? 'docx_xml' : 'none', needs_ocr: !text.trim() };
}

export function parseContactHeuristic(text: string): {
  email: string | null;
  phone: string | null;
  name: string | null;
} {
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = text.match(
    /(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/,
  );
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const name =
    lines.find(
      (l) =>
        l.length > 3 &&
        l.length < 60 &&
        !l.includes('@') &&
        /^[A-Za-z][A-Za-z\s.'\-]+$/.test(l) &&
        l.split(/\s+/).length >= 2,
    ) ?? null;
  return {
    email: emailMatch?.[0]?.toLowerCase() ?? null,
    phone: phoneMatch?.[0]?.replace(/\s+/g, ' ').trim() ?? null,
    name,
  };
}

/** Resolve personal drive id for return payloads (best-effort). */
export async function fetchMyDriveId(accessToken: string): Promise<string | null> {
  const res = await fetch(`${GRAPH_BASE}/me/drive?$select=id`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { id?: string };
  return json.id ?? null;
}

export async function getPersonalDownloadsItem(
  accessToken: string,
): Promise<GraphDriveItem | null> {
  return fetchDriveItemByPath(accessToken, [PERSONAL_VAULT_ROOT, PERSONAL_DOWNLOADS]);
}

export { fetchDriveItem, fetchDriveItemChildren };
