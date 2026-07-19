import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getAccount,
  listContactsForAccount,
  listLeadsForAccount,
  updateAccount,
} from '../lib/accountsApi';
import type {
  AccountType,
  SalesAccount,
  SalesContact,
  SalesLead,
  SalesUser,
} from '../lib/types';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  DEAL_PATH_LABELS,
  STAGE_LABELS,
  formatDateTime,
} from '../lib/types';

type Props = { salesUser: SalesUser };

export function AccountDetailPage({ salesUser: _salesUser }: Props) {
  const { id } = useParams();
  const [account, setAccount] = useState<SalesAccount | null>(null);
  const [contacts, setContacts] = useState<SalesContact[]>([]);
  const [deals, setDeals] = useState<SalesLead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    if (!id) return;
    setError(null);
    try {
      const [a, c, d] = await Promise.all([
        getAccount(id),
        listContactsForAccount(id),
        listLeadsForAccount(id),
      ]);
      setAccount(a);
      setContacts(c);
      setDeals(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load account');
    }
  }

  useEffect(() => {
    void refresh();
  }, [id]);

  async function saveField(patch: Parameters<typeof updateAccount>[1]) {
    if (!account) return;
    setSaving(true);
    try {
      setAccount(await updateAccount(account.id, patch));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!account && !error) return <p className="muted">Loading account…</p>;
  if (!account) {
    return (
      <>
        <div className="banner error">{error ?? 'Account not found'}</div>
        <Link className="back-link" to="/sales/deal-sourcing/accounts">
          ← Accounts
        </Link>
      </>
    );
  }

  return (
    <>
      <Link className="back-link" to="/sales/deal-sourcing/accounts">
        ← Accounts
      </Link>
      <div className="page-header">
        <div>
          <h1>{account.name}</h1>
          <p className="muted">
            {ACCOUNT_TYPE_LABELS[account.account_type as AccountType] ?? account.account_type}
            {saving ? ' · Saving…' : ''}
          </p>
        </div>
      </div>
      {error ? <div className="banner error">{error}</div> : null}

      <div className="detail-grid">
        <div className="panel">
          <h2>Account</h2>
          <div className="form-grid">
            <label className="full">
              Name
              <input
                defaultValue={account.name}
                onBlur={(e) => {
                  if (e.target.value.trim() !== account.name) {
                    void saveField({ name: e.target.value.trim() });
                  }
                }}
              />
            </label>
            <label>
              Website
              <input
                defaultValue={account.website}
                onBlur={(e) => {
                  if (e.target.value !== account.website) {
                    void saveField({ website: e.target.value });
                  }
                }}
              />
            </label>
            <label>
              Type
              <select
                value={account.account_type}
                onChange={(e) =>
                  void saveField({ account_type: e.target.value as AccountType })
                }
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="full">
              Notes
              <textarea
                defaultValue={account.notes}
                onBlur={(e) => {
                  if (e.target.value !== account.notes) {
                    void saveField({ notes: e.target.value });
                  }
                }}
              />
            </label>
          </div>
          <p className="muted small mt">
            Updated {formatDateTime(account.updated_at)}
          </p>
        </div>

        <div>
          <div className="panel mb">
            <h2>Contacts</h2>
            {contacts.length === 0 ? (
              <p className="muted">No people on this account yet.</p>
            ) : (
              <ul className="activity-list">
                {contacts.map((c) => (
                  <li key={c.id}>
                    <Link to={`/sales/deal-sourcing/contacts/${c.id}`}>{c.full_name}</Link>
                    <div className="muted small">
                      {[c.title, c.primary_email, c.primary_phone]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel">
            <h2>Deals</h2>
            {deals.length === 0 ? (
              <p className="muted">No deals linked yet.</p>
            ) : (
              <ul className="activity-list">
                {deals.map((d) => (
                  <li key={d.id}>
                    <Link to={`/sales/deal-sourcing/leads/${d.id}`}>{d.name}</Link>
                    <div className="muted small">
                      {STAGE_LABELS[d.stage]} · {DEAL_PATH_LABELS[d.deal_path]}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
