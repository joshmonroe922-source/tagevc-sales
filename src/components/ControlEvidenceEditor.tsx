import { useRef, useState } from 'react';
import {
  AUDIT_REVIEW_FREQUENCIES,
  AUDIT_REVIEW_FREQUENCY_LABELS,
  type AuditReviewFrequency,
} from '../lib/auditControlUtils';

export type ControlEvidenceValue = {
  next_due_at: string;
  /** Review frequency — stored as `cadence` on control rows (shared pattern). */
  cadence?: AuditReviewFrequency | string;
  /** @deprecated Prefer `cadence` (same meaning). */
  review_frequency?: AuditReviewFrequency | string;
  evidence_url: string;
  evidence_notes: string;
  evidence_file_name: string;
  evidence_storage_path: string;
};

type Props = {
  value: ControlEvidenceValue;
  onChange: (patch: Partial<ControlEvidenceValue>) => void;
  onUploadFile?: (file: File) => Promise<void>;
  uploading?: boolean;
  uploadError?: string | null;
  onOpenEvidence?: () => void;
  evidenceReady?: boolean;
};

/**
 * Shared due-date + review frequency + evidence file/link fields for audit matrices.
 * Per-control rows already scope to parent (`entity_id` null) or a subsidiary.
 */
export function ControlEvidenceEditor({
  value,
  onChange,
  onUploadFile,
  uploading,
  uploadError,
  onOpenEvidence,
  evidenceReady,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);

  return (
    <div className="hr-control-editor form-grid">
      <label>
        Next due
        <input
          className="input"
          type="date"
          value={value.next_due_at}
          onChange={(e) => onChange({ next_due_at: e.target.value })}
        />
      </label>
      <label>
        Review frequency
        <select
          className="input"
          value={value.cadence || value.review_frequency || 'annual'}
          onChange={(e) => {
            const cadence = e.target.value as AuditReviewFrequency;
            onChange({ cadence, review_frequency: cadence });
          }}
        >
          {AUDIT_REVIEW_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {AUDIT_REVIEW_FREQUENCY_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      <label className="full">
        Evidence URL
        <input
          className="input"
          value={value.evidence_url}
          onChange={(e) => onChange({ evidence_url: e.target.value })}
          placeholder="https://… or paste a link"
        />
      </label>
      <label className="full">
        Evidence notes
        <input
          className="input"
          value={value.evidence_notes}
          onChange={(e) => onChange({ evidence_notes: e.target.value })}
        />
      </label>
      {onUploadFile ? (
        <div className="full">
          <div className="muted small" style={{ marginBottom: 6 }}>
            Attach evidence file
            {value.evidence_file_name
              ? ` · current: ${value.evidence_file_name}`
              : ''}
          </div>
          <div className="ops-compliance-actions" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn ghost"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? 'Uploading…' : 'Choose file'}
            </button>
            {evidenceReady && onOpenEvidence ? (
              <button type="button" className="btn ghost" onClick={() => onOpenEvidence()}>
                Open file
              </button>
            ) : null}
          </div>
          <input
            ref={inputRef}
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file || !onUploadFile) return;
              setLocalErr(null);
              void onUploadFile(file).catch((err) =>
                setLocalErr(err instanceof Error ? err.message : 'Upload failed'),
              );
            }}
          />
          {uploadError || localErr ? (
            <div className="banner error" style={{ marginTop: 8 }}>
              {uploadError || localErr}
            </div>
          ) : null}
          <p className="muted small" style={{ marginTop: 6 }}>
            Files are stored per control (parent or subsidiary row). Marking reviewed
            rolls the next due date forward by the review frequency — no Secretary of
            State auto-login.
          </p>
        </div>
      ) : null}
    </div>
  );
}
