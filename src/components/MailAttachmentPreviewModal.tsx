import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  fetchMailAttachmentPreview,
  getDrivePreview,
  saveMailAttachmentToVault,
  type DrivePreview,
  type MailAttachmentMeta,
} from '../lib/calendarApi';
import {
  base64ToBlobUrl,
  mailAttachmentPreviewKind,
  parseGraphPreviewPostParameters,
} from '../lib/mailAttachmentPreview';

type Props = {
  messageId: string;
  attachment: MailAttachmentMeta;
  onClose: () => void;
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
};

type Mode = 'loading' | 'inline' | 'office' | 'unavailable';

/**
 * In-portal mail attachment viewer — mirrors Files preview UX.
 * Images / PDF / text → blob URL; Office → vault copy + Graph / Office Online.
 */
export function MailAttachmentPreviewModal({
  messageId,
  attachment,
  onClose,
  onNotice,
  onError,
}: Props) {
  const [mode, setMode] = useState<Mode>('loading');
  const [status, setStatus] = useState('Opening…');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [inlineMime, setInlineMime] = useState('application/octet-stream');
  const [textBody, setTextBody] = useState<string | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [drivePreview, setDrivePreview] = useState<DrivePreview | null>(null);
  const [officeMode, setOfficeMode] = useState<'graph' | 'office_embed'>('graph');
  const [saveBusy, setSaveBusy] = useState(false);
  const previewFormRef = useRef<HTMLFormElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const revokeBlob = useEffectEvent(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  });

  const load = useEffectEvent(async () => {
    revokeBlob();
    setMode('loading');
    setStatus('Opening…');
    setBlobUrl(null);
    setTextBody(null);
    setFrameSrc(null);
    setDrivePreview(null);

    const kind = mailAttachmentPreviewKind(attachment.name, attachment.content_type);

    try {
      if (kind === 'inline') {
        setStatus('Loading attachment…');
        const preview = await fetchMailAttachmentPreview(messageId, attachment.id);
        if (!preview.previewable || !preview.content_base64) {
          setMode('unavailable');
          setStatus(
            'This attachment cannot be previewed inline. Save it to the vault to keep a portal copy.',
          );
          return;
        }
        const mime = preview.content_type || attachment.content_type || 'application/octet-stream';
        setInlineMime(mime);
        if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
          try {
            setTextBody(atob(preview.content_base64.replace(/\s/g, '')));
          } catch {
            setTextBody('(Could not decode text preview)');
          }
          setMode('inline');
          return;
        }
        const url = base64ToBlobUrl(preview.content_base64, mime);
        blobUrlRef.current = url;
        setBlobUrl(url);
        setMode('inline');
        return;
      }

      if (kind === 'office') {
        setStatus('Saving a vault copy for Office preview…');
        const saved = await saveMailAttachmentToVault(messageId, attachment.id, 'downloads');
        onNotice?.(saved.message);
        if (!saved.item.id) {
          setMode('unavailable');
          setStatus(
            'Saved to the vault, but Graph did not return an item id for preview. Open it from Files → Downloads.',
          );
          return;
        }
        setStatus('Loading Office / Graph preview…');
        const preview = await getDrivePreview(saved.item.id, {
          drive_id: saved.item.drive_id ?? null,
        });
        setDrivePreview(preview);
        if (preview.get_url) {
          setFrameSrc(preview.get_url);
          setOfficeMode('graph');
          setMode('office');
        } else if (preview.post_url) {
          setFrameSrc(null);
          setOfficeMode('graph');
          setMode('office');
        } else if (preview.office_embed_url) {
          setFrameSrc(preview.office_embed_url);
          setOfficeMode('office_embed');
          setMode('office');
        } else {
          setMode('unavailable');
          setStatus(
            'Office Online preview is unavailable for this file. It was saved to Files → Downloads — open it there or from OneDrive.',
          );
        }
        return;
      }

      setMode('unavailable');
      setStatus(
        'No in-portal preview for this file type. Save to Downloads or Company Resumes (OneDrive vault — not a local download).',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not open attachment';
      onError?.(message);
      setMode('unavailable');
      setStatus(message);
    }
  });

  useEffect(() => {
    void load();
    return () => revokeBlob();
  }, [messageId, attachment.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (mode !== 'office' || !drivePreview?.post_url || frameSrc) return;
    const form = previewFormRef.current;
    if (!form) return;
    const t = window.setTimeout(() => form.submit(), 0);
    return () => window.clearTimeout(t);
  }, [mode, drivePreview?.post_url, frameSrc, attachment.id]);

  async function onSave(destination: 'downloads' | 'company_resumes') {
    setSaveBusy(true);
    try {
      const res = await saveMailAttachmentToVault(messageId, attachment.id, destination);
      onNotice?.(res.message);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Could not save attachment to vault');
    } finally {
      setSaveBusy(false);
    }
  }

  function tryOfficeEmbed() {
    if (!drivePreview?.office_embed_url) return;
    setFrameSrc(drivePreview.office_embed_url);
    setOfficeMode('office_embed');
    setMode('office');
  }

  const postFields = parseGraphPreviewPostParameters(drivePreview?.post_parameters ?? null);
  const isImage = inlineMime.startsWith('image/');
  const isPdf = inlineMime === 'application/pdf';
  const isHtml = inlineMime === 'text/html' || inlineMime === 'application/xhtml+xml';
  const resumeHint = /\b(resume|curriculum|cv)\b/i.test(attachment.name.replace(/[_\-.]/g, ' '));

  return (
    <div
      className="modal-backdrop files-viewer-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal panel files-viewer-modal"
        role="dialog"
        aria-labelledby="mail-att-viewer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head files-viewer-head">
          <div>
            <h2 id="mail-att-viewer-title">{attachment.name}</h2>
            <p className="muted small" style={{ margin: '0.15rem 0 0' }}>
              {mode === 'loading'
                ? 'Opening attachment…'
                : mode === 'inline'
                  ? 'In-portal preview'
                  : mode === 'office'
                    ? officeMode === 'office_embed'
                      ? 'Office Online embed (via vault copy)'
                      : 'In-portal preview (via vault copy)'
                    : 'Preview unavailable'}
              {attachment.content_type ? ` · ${attachment.content_type}` : null}
            </p>
          </div>
          <div className="page-actions">
            {mode === 'office' && drivePreview?.office_embed_url && officeMode === 'graph' ? (
              <button type="button" className="btn ghost" onClick={tryOfficeEmbed}>
                Try Office embed
              </button>
            ) : null}
            <button
              type="button"
              className="btn ghost"
              disabled={saveBusy}
              onClick={() => void onSave('downloads')}
            >
              Save to Downloads
            </button>
            <button
              type="button"
              className={`btn ${resumeHint ? 'primary' : 'ghost'}`}
              disabled={saveBusy}
              onClick={() => void onSave('company_resumes')}
            >
              {resumeHint ? 'Save to company Resumes' : 'Company Resumes'}
            </button>
            <button type="button" className="btn ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {mode === 'loading' ? (
          <p className="muted files-viewer-status">{status}</p>
        ) : mode === 'unavailable' ? (
          <div className="files-viewer-fallback">
            <p>{status}</p>
            <p className="muted small">
              Portal philosophy: preview or vault copy — no local browser download. Use Save above
              for OneDrive.
            </p>
            {drivePreview?.office_embed_url ? (
              <button type="button" className="btn primary" onClick={tryOfficeEmbed}>
                Open with Office Online embed
              </button>
            ) : null}
          </div>
        ) : mode === 'inline' ? (
          <div className="files-viewer-frame-wrap mail-att-viewer-body">
            {textBody != null ? (
              isHtml ? (
                <iframe
                  title={attachment.name}
                  className="files-viewer-frame"
                  srcDoc={textBody}
                  sandbox=""
                />
              ) : (
                <pre className="mail-att-text mail-att-viewer-text">{textBody}</pre>
              )
            ) : isImage && blobUrl ? (
              <div className="mail-att-viewer-image">
                <img src={blobUrl} alt={attachment.name} />
              </div>
            ) : blobUrl ? (
              <iframe
                title={attachment.name}
                className="files-viewer-frame"
                src={blobUrl}
                sandbox={isPdf ? undefined : 'allow-same-origin'}
              />
            ) : (
              <div className="files-viewer-fallback">
                <p>Nothing to display.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="files-viewer-frame-wrap">
            {drivePreview?.post_url && !frameSrc ? (
              <>
                <form
                  ref={previewFormRef}
                  method="POST"
                  action={drivePreview.post_url}
                  target="mail-att-preview-frame"
                  style={{ display: 'none' }}
                >
                  {postFields.map((f) => (
                    <input key={f.name} type="hidden" name={f.name} value={f.value} />
                  ))}
                </form>
                <iframe
                  name="mail-att-preview-frame"
                  title={attachment.name}
                  className="files-viewer-frame"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              </>
            ) : frameSrc ? (
              <iframe
                title={attachment.name}
                className="files-viewer-frame"
                src={frameSrc}
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
  );
}
