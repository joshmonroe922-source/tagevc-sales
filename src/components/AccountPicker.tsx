import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createAccount, getAccount, listAccounts } from '../lib/accountsApi';
import type { AccountType, SalesAccount } from '../lib/types';
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES } from '../lib/types';

type Props = {
  value: string | null;
  onChange: (accountId: string | null, account: SalesAccount | null) => void;
  createdBy?: string | null;
  disabled?: boolean;
  required?: boolean;
};

export function AccountPicker({
  value,
  onChange,
  createdBy,
  disabled,
  required,
}: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SalesAccount[]>([]);
  const [selected, setSelected] = useState<SalesAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftWebsite, setDraftWebsite] = useState('');
  const [draftType, setDraftType] = useState<AccountType>('prospect');

  useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    void getAccount(value).then((row) => {
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
      void listAccounts({ q, limit: 25 })
        .then((rows) => setResults(rows))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [q, open]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!draftName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const account = await createAccount({
        name: draftName.trim(),
        website: draftWebsite.trim(),
        account_type: draftType,
        created_by: createdBy ?? null,
      });
      onChange(account.id, account);
      setSelected(account);
      setShowCreate(false);
      setOpen(false);
      setDraftName('');
      setDraftWebsite('');
      setDraftType('prospect');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setCreating(false);
    }
  }

  if (selected && !open && !showCreate) {
    return (
      <div className="entity-picker">
        <div className="entity-picker-selected">
          <div>
            <div className="entity-picker-name">{selected.name}</div>
            <div className="muted small">
              {ACCOUNT_TYPE_LABELS[(selected.account_type as AccountType)] ??
                selected.account_type}
              {selected.website ? ` · ${selected.website}` : ''}
            </div>
            <Link
              className="muted small"
              to={`/sales/deal-sourcing/accounts/${selected.id}`}
            >
              Open account
            </Link>
          </div>
          <button
            type="button"
            className="btn ghost"
            disabled={disabled}
            onClick={() => {
              setOpen(true);
              setQ(selected.name);
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
        Search accounts{required ? ' *' : ''}
        <input
          value={q}
          disabled={disabled}
          placeholder="Company name…"
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
          {results.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="entity-picker-result"
                onClick={() => {
                  onChange(a.id, a);
                  setSelected(a);
                  setOpen(false);
                  setQ('');
                }}
              >
                <span className="entity-picker-name">{a.name}</span>
                <span className="muted small">
                  {ACCOUNT_TYPE_LABELS[(a.account_type as AccountType)] ?? a.account_type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && !loading && q.trim() && results.length === 0 ? (
        <p className="muted small">No matching accounts.</p>
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
          Add Account
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
            <h2>Add Account</h2>
            <form className="stack-form" onSubmit={(e) => void onCreate(e)}>
              <label>
                Company name
                <input
                  required
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </label>
              <label>
                Website
                <input
                  value={draftWebsite}
                  onChange={(e) => setDraftWebsite(e.target.value)}
                  placeholder="https://"
                />
              </label>
              <label>
                Type
                <select
                  value={draftType}
                  onChange={(e) => setDraftType(e.target.value as AccountType)}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
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
                  {creating ? 'Saving…' : 'Create account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
