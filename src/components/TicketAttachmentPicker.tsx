import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { TicketAttachmentDraft } from '../lib/ticketTypes';

const MAX_FILES = 8;
const MAX_BYTES = 25 * 1024 * 1024; // 25MB per file (bucket allows 50MB)

function draftId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function toDraft(file: File | Blob, nameHint?: string): TicketAttachmentDraft {
  const fileName =
    nameHint ||
    (file instanceof File && file.name
      ? file.name
      : `paste-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
  const mimeType =
    file.type ||
    (fileName.toLowerCase().endsWith('.png')
      ? 'image/png'
      : fileName.toLowerCase().endsWith('.jpg') ||
          fileName.toLowerCase().endsWith('.jpeg')
        ? 'image/jpeg'
        : 'application/octet-stream');
  const isImage = mimeType.startsWith('image/');
  return {
    id: draftId(),
    file,
    fileName,
    mimeType,
    previewUrl: isImage ? URL.createObjectURL(file) : null,
  };
}

type Props = {
  files: TicketAttachmentDraft[];
  onChange: (files: TicketAttachmentDraft[]) => void;
  disabled?: boolean;
  /** Compact layout for reply form */
  compact?: boolean;
  label?: string;
  /** Extra paste target (e.g. description / comment textarea) */
  pasteTargetRef?: RefObject<HTMLElement | null>;
};

/**
 * File picker + clipboard paste (screenshots) for portal tickets.
 * Does not upload — parent submits drafts after ticket/comment create.
 */
export function TicketAttachmentPicker({
  files,
  onChange,
  disabled = false,
  compact = false,
  label = 'Attachments',
  pasteTargetRef,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = useCallback(
    (incoming: Array<File | Blob>, nameHints?: string[]) => {
      if (disabled) return;
      const next = [...files];
      let skipped = 0;
      incoming.forEach((f, i) => {
        if (next.length >= MAX_FILES) {
          skipped += 1;
          return;
        }
        if (f.size > MAX_BYTES) {
          skipped += 1;
          return;
        }
        next.push(toDraft(f, nameHints?.[i]));
      });
      onChange(next);
      if (skipped) {
        setHint(
          `Skipped ${skipped} file(s) (max ${MAX_FILES} files, ${MAX_BYTES / (1024 * 1024)}MB each).`,
        );
      } else {
        setHint(null);
      }
    },
    [disabled, files, onChange],
  );

  const removeAt = useCallback(
    (id: string) => {
      const target = files.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      onChange(files.filter((f) => f.id !== id));
    },
    [files, onChange],
  );

  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
    };
  }, []);

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items?.length) return;
      const blobs: Blob[] = [];
      const names: string[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            blobs.push(blob);
            const ext = item.type === 'image/jpeg' ? 'jpg' : 'png';
            names.push(
              `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`,
            );
          }
        }
      }
      if (blobs.length) {
        e.preventDefault();
        addFiles(blobs, names);
        setHint(`Pasted ${blobs.length} screenshot(s).`);
      }
    },
    [addFiles, disabled],
  );

  useEffect(() => {
    const nodes: HTMLElement[] = [];
    if (dropRef.current) nodes.push(dropRef.current);
    if (pasteTargetRef?.current) nodes.push(pasteTargetRef.current);
    for (const node of nodes) {
      node.addEventListener('paste', onPaste as EventListener);
    }
    return () => {
      for (const node of nodes) {
        node.removeEventListener('paste', onPaste as EventListener);
      }
    };
  }, [onPaste, pasteTargetRef, files.length]);

  return (
    <div className={`ticket-attach-picker${compact ? ' compact' : ''}`}>
      <div className="ticket-attach-picker-label">{label}</div>
      <div
        ref={dropRef}
        className={`ticket-attach-drop${dragOver ? ' drag-over' : ''}`}
        tabIndex={0}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const list = Array.from(e.dataTransfer.files ?? []);
          if (list.length) addFiles(list);
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          Drop files, choose files, or paste a screenshot (⌘V / Ctrl+V) here
          {pasteTargetRef ? ' or in the text field' : ''}.
        </p>
        <div className="ticket-attach-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={disabled || files.length >= MAX_FILES}
            onClick={() => inputRef.current?.click()}
          >
            Choose files
          </button>
          <span className="muted small">
            Images & docs · up to {MAX_FILES} · {MAX_BYTES / (1024 * 1024)}MB each
          </span>
        </div>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.csv,.zip"
          hidden
          disabled={disabled}
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (list.length) addFiles(list);
          }}
        />
      </div>
      {files.length > 0 ? (
        <ul className="ticket-attach-drafts">
          {files.map((f) => (
            <li key={f.id}>
              {f.previewUrl ? (
                <img src={f.previewUrl} alt="" className="ticket-attach-thumb" />
              ) : (
                <span className="ticket-attach-file-icon" aria-hidden>
                  📄
                </span>
              )}
              <span className="ticket-attach-name" title={f.fileName}>
                {f.fileName}
              </span>
              <span className="muted small">
                {Math.max(1, Math.round(f.file.size / 1024))} KB
              </span>
              <button
                type="button"
                className="btn ghost"
                disabled={disabled}
                onClick={() => removeAt(f.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hint ? <p className="muted small">{hint}</p> : null}
    </div>
  );
}

/** Revoke all preview URLs on a draft list (call after successful submit). */
export function revokeTicketAttachmentDrafts(files: TicketAttachmentDraft[]): void {
  for (const f of files) {
    if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
  }
}
