import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createContact, getContact, listContacts } from '../lib/contactsApi';
import type { SalesContact } from '../lib/types';

type Props = {
  value: string | null;
  /** When set, search prefers people on this account. */
  accountId?: string | null;
  onChange: (contactId: string | null, contact: SalesContact | null) => void;
  createdBy?: string | null;
  disabled?: boolean;
  required?: boolean;
};

export function ContactPicker({
  value,
  accountId = null,
  onChange,
  createdBy,
  disabled,
  required,
}: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SalesContact[]>([]);
  const [selected, setSelected] = useState<SalesContact | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftTitle, setDraftTitle] = useState('');

  useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    void getContact(value).then((row) => {
      if (!cancelled) setSelected(row);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      setLoading(true);
      void listContacts({ q, accountId: accountId || undefined, limit: 25 })
        .then((rows) => setResults(rows))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [q, open, accountId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!draftName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const contact = await createContact({
        full_name: draftName.trim(),
        primary_email: draftEmail.trim(),
        primary_phone: draftPhone.trim(),
        title: draftTitle.trim(),
        account_id: accountId,
        created_by: createdBy ?? null,
      });
      onChange(contact.id, contact);
      setSelected(contact);
      setShowCreate(false);
      setOpen(false);
      setDraftName('');
      setDraftEmail('');
      setDraftPhone('');
      setDraftTitle('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create contact');
    } finally {
      setCreating(false);
    }
  }

  if (selected && !open && !showCreate) {
    return (
      <div className="entity-picker">
        <div className="entity-picker-selected">
          <div>
            <div className="entity-picker-name">{selected.full_name}</div>
            <div className="muted small">
              {[selected.primary_email, selected.primary_phone, selected.company]
                .filter(Boolean)
                .join(' · ') || 'No email or phone'}
            </div>
            <Link
              className="muted small"
              to={`/sales/deal-sourcing/contacts/${selected.id}`}
            >
              Open contact
            </Link>
          </div>
          <button
            type="button"
            className="btn ghost"
            disabled={disabled}
            onClick={() => {
              setOpen(true);
              setQ(selected.full_name);
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="entity-picker">
      <label>
        Search contacts{required ? ' *' : ''}
        <input
          value={q}
          disabled={disabled}
          placeholder={
            accountId ? 'People at this account…' : 'Name, email, or phone…'
          }
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
        />
      </label>
      {loading ? <p className="muted small">Searching…</p> : null}
      {open && results.length > 0 ? (
        <ul className="entity-picker-results" role="listbox">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="entity-picker-result"
                onClick={() => {
                  onChange(c.id, c);
                  setSelected(c);
                  setOpen(false);
                  setQ('');
                }}
              >
                <span className="entity-picker-name">{c.full_name}</span>
                <span className="muted small">
                  {[c.primary_email, c.primary_phone, c.company]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && !loading && q.trim() && results.length === 0 ? (
        <p className="muted small">No matching contacts.</p>
      ) : null}
      <div className="entity-picker-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={disabled}
          onClick={() => {
            setDraftName(q.trim());
            setShowCreate(true);
          }}
        >
          Add Contact
        </button>
        {value && open ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setOpen(false);
              setQ('');
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>

      {showCreate ? (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Contact</h2>
            <form className="stack-form" onSubmit={(e) => void onCreate(e)}>
              <label>
                Full name
                <input
                  required
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </label>
              <label>
                Title
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                />
              </label>
              <label>
                Primary email
                <input
                  type="email"
                  value={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.value)}
                />
              </label>
              <label>
                Primary phone
                <input
                  value={draftPhone}
                  onChange={(e) => setDraftPhone(e.target.value)}
                />
              </label>
              {accountId ? (
                <p className="muted small">
                  This contact will be linked to the selected account.
                </p>
              ) : (
                <p className="muted small">
                  Tip: pick or add an account first so this person is filed under a company.
                </p>
              )}
              {createError ? <div className="banner error">{createError}</div> : null}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={creating}>
                  {creating ? 'Saving…' : 'Create contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
