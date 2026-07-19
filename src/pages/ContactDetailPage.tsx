import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PhoneActions } from '../components/PhoneActions';
import { listAccounts } from '../lib/accountsApi';
import {
  addContactNote,
  getContact,
  listContactActivities,
  listLeadsForContact,
  updateContact,
} from '../lib/contactsApi';
import type {
  LeadActivity,
  SalesAccount,
  SalesContact,
  SalesLead,
  SalesUser,
} from '../lib/types';
import { DEAL_PATH_LABELS, STAGE_LABELS, formatDateTime } from '../lib/types';

type Props = { salesUser: SalesUser };

export function ContactDetailPage({ salesUser }: Props) {
  const { id } = useParams();
  const [contact, setContact] = useState<SalesContact | null>(null);
  const [accounts, setAccounts] = useState<SalesAccount[]>([]);
  const [deals, setDeals] = useState<SalesLead[]>([]);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  async function refresh() {
    if (!id) return;
    setError(null);
    try {
      const [c, d, a, accts] = await Promise.all([
        getContact(id),
        listLeadsForContact(id),
        listContactActivities(id),
        listAccounts({ limit: 300 }),
      ]);
      setContact(c);
      setDeals(d);
      setActivities(a);
      setAccounts(accts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contact');
    }
  }

  useEffect(() => {
    void refresh();
  }, [id]);

  async function saveField(patch: Parameters<typeof updateContact>[1]) {
    if (!contact) return;
    setSaving(true);
    try {
      setContact(await updateContact(contact.id, patch));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onAddNote(e: FormEvent) {
    e.preventDefault();
    if (!contact || !note.trim()) return;
    await addContactNote(contact.id, note.trim(), salesUser.id);
    setNote('');
    await refresh();
  }

  if (!contact && !error) return <p className="muted">Loading contact…</p>;
  if (!contact) {
    return (
      <>
        <div className="banner error">{error ?? 'Contact not found'}</div>
        <Link className="back-link" to="/sales/deal-sourcing/contacts">
          ← Contacts
        </Link>
      </>
    );
  }

  return (
    <>
      <Link className="back-link" to="/sales/deal-sourcing/contacts">
        ← Contacts
      </Link>
      <div className="page-header">
        <div>
          <h1>{contact.full_name}</h1>
          <p className="muted">
            {contact.sales_accounts ? (
              <Link to={`/sales/deal-sourcing/accounts/${contact.sales_accounts.id}`}>
                {contact.sales_accounts.name}
              </Link>
            ) : (
              contact.company || 'No account'
            )}
            {contact.title ? ` · ${contact.title}` : ''}
            {saving ? ' · Saving…' : ''}
          </p>
        </div>
        <div className="page-actions">
          <PhoneActions
            phone={contact.primary_phone}
            contactId={contact.id}
            createdBy={salesUser.id}
          />
        </div>
      </div>
      {error ? <div className="banner error">{error}</div> : null}

      <div className="detail-grid">
        <div className="panel">
          <h2>Contact</h2>
          <div className="form-grid">
            <label>
              Full name
              <input
                defaultValue={contact.full_name}
                onBlur={(e) => {
                  if (e.target.value.trim() !== contact.full_name) {
                    void saveField({ full_name: e.target.value.trim() });
                  }
                }}
              />
            </label>
            <label>
              Title
              <input
                defaultValue={contact.title}
                onBlur={(e) => {
                  if (e.target.value !== contact.title) {
                    void saveField({ title: e.target.value });
                  }
                }}
              />
            </label>
            <label>
              Primary email
              <input
                type="email"
                defaultValue={contact.primary_email}
                onBlur={(e) => {
                  if (e.target.value !== contact.primary_email) {
                    void saveField({ primary_email: e.target.value });
                  }
                }}
              />
            </label>
            <label>
              Primary phone
              <input
                defaultValue={contact.primary_phone}
                onBlur={(e) => {
                  if (e.target.value !== contact.primary_phone) {
                    void saveField({ primary_phone: e.target.value });
                  }
                }}
              />
            </label>
            <label className="full">
              Account
              <select
                value={contact.account_id ?? ''}
                onChange={(e) =>
                  void saveField({ account_id: e.target.value || null })
                }
              >
                <option value="">— None —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="full">
              Notes
              <textarea
                defaultValue={contact.notes}
                onBlur={(e) => {
                  if (e.target.value !== contact.notes) {
                    void saveField({ notes: e.target.value });
                  }
                }}
              />
            </label>
          </div>
          {(contact.emails?.length ?? 0) > 1 || (contact.phones?.length ?? 0) > 1 ? (
            <p className="muted small mt">
              Extra emails: {(contact.emails ?? []).join(', ') || '—'}
              <br />
              Extra phones: {(contact.phones ?? []).join(', ') || '—'}
            </p>
          ) : null}
        </div>

        <div>
          <div className="panel mb">
            <h2>Linked deals</h2>
            {deals.length === 0 ? (
              <p className="muted">No deals yet.</p>
            ) : (
              <ul className="activity-list">
                {deals.map((d) => (
                  <li key={d.id}>
                    <Link to={`/sales/deal-sourcing/leads/${d.id}`}>{d.name}</Link>
                    <div className="muted small">
                      {d.company || '—'} · {STAGE_LABELS[d.stage]} ·{' '}
                      {DEAL_PATH_LABELS[d.deal_path]}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel">
            <h2>Activity</h2>
            <p className="muted small">
              Email, SMS, and call history for this person (deal-linked or contact-only).
            </p>
            <form className="stack-form" onSubmit={(e) => void onAddNote(e)}>
              <label>
                Add note
                <textarea value={note} onChange={(e) => setNote(e.target.value)} required />
              </label>
              <button type="submit" className="btn ghost">
                Save note
              </button>
            </form>
            <ul className="activity-list mt">
              {activities.map((a) => (
                <li key={a.id}>
                  <div className="muted small">
                    {formatDateTime(a.created_at)} · {a.activity_type}
                    {a.lead_id ? (
                      <>
                        {' · '}
                        <Link to={`/sales/deal-sourcing/leads/${a.lead_id}`}>Deal</Link>
                      </>
                    ) : null}
                  </div>
                  <div className="activity-sum">{a.summary}</div>
                </li>
              ))}
            </ul>
            {activities.length === 0 ? <p className="muted">No activity yet.</p> : null}
          </div>
        </div>
      </div>
    </>
  );
}
