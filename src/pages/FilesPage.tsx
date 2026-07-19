import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createDriveFolder,
  createOrgShareLink,
  deleteDriveItem,
  ensureDocumentVault,
  fetchCalendarStatus,
  fetchDriveItems,
  fetchSharedDriveItems,
  getDrivePreview,
  inviteDriveShare,
  renameDriveItem,
  searchMeetingPeople,
  setMyWorkEmail,
  startCalendarOAuth,
  stubCopyToSalesforce,
  uploadDriveFile,
  type CalendarStatus,
  type DriveItem,
  type DrivePreview,
  type PeopleSuggestion,
  type PortalVaultInfo,
} from '../lib/calendarApi';
import type { SalesUser } from '../lib/types';
import { formatDateTime } from '../lib/types';

type Props = { salesUser: SalesUser };
type SourceTab = 'downloads' | 'my_drive' | 'company' | 'shared_with_me';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function looksLikeResumeName(name: string): boolean {
  const n = name.toLowerCase().replace(/[_\-.]/g, ' ');
  return /\b(resume|curriculum|cv)\b/.test(n) || n.includes('resume');
}

type ViewerState = {
  item: DriveItem;
  loading: boolean;
  error: string | null;
  preview: DrivePreview | null;
  /** Which iframe src is active: graph getUrl or office embed fallback */
  frameSrc: string | null;
  mode: 'graph' | 'office_embed' | 'unsupported';
};

function formatBytes(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModified(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read file'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function resolvePreviewTarget(item: DriveItem): { itemId: string; driveId: string | null } {
  if (item.remote_item_id && item.drive_id) {
    return { itemId: item.remote_item_id, driveId: item.drive_id };
  }
  return { itemId: item.id, driveId: item.drive_id };
}

/**
 * Graph preview sometimes returns postUrl + postParameters (form POST into iframe).
 * Parse query-string style parameters into hidden fields.
 */
function parsePostParameters(raw: string | null): Array<{ name: string; value: string }> {
  if (!raw) return [];
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  const out: Array<{ name: string; value: string }> = [];
  params.forEach((value, name) => {
    out.push({ name, value });
  });
  return out;
}

export function FilesPage({ salesUser }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [workEmailDraft, setWorkEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  const [source, setSource] = useState<SourceTab>('downloads');
  const [parentId, setParentId] = useState<string | null>(null);
  const [browseDriveId, setBrowseDriveId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<
    Array<{ id: string | null; name: string; drive_id?: string | null }>
  >([{ id: null, name: 'Downloads' }]);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [vault, setVault] = useState<PortalVaultInfo | null>(null);
  const [vaultEnsuring, setVaultEnsuring] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewFormRef = useRef<HTMLFormElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [mkdirBusy, setMkdirBusy] = useState(false);

  const [renameItem, setRenameItem] = useState<DriveItem | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  const [shareItem, setShareItem] = useState<DriveItem | null>(null);
  const [shareMode, setShareMode] = useState<'link' | 'invite'>('invite');
  const [shareRole, setShareRole] = useState<'read' | 'write'>('read');
  const [shareLinkUrl, setShareLinkUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<PeopleSuggestion[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [selectedPeople, setSelectedPeople] = useState<PeopleSuggestion[]>([]);
  const [shareMessage, setShareMessage] = useState('');
  const [sideOpen, setSideOpen] = useState(false);
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  const canFiles = Boolean(status?.capabilities?.files);
  const canPeople = Boolean(status?.capabilities?.people_search);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const s = await fetchCalendarStatus();
      setStatus(s);
      setWorkEmailDraft(s.work_email ?? s.preferred_work_email ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Microsoft status');
    }
  }, []);

  const loadItems = useCallback(
    async (opts: { audit?: boolean } = {}) => {
      if (!status?.connected || !status.configured || !status.capabilities?.files) {
        setItems([]);
        return;
      }
      setItemsLoading(true);
      if (opts.audit !== false) setError(null);
      try {
        if (source === 'shared_with_me' && !parentId) {
          const res = await fetchSharedDriveItems({ audit: opts.audit !== false });
          setItems(res.items);
          setBreadcrumb(res.breadcrumb);
          setBrowseDriveId(null);
        } else {
          const res = await fetchDriveItems(parentId, {
            audit: opts.audit !== false,
            drive_id: browseDriveId,
            source:
              source === 'shared_with_me'
                ? null
                : source === 'downloads'
                  ? 'downloads'
                  : source === 'company'
                    ? 'company'
                    : 'my_drive',
          });
          setItems(res.items);
          setBreadcrumb(res.breadcrumb);
          if (res.vault) setVault(res.vault);
        }
      } catch (err) {
        if (opts.audit !== false) {
          setError(err instanceof Error ? err.message : 'Failed to load files');
        }
      } finally {
        setItemsLoading(false);
      }
    },
    [
      status?.connected,
      status?.configured,
      status?.capabilities?.files,
      source,
      parentId,
      browseDriveId,
    ],
  );

  const bootstrapVault = useCallback(async () => {
    if (!status?.connected || !status.capabilities?.files) return;
    setVaultEnsuring(true);
    try {
      const v = await ensureDocumentVault();
      setVault(v);
    } catch (err) {
      console.warn('ensureDocumentVault', err);
    } finally {
      setVaultEnsuring(false);
    }
  }, [status?.connected, status?.capabilities?.files]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadStatus();
      setLoading(false);
    })();
  }, [loadStatus]);

  useEffect(() => {
    const connected = searchParams.get('calendar_connected');
    const err = searchParams.get('calendar_error');
    if (connected === '1') {
      setNotice('Microsoft account connected. OneDrive files are ready.');
      setSearchParams({}, { replace: true });
      void loadStatus();
    } else if (err) {
      setError(decodeURIComponent(err));
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, loadStatus]);

  useEffect(() => {
    if (status?.connected && status.capabilities?.files) {
      void bootstrapVault();
    }
  }, [status?.connected, status?.capabilities?.files, bootstrapVault]);

  useEffect(() => {
    if (status?.connected && status.capabilities?.files) {
      void loadItems({ audit: true });
    }
  }, [status?.connected, status?.capabilities?.files, loadItems]);

  useEffect(() => {
    if (!shareItem || shareMode !== 'invite') {
      setPickerResults([]);
      return;
    }
    const q = pickerQuery.trim();
    if (q.length < 2) {
      setPickerResults([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        setPickerLoading(true);
        try {
          const people = await searchMeetingPeople(q, 8);
          if (!cancelled) setPickerResults(people);
        } catch {
          if (!cancelled) setPickerResults([]);
        } finally {
          if (!cancelled) setPickerLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [pickerQuery, shareItem, shareMode]);

  // Submit Graph preview form when postUrl is required
  useEffect(() => {
    if (!viewer?.preview?.post_url || viewer.frameSrc) return;
    const form = previewFormRef.current;
    if (!form) return;
    // Defer so iframe + form exist in DOM
    const t = window.setTimeout(() => form.submit(), 0);
    return () => window.clearTimeout(t);
  }, [viewer?.preview?.post_url, viewer?.frameSrc, viewer?.item.id]);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await startCalendarOAuth('/sales/files');
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Microsoft sign-in');
      setConnecting(false);
    }
  }

  async function onSaveWorkEmail(e: FormEvent) {
    e.preventDefault();
    setSavingEmail(true);
    setError(null);
    try {
      await setMyWorkEmail(workEmailDraft.trim() || null);
      setNotice('Work email saved.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save work email');
    } finally {
      setSavingEmail(false);
    }
  }

  function openFolder(item: DriveItem) {
    if (!item.is_folder) return;
    if (source === 'shared_with_me' || source === 'company') {
      const { itemId, driveId } = resolvePreviewTarget(item);
      if (!driveId && source === 'shared_with_me') {
        setError(
          'This shared folder cannot be browsed in-portal yet (missing drive id). Ask the owner to share the folder again, or use Share to invite people.',
        );
        return;
      }
      setBrowseDriveId(driveId ?? browseDriveId);
      setParentId(itemId);
      return;
    }
    setBrowseDriveId(null);
    setParentId(item.id);
  }

  function goBreadcrumb(id: string | null, driveId?: string | null) {
    if ((source === 'shared_with_me' || source === 'downloads' || source === 'company') && id == null) {
      setParentId(null);
      setBrowseDriveId(source === 'company' ? vault?.company.root?.drive_id ?? null : null);
      return;
    }
    setParentId(id);
    setBrowseDriveId(driveId ?? (id ? browseDriveId : null));
  }

  function switchSource(next: SourceTab) {
    setSource(next);
    setParentId(null);
    setBrowseDriveId(
      next === 'company' ? vault?.company.root?.drive_id ?? null : null,
    );
    setViewer(null);
  }

  async function onOpenInPortal(item: DriveItem) {
    if (item.is_folder) {
      openFolder(item);
      return;
    }
    const { itemId, driveId } = resolvePreviewTarget(item);
    setBusyId(item.id);
    setError(null);
    setViewer({
      item,
      loading: true,
      error: null,
      preview: null,
      frameSrc: null,
      mode: 'unsupported',
    });
    try {
      const preview = await getDrivePreview(itemId, { drive_id: driveId });
      if (preview.get_url) {
        setViewer({
          item,
          loading: false,
          error: null,
          preview,
          frameSrc: preview.get_url,
          mode: 'graph',
        });
      } else if (preview.post_url) {
        setViewer({
          item,
          loading: false,
          error: null,
          preview,
          frameSrc: null,
          mode: 'graph',
        });
      } else if (preview.office_embed_url) {
        setViewer({
          item,
          loading: false,
          error: null,
          preview,
          frameSrc: preview.office_embed_url,
          mode: 'office_embed',
        });
      } else {
        setViewer({
          item,
          loading: false,
          error:
            'This file type cannot be previewed inside the portal. Use Share to grant org access — downloads are disabled.',
          preview,
          frameSrc: null,
          mode: 'unsupported',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Preview failed';
      setViewer({
        item,
        loading: false,
        error: message,
        preview: null,
        frameSrc: null,
        mode: 'unsupported',
      });
    } finally {
      setBusyId(null);
    }
  }

  function tryOfficeEmbedFallback() {
    if (!viewer?.preview?.office_embed_url) return;
    setViewer((v) =>
      v
        ? {
            ...v,
            frameSrc: v.preview!.office_embed_url,
            mode: 'office_embed',
            error: null,
          }
        : v,
    );
  }

  async function onUploadSelected(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0];
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Portal upload max is 4 MB. Compress the file or ask an admin about larger uploads.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const content_base64 = await fileToBase64(file);
      const destination =
        source === 'downloads' && !parentId
          ? 'downloads'
          : source === 'company' &&
              vault?.company.resumes &&
              (parentId === vault.company.resumes.item_id || looksLikeResumeName(file.name))
            ? 'company_resumes'
            : null;
      await uploadDriveFile({
        file_name: file.name,
        content_base64,
        content_type: file.type || 'application/octet-stream',
        parent_id: destination ? null : parentId,
        drive_id: destination ? null : browseDriveId,
        destination,
      });
      setNotice(
        destination === 'company_resumes'
          ? `Saved ${file.name} to Company Shared / Resumes`
          : destination === 'downloads'
            ? `Saved ${file.name} to Downloads`
            : `Uploaded ${file.name}`,
      );
      await loadItems({ audit: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onCopyToSalesforce(item: DriveItem) {
    setBusyId(item.id);
    setError(null);
    try {
      const { itemId, driveId } = resolvePreviewTarget(item);
      const res = await stubCopyToSalesforce({
        item_id: itemId,
        drive_id: driveId,
      });
      setNotice(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Salesforce copy failed');
    } finally {
      setBusyId(null);
    }
  }

  async function onMkdir(e: FormEvent) {
    e.preventDefault();
    const name = mkdirName.trim();
    if (!name) return;
    setMkdirBusy(true);
    setError(null);
    try {
      await createDriveFolder(name, parentId);
      setMkdirOpen(false);
      setMkdirName('');
      setNotice(`Folder “${name}” created`);
      await loadItems({ audit: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create folder');
    } finally {
      setMkdirBusy(false);
    }
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    if (!renameItem) return;
    const name = renameDraft.trim();
    if (!name) return;
    setRenameBusy(true);
    setError(null);
    try {
      await renameDriveItem(renameItem.id, name);
      setRenameItem(null);
      setNotice('Renamed');
      await loadItems({ audit: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setRenameBusy(false);
    }
  }

  async function onDelete(item: DriveItem) {
    if (!window.confirm(`Delete “${item.name}”? This moves it to OneDrive recycle bin.`)) {
      return;
    }
    setBusyId(item.id);
    setError(null);
    try {
      await deleteDriveItem(item.id, item.name);
      setNotice(`Deleted ${item.name}`);
      await loadItems({ audit: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  function openShare(item: DriveItem) {
    setShareItem(item);
    setShareMode('invite');
    setShareRole('read');
    setShareLinkUrl(null);
    setPickerQuery('');
    setPickerResults([]);
    setSelectedPeople([]);
    setShareMessage('');
  }

  function addPerson(p: PeopleSuggestion) {
    setSelectedPeople((prev) => {
      if (prev.some((x) => x.email.toLowerCase() === p.email.toLowerCase())) return prev;
      return [...prev, p];
    });
    setPickerQuery('');
    setPickerResults([]);
  }

  function removePerson(email: string) {
    setSelectedPeople((prev) => prev.filter((p) => p.email.toLowerCase() !== email.toLowerCase()));
  }

  async function onCreateOrgLink() {
    if (!shareItem) return;
    setShareBusy(true);
    setError(null);
    try {
      const perm = await createOrgShareLink(
        shareItem.id,
        shareRole === 'write' ? 'edit' : 'view',
      );
      setShareLinkUrl(perm.web_url);
      setNotice('Organization-only link created (not a public anonymous link).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create share link');
    } finally {
      setShareBusy(false);
    }
  }

  async function onInviteShare(e: FormEvent) {
    e.preventDefault();
    if (!shareItem || selectedPeople.length === 0) return;
    setShareBusy(true);
    setError(null);
    try {
      await inviteDriveShare({
        item_id: shareItem.id,
        emails: selectedPeople.map((p) => p.email),
        role: shareRole,
        message: shareMessage.trim() || undefined,
      });
      setShareItem(null);
      setNotice(`Shared “${shareItem.name}” with ${selectedPeople.length} people`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share invite failed');
    } finally {
      setShareBusy(false);
    }
  }

  const sortedItems = [...items].sort((a, b) => {
    if (a.is_folder !== b.is_folder) return a.is_folder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  const postFields = parsePostParameters(viewer?.preview?.post_parameters ?? null);

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1>Files</h1>
          <p className="muted">
            Document vault: personal <strong>Downloads</strong> and company shared files stay in
            OneDrive/SharePoint. Local browser downloads stay disabled.
          </p>
        </div>
        <div className="page-actions">
          {status?.connected && canFiles ? (
            <>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void loadItems({ audit: true })}
                disabled={itemsLoading}
              >
                Refresh
              </button>
              {source === 'my_drive' || source === 'downloads' || source === 'company' ? (
                <>
                  {source === 'my_drive' ? (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setMkdirOpen(true)}
                      disabled={uploading}
                    >
                      New folder
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || (source === 'company' && !vault?.company.available)}
                  >
                    {uploading ? 'Uploading…' : 'Upload'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    onChange={(e) => void onUploadSelected(e.target.files)}
                  />
                </>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => void onConnect()}
              disabled={connecting || status?.configured === false}
            >
              {connecting ? 'Redirecting…' : status?.connected ? 'Reconnect' : 'Connect Microsoft'}
            </button>
          )}
          <button
            type="button"
            className="btn ghost app-side-toggle"
            aria-expanded={sideOpen}
            onClick={() => setSideOpen((o) => !o)}
          >
            {sideOpen ? 'Hide settings' : 'Settings'}
          </button>
        </div>
      </div>

      {notice ? <div className="banner ok">{notice}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}
      {status?.needs_scope_upgrade || (status?.connected && !canFiles) ? (
        <div className="banner warn">
          Your Microsoft connection is missing OneDrive permissions. An admin must grant{' '}
          <code>Files.ReadWrite</code> in Azure, then click <strong>Reconnect</strong>.
          {status?.connected && !canFiles ? (
            <>
              {' '}
              <button type="button" className="btn ghost" onClick={() => void onConnect()} disabled={connecting}>
                Reconnect
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="detail-grid files-layout">
          <div className="panel files-main app-main">
            {!status ? (
              <div className="empty">
                <p className="muted">Status unavailable. Retry or check the error above.</p>
              </div>
            ) : !status.configured ? (
              <div className="empty">
                <p>Microsoft Graph is not configured yet.</p>
                <p className="muted">
                  An admin needs to register an Azure app and set edge secrets — see{' '}
                  <code>SETUP_CALENDAR.md</code>.
                </p>
              </div>
            ) : !status.connected ? (
              <div className="empty">
                <p>Connect your Tage work mailbox to browse OneDrive here.</p>
                <p className="muted">
                  Uses the same Microsoft connection as Calendar / Chat. Personal drive first (
                  <code>Files.ReadWrite</code>).
                </p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void onConnect()}
                  disabled={connecting}
                >
                  {connecting ? 'Redirecting…' : 'Connect Microsoft'}
                </button>
              </div>
            ) : !canFiles ? (
              <div className="empty">
                <p>Files scopes are not on your token yet.</p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void onConnect()}
                  disabled={connecting}
                >
                  {connecting ? 'Redirecting…' : 'Reconnect'}
                </button>
              </div>
            ) : (
              <div className="files-shell">
                <div className="files-toolbar">
                  <div className="seg files-source-seg">
                    <button
                      type="button"
                      className={source === 'downloads' ? 'active' : ''}
                      onClick={() => switchSource('downloads')}
                    >
                      Downloads
                    </button>
                    <button
                      type="button"
                      className={source === 'company' ? 'active' : ''}
                      onClick={() => switchSource('company')}
                      disabled={vaultEnsuring}
                      title={
                        vault?.company.available
                          ? 'Company Shared / Resumes'
                          : vault?.company.message ?? 'Company vault not configured'
                      }
                    >
                      Company Shared
                    </button>
                    <button
                      type="button"
                      className={source === 'my_drive' ? 'active' : ''}
                      onClick={() => switchSource('my_drive')}
                    >
                      My files
                    </button>
                    <button
                      type="button"
                      className={source === 'shared_with_me' ? 'active' : ''}
                      onClick={() => switchSource('shared_with_me')}
                    >
                      Shared with me
                    </button>
                  </div>
                  <nav className="files-breadcrumb" aria-label="Folder path">
                    {breadcrumb.map((crumb, i) => (
                      <span key={`${crumb.name}-${i}`}>
                        {i > 0 ? <span className="files-bc-sep">/</span> : null}
                        <button
                          type="button"
                          className="files-bc-link"
                          disabled={i === breadcrumb.length - 1}
                          onClick={() => goBreadcrumb(crumb.id, crumb.drive_id)}
                        >
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                  </nav>
                </div>
                {source === 'downloads' ? (
                  <p className="muted small files-vault-hint">
                    Portal save destination — <code>Tage Portal/Downloads</code> on your OneDrive.
                    Mail “Save” actions land here (not on your local disk).
                  </p>
                ) : null}
                {source === 'company' && !vault?.company.available ? (
                  <div className="banner warn">
                    {vault?.company.message ??
                      'Company shared vault is not available yet. Share a folder named “Company Files” with portal users, or set MS_COMPANY_SITE_PATH + Sites.ReadWrite.All (see SETUP_CALENDAR.md).'}
                  </div>
                ) : null}
                {source === 'company' && vault?.company.available ? (
                  <p className="muted small files-vault-hint">
                    Company vault ({vault.company.mode}). Resumes live under{' '}
                    <code>{vault.company.resumes?.path_label ?? 'Company Files/Resumes'}</code> so
                    they remain after offboarding. Recruit 619 → Salesforce sync is scaffolded — see{' '}
                    <code>SETUP_SALESFORCE_RESUMES.md</code>.
                  </p>
                ) : null}

                {itemsLoading ? (
                  <p className="muted small files-list-pad">Loading…</p>
                ) : sortedItems.length === 0 ? (
                  <p className="muted small files-list-pad">
                    {source === 'shared_with_me' && !parentId
                      ? 'Nothing shared with you yet.'
                      : source === 'downloads' && !parentId
                        ? 'Downloads is empty. Save mail attachments or upload here.'
                        : 'This folder is empty. Upload a file or create a folder.'}
                  </p>
                ) : (
                  <div className="files-table-wrap">
                    <table className="files-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Modified</th>
                          <th>Size</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedItems.map((item) => {
                          const busy = busyId === item.id;
                          return (
                            <tr key={item.id}>
                              <td>
                                {item.is_folder ? (
                                  <button
                                    type="button"
                                    className="files-name-btn"
                                    onClick={() => openFolder(item)}
                                  >
                                    <span className="files-icon folder" aria-hidden>
                                      ▢
                                    </span>
                                    {item.name}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="files-name-btn"
                                    onClick={() => void onOpenInPortal(item)}
                                    disabled={busy}
                                  >
                                    <span className="files-icon file" aria-hidden>
                                      ◇
                                    </span>
                                    {item.name}
                                  </button>
                                )}
                              </td>
                              <td className="muted small">{formatModified(item.modified_at)}</td>
                              <td className="muted small">
                                {item.is_folder
                                  ? item.child_count != null
                                    ? `${item.child_count} items`
                                    : '—'
                                  : formatBytes(item.size)}
                              </td>
                              <td>
                                <div className="files-row-actions">
                                  {!item.is_folder ? (
                                    <button
                                      type="button"
                                      className="btn ghost small"
                                      disabled={busy}
                                      onClick={() => void onOpenInPortal(item)}
                                    >
                                      Open
                                    </button>
                                  ) : null}
                                  {!item.is_folder &&
                                  (source === 'company' || looksLikeResumeName(item.name)) ? (
                                    <button
                                      type="button"
                                      className="btn ghost small"
                                      disabled={busy}
                                      title="Copy/upload to Salesforce when Connected App is wired"
                                      onClick={() => void onCopyToSalesforce(item)}
                                    >
                                      Salesforce
                                    </button>
                                  ) : null}
                                  {source === 'my_drive' || source === 'downloads' ? (
                                    <>
                                      <button
                                        type="button"
                                        className="btn ghost small"
                                        disabled={busy}
                                        onClick={() => openShare(item)}
                                      >
                                        Share
                                      </button>
                                      <button
                                        type="button"
                                        className="btn ghost small"
                                        disabled={busy}
                                        onClick={() => {
                                          setRenameItem(item);
                                          setRenameDraft(item.name);
                                        }}
                                      >
                                        Rename
                                      </button>
                                      <button
                                        type="button"
                                        className="btn ghost small"
                                        disabled={busy}
                                        onClick={() => void onDelete(item)}
                                      >
                                        Delete
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className={`panel app-side${sideOpen ? ' open' : ''}`}>
            <div className="panel-head">
              <h2>Connection</h2>
            </div>
            <dl className="cal-meta">
              <div>
                <dt>Portal login</dt>
                <dd>{salesUser.email}</dd>
              </div>
              <div>
                <dt>Microsoft</dt>
                <dd>{status?.microsoft_email ?? 'Not connected'}</dd>
              </div>
              <div>
                <dt>Connected</dt>
                <dd>
                  {status?.connected_at ? formatDateTime(status.connected_at) : '—'}
                </dd>
              </div>
              <div>
                <dt>Files capability</dt>
                <dd>{canFiles ? 'Yes' : 'No — reconnect after Azure consent'}</dd>
              </div>
            </dl>

            {status?.configured ? (
              <form className="stack-form" onSubmit={(e) => void onSaveWorkEmail(e)}>
                <label>
                  Work email (login hint)
                  <input
                    type="email"
                    value={workEmailDraft}
                    onChange={(e) => setWorkEmailDraft(e.target.value)}
                    placeholder="you@tagevc.com"
                  />
                </label>
                <button type="submit" className="btn ghost" disabled={savingEmail}>
                  {savingEmail ? 'Saving…' : 'Save work email'}
                </button>
              </form>
            ) : null}

            {status?.connected ? (
              <p className="muted small" style={{ marginTop: '1rem' }}>
                Same OAuth connection as Calendar / Chat. After Azure adds{' '}
                <code>Files.ReadWrite</code>, use{' '}
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void onConnect()}
                  disabled={connecting}
                >
                  Reconnect
                </button>
                .
              </p>
            ) : null}

            <div className="cal-alerts-block" style={{ marginTop: '1.25rem' }}>
              <h3>Limits (v1)</h3>
              <ul className="muted small" style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
                <li>Not a full OneDrive desktop client</li>
                <li>Upload max 4 MB in-portal</li>
                <li>Open uses in-portal preview (Graph / Office Online embed)</li>
                <li>Downloads disabled — share via org invite or org-only link</li>
                <li>Admin consent + Reconnect required for Files scope</li>
              </ul>
            </div>
          </aside>
        </div>
      )}

      {viewer ? (
        <div
          className="modal-backdrop files-viewer-backdrop"
          role="presentation"
          onClick={() => setViewer(null)}
        >
          <div
            className="modal panel files-viewer-modal"
            role="dialog"
            aria-labelledby="files-viewer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head files-viewer-head">
              <div>
                <h2 id="files-viewer-title">{viewer.item.name}</h2>
                <p className="muted small" style={{ margin: '0.15rem 0 0' }}>
                  {viewer.mode === 'graph'
                    ? 'In-portal preview'
                    : viewer.mode === 'office_embed'
                      ? 'Office Online embed (in portal)'
                      : 'Preview unavailable'}
                  {viewer.item.mime_type ? ` · ${viewer.item.mime_type}` : null}
                </p>
              </div>
              <div className="page-actions">
                {viewer.mode === 'graph' && viewer.preview?.office_embed_url && viewer.error ? (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => tryOfficeEmbedFallback()}
                  >
                    Try Office embed
                  </button>
                ) : null}
                <button type="button" className="btn ghost" onClick={() => setViewer(null)}>
                  Close
                </button>
              </div>
            </div>

            {viewer.loading ? (
              <p className="muted files-viewer-status">Loading preview…</p>
            ) : viewer.error && !viewer.frameSrc && !viewer.preview?.post_url ? (
              <div className="files-viewer-fallback">
                <p>{viewer.error}</p>
                {viewer.preview?.office_embed_url ? (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => tryOfficeEmbedFallback()}
                  >
                    Open with Office Online embed
                  </button>
                ) : (
                  <p className="muted small">
                    This type cannot be shown in an iframe. Use <strong>Share</strong> to invite
                    org users — raw download links are not offered from the portal.
                  </p>
                )}
              </div>
            ) : (
              <div className="files-viewer-frame-wrap">
                {viewer.preview?.post_url && !viewer.frameSrc ? (
                  <>
                    <form
                      ref={previewFormRef}
                      method="POST"
                      action={viewer.preview.post_url}
                      target="files-preview-frame"
                      style={{ display: 'none' }}
                    >
                      {postFields.map((f) => (
                        <input key={f.name} type="hidden" name={f.name} value={f.value} />
                      ))}
                    </form>
                    <iframe
                      name="files-preview-frame"
                      title={viewer.item.name}
                      className="files-viewer-frame"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    />
                  </>
                ) : viewer.frameSrc ? (
                  <iframe
                    title={viewer.item.name}
                    className="files-viewer-frame"
                    src={viewer.frameSrc}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                ) : (
                  <div className="files-viewer-fallback">
                    <p>No preview URL returned for this file.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {mkdirOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setMkdirOpen(false)}>
          <div
            className="modal panel"
            role="dialog"
            aria-labelledby="mkdir-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head">
              <h2 id="mkdir-title">New folder</h2>
              <button type="button" className="btn ghost" onClick={() => setMkdirOpen(false)}>
                Close
              </button>
            </div>
            <form className="stack-form" onSubmit={(e) => void onMkdir(e)}>
              <label>
                Folder name
                <input
                  type="text"
                  value={mkdirName}
                  onChange={(e) => setMkdirName(e.target.value)}
                  placeholder="Q3 proposals"
                  autoFocus
                />
              </label>
              <div className="page-actions">
                <button
                  type="submit"
                  className="btn primary"
                  disabled={mkdirBusy || !mkdirName.trim()}
                >
                  {mkdirBusy ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {renameItem ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setRenameItem(null)}>
          <div
            className="modal panel"
            role="dialog"
            aria-labelledby="rename-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head">
              <h2 id="rename-title">Rename</h2>
              <button type="button" className="btn ghost" onClick={() => setRenameItem(null)}>
                Close
              </button>
            </div>
            <form className="stack-form" onSubmit={(e) => void onRename(e)}>
              <label>
                New name
                <input
                  type="text"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  autoFocus
                />
              </label>
              <div className="page-actions">
                <button
                  type="submit"
                  className="btn primary"
                  disabled={renameBusy || !renameDraft.trim()}
                >
                  {renameBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {shareItem ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShareItem(null)}>
          <div
            className="modal panel"
            role="dialog"
            aria-labelledby="share-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head">
              <h2 id="share-title">Share “{shareItem.name}”</h2>
              <button type="button" className="btn ghost" onClick={() => setShareItem(null)}>
                Close
              </button>
            </div>
            <div className="stack-form">
              <div className="seg">
                <button
                  type="button"
                  className={shareMode === 'invite' ? 'active' : ''}
                  onClick={() => setShareMode('invite')}
                >
                  Invite people
                </button>
                <button
                  type="button"
                  className={shareMode === 'link' ? 'active' : ''}
                  onClick={() => setShareMode('link')}
                >
                  Org link
                </button>
              </div>

              <label>
                Permission
                <select
                  value={shareRole}
                  onChange={(e) => setShareRole(e.target.value === 'write' ? 'write' : 'read')}
                >
                  <option value="read">Can view</option>
                  <option value="write">Can edit</option>
                </select>
              </label>

              {shareMode === 'link' ? (
                <>
                  <p className="muted small">
                    Creates an <strong>organization-only</strong> link (sign-in required). Anonymous
                    public links are disabled.
                  </p>
                  <div className="page-actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={shareBusy}
                      onClick={() => void onCreateOrgLink()}
                    >
                      {shareBusy ? 'Creating…' : 'Create org link'}
                    </button>
                  </div>
                  {shareLinkUrl ? (
                    <label>
                      Link
                      <input type="text" readOnly value={shareLinkUrl} onFocus={(e) => e.target.select()} />
                    </label>
                  ) : null}
                </>
              ) : (
                <form className="stack-form" onSubmit={(e) => void onInviteShare(e)}>
                  <label>
                    Find people
                    <input
                      type="search"
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder="Name or email…"
                      autoComplete="off"
                      disabled={!canPeople}
                    />
                  </label>
                  {!canPeople ? (
                    <p className="muted small">People search needs People.Read — reconnect if missing.</p>
                  ) : null}
                  {pickerLoading ? <p className="muted small">Searching…</p> : null}
                  {pickerResults.length > 0 ? (
                    <ul className="chat-people-results">
                      {pickerResults.map((p) => (
                        <li key={p.email}>
                          <button type="button" onClick={() => addPerson(p)}>
                            <span>{p.display_name || p.email}</span>
                            <span className="muted small">{p.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {selectedPeople.length > 0 ? (
                    <div className="chat-people-chips">
                      {selectedPeople.map((p) => (
                        <button
                          key={p.email}
                          type="button"
                          className="chat-chip"
                          onClick={() => removePerson(p.email)}
                          title="Remove"
                        >
                          {p.display_name || p.email} ×
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted small">Pick org people to invite (requires sign-in).</p>
                  )}
                  <label>
                    Message (optional)
                    <input
                      type="text"
                      value={shareMessage}
                      onChange={(e) => setShareMessage(e.target.value)}
                      placeholder="Sharing for review"
                    />
                  </label>
                  <div className="page-actions">
                    <button
                      type="submit"
                      className="btn primary"
                      disabled={shareBusy || selectedPeople.length === 0}
                    >
                      {shareBusy ? 'Sharing…' : 'Send invite'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
