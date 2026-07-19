import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { listAccounts } from '../lib/accountsApi';
import { createContact, listContacts } from '../lib/contactsApi';
import type { SalesAccount, SalesContact, SalesUser } from '../lib/types';
import { formatDate } from '../lib/types';

type Props = { salesUser: SalesUser };

export function ContactsPage({ salesUser }: Props) {
  const [rows, setRows] = useState<SalesContact[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [accounts, setAccounts] = useState<SalesAccount[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [accountId, setAccountId] = useState('');

  async function refresh(search = q) {
    setLoading(true);
    setError(null);
    try {
      setRows(await listContacts({ q: search, limit: 300 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
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

  async function openCreate() {
    setShowNew(true);
    try {
      setAccounts(await listAccounts({ limit: 200 }));
    } catch {
      setAccounts([]);
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    try {
      await createContact({
        full_name: fullName,
        primary_email: email,
        primary_phone: phone,
        account_id: accountId || null,
        created_by: salesUser.id,
      });
      setShowNew(false);
      setFullName('');
      setEmail('');
      setPhone('');
      setAccountId('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Contacts</h1>
          <p className="muted">
            People across accounts — email, phone, and SMS/call history live here.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn primary" onClick={() => void openCreate()}>
            Add contact
          </button>
        </div>
      </div>

      <div className="toolbar mb">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search contacts…"
          aria-label="Search contacts"
        />
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {loading ? <p className="muted">Loading contacts…</p> : null}

      {!loading ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Account</th>
                <th className="hide-sm">Email</th>
                <th className="hide-sm">Phone</th>
                <th className="hide-sm">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/sales/deal-sourcing/contacts/${c.id}`}>{c.full_name}</Link>
                    {c.title ? <div className="muted small">{c.title}</div> : null}
                  </td>
                  <td>
                    {c.sales_accounts ? (
                      <Link to={`/sales/deal-sourcing/accounts/${c.sales_accounts.id}`}>
                        {c.sales_accounts.name}
                      </Link>
                    ) : (
                      c.company || '—'
                    )}
                  </td>
                  <td className="hide-sm">{c.primary_email || '—'}</td>
                  <td className="hide-sm">{c.primary_phone || '—'}</td>
                  <td className="hide-sm">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? (
            <p className="muted" style={{ padding: '1rem' }}>
              No contacts yet. Add one from here or when creating a deal.
            </p>
          ) : null}
        </div>
      ) : null}

      {showNew ? (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add contact</h2>
            <form className="stack-form" onSubmit={(e) => void onCreate(e)}>
              <label>
                Full name
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </label>
              <label>
                Account
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">— Optional —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Phone
                <input value={phone} onChange={(e) => setPhone(e.target.value)} />
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
