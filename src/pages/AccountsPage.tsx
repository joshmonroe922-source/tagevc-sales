import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createAccount, listAccounts } from '../lib/accountsApi';
import type { AccountType, SalesAccount, SalesUser } from '../lib/types';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  formatDate,
} from '../lib/types';

type Props = { salesUser: SalesUser };

export function AccountsPage({ salesUser }: Props) {
  const [rows, setRows] = useState<SalesAccount[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('prospect');

  async function refresh(search = q) {
    setLoading(true);
    setError(null);
    try {
      setRows(await listAccounts({ q: search, limit: 300 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh('');
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(q), 200);
    return () => window.clearTimeout(t);
  }, [q]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    try {
      await createAccount({
        name,
        website,
        account_type: accountType,
        created_by: salesUser.id,
      });
      setShowNew(false);
      setName('');
      setWebsite('');
      setAccountType('prospect');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Accounts</h1>
          <p className="muted">Companies and organizations tied to deals and contacts.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn primary" onClick={() => setShowNew(true)}>
            Add account
          </button>
        </div>
      </div>

      <div className="toolbar mb">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search accounts…"
          aria-label="Search accounts"
        />
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {loading ? <p className="muted">Loading accounts…</p> : null}

      {!loading ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="hide-sm">Type</th>
                <th className="hide-sm">Website</th>
                <th className="hide-sm">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link to={`/sales/deal-sourcing/accounts/${a.id}`}>{a.name}</Link>
                  </td>
                  <td className="hide-sm">
                    {ACCOUNT_TYPE_LABELS[a.account_type as AccountType] ?? a.account_type}
                  </td>
                  <td className="hide-sm">{a.website || '—'}</td>
                  <td className="hide-sm">{formatDate(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? (
            <p className="muted" style={{ padding: '1rem' }}>
              No accounts yet. Add one from here or when creating a deal.
            </p>
          ) : null}
        </div>
      ) : null}

      {showNew ? (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add account</h2>
            <form className="stack-form" onSubmit={(e) => void onCreate(e)}>
              <label>
                Name
                <input required value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                Website
                <input value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
              <label>
                Type
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType)}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={() => setShowNew(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
