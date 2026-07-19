import { useCallback, useEffect, useState } from 'react';
import {
  createMyMailSignature,
  deleteMyMailSignature,
  listMyMailSignatures,
  setMyDefaultMailSignature,
  updateMyMailSignature,
  type MailSignature,
} from '../lib/mailSignatures';
import {
  JOSH_MONROE_FOUR_COMPANY_TEMPLATE,
  SIGNATURE_TEMPLATES,
} from '../lib/signatureTemplates';
import { setMyMailSignature } from '../lib/calendarApi';

type Props = {
  sigEnabled: boolean;
  onSigEnabledChange: (enabled: boolean) => void;
  onDefaultSignatureChange?: (html: string | null) => void;
};

export function MailSignaturesPanel({
  sigEnabled,
  onSigEnabledChange,
  onDefaultSignatureChange,
}: Props) {
  const [signatures, setSignatures] = useState<MailSignature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listMyMailSignatures();
      setSignatures(rows);
      const def = rows.find((s) => s.is_default);
      onDefaultSignatureChange?.(def?.body_html ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signatures');
    } finally {
      setLoading(false);
    }
  }, [onDefaultSignatureChange]);

  useEffect(() => {
    void load();
  }, [load]);

  function startNew(templateId?: string) {
    const template = templateId
      ? SIGNATURE_TEMPLATES.find((t) => t.id === templateId)
      : undefined;
    setEditingId('new');
    setName(template?.name ?? '');
    setBodyHtml(template?.bodyHtml ?? '');
    setIsDefault(signatures.length === 0);
    setNotice(null);
  }

  function startEdit(sig: MailSignature) {
    setEditingId(sig.id);
    setName(sig.name);
    setBodyHtml(sig.body_html);
    setIsDefault(sig.is_default);
    setNotice(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function save() {
    if (!name.trim()) {
      setError('Signature name is required.');
      return;
    }
    if (!bodyHtml.trim()) {
      setError('Signature body is required.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (editingId === 'new') {
        await createMyMailSignature({
          name: name.trim(),
          body_html: bodyHtml,
          is_default: isDefault,
        });
      } else if (editingId) {
        await updateMyMailSignature(editingId, {
          name: name.trim(),
          body_html: bodyHtml,
          is_default: isDefault,
        });
      }
      if (isDefault) {
        await setMyMailSignature(bodyHtml, sigEnabled);
      }
      setEditingId(null);
      setNotice('Signature saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this signature?')) return;
    setSaving(true);
    setError(null);
    try {
      await deleteMyMailSignature(id);
      if (editingId === id) setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(id: string) {
    setSaving(true);
    setError(null);
    try {
      const row = await setMyDefaultMailSignature(id);
      await setMyMailSignature(row.body_html, sigEnabled);
      setNotice(`"${row.name}" is now your default signature.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  async function onToggleEnabled(enabled: boolean) {
    onSigEnabledChange(enabled);
    const def = signatures.find((s) => s.is_default);
    try {
      await setMyMailSignature(def?.body_html ?? null, enabled);
      setNotice(
        enabled
          ? 'Portal signature will append when sending from Mail.'
          : 'Portal signature append disabled.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update signature setting');
    }
  }

  return (
    <div className="mail-settings-block mail-signatures-panel">
      <h3 className="mail-settings-title">Email signatures</h3>
      <p className="muted small">
        Create and manage signatures for portal Mail. The default signature appends on send.
        Outlook desktop may keep a separate signature.
      </p>

      <div className="mail-signature-templates">
        <span className="muted small">Templates:</span>
        {SIGNATURE_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            className="btn ghost small"
            disabled={saving}
            onClick={() => startNew(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>

      <label className="mail-external-check">
        <input
          type="checkbox"
          checked={sigEnabled}
          onChange={(e) => void onToggleEnabled(e.target.checked)}
        />{' '}
        Append default signature when sending from portal Mail
      </label>

      <div className="mail-signature-toolbar">
        <button
          type="button"
          className="btn ghost"
          disabled={saving}
          onClick={() => startNew()}
        >
          New signature
        </button>
      </div>

      {loading ? (
        <p className="muted small">Loading signatures…</p>
      ) : signatures.length === 0 && editingId === null ? (
        <p className="muted small">
          No saved signatures yet. Use the {JOSH_MONROE_FOUR_COMPANY_TEMPLATE.name} template or
          create your own.
        </p>
      ) : (
        <ul className="mail-signature-list">
          {signatures.map((sig) => (
            <li key={sig.id} className="mail-signature-row">
              <div className="mail-signature-row-main">
                {sig.is_default ? <span className="mail-signature-star" title="Default">★</span> : null}
                <span className="mail-signature-name">{sig.name}</span>
                {sig.is_default ? <span className="muted small">Default</span> : null}
              </div>
              <div className="mail-signature-row-actions">
                {!sig.is_default ? (
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={saving}
                    onClick={() => void makeDefault(sig.id)}
                  >
                    Set default
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={saving}
                  onClick={() => startEdit(sig)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={saving}
                  onClick={() => void remove(sig.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingId !== null ? (
        <div className="mail-signature-editor stack-gap">
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Work signature"
            />
          </label>
          <label className="mail-external-check">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />{' '}
            Use as default signature
          </label>
          <label>
            Signature HTML
            <textarea
              rows={12}
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              spellCheck={false}
            />
          </label>
          {bodyHtml.trim() ? (
            <div className="mail-signature-preview">
              <p className="muted small">Preview</p>
              <div
                className="mail-signature-preview-body"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            </div>
          ) : null}
          <div className="mail-signature-editor-actions">
            <button type="button" className="btn" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save signature'}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={saving}
              onClick={cancelEdit}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {notice ? <p className="muted small">{notice}</p> : null}
      {error ? <p className="error small">{error}</p> : null}
    </div>
  );
}
