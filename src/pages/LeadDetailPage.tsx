import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAddTodo } from '../components/AddTodoProvider';
import { DealMailPanel } from '../components/DealMailPanel';
import {
  DealPartyFields,
  dealSnapshotsFromParty,
  type DealPartyValue,
} from '../components/DealPartyFields';
import { PhoneActions } from '../components/PhoneActions';
import {
  addLeadNote,
  getLead,
  listActivities,
  sendTrackedEmail,
  updateLeadViaEdge,
} from '../lib/api';
import {
  leadContactEmail,
  leadContactName,
  leadContactPhone,
} from '../lib/contactsApi';
import {
  EMAIL_SOURCE_LABELS,
  formatEmailWhen,
  listEmailMessages,
  type EmailMessage,
} from '../lib/emailAnalytics';
import { STAGE_GUIDANCE, stagePathTip } from '../lib/stageGuidance';
import type {
  DealPath,
  LeadActivity,
  LeadSource,
  LeadStage,
  SalesLead,
  SalesUser,
} from '../lib/types';
import {
  DEAL_PATH_LABELS,
  DEAL_PATH_THESES,
  DEAL_PATHS,
  LEAD_SOURCES,
  SOURCE_LABELS,
  STAGE_LABELS,
  STAGES,
  formatDateTime,
} from '../lib/types';

type Props = { salesUser: SalesUser };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function partyFromLead(lead: SalesLead): DealPartyValue {
  return {
    accountId: lead.account_id,
    contactId: lead.contact_id,
    account: lead.sales_accounts
      ? {
          id: lead.sales_accounts.id,
          name: lead.sales_accounts.name,
          website: lead.sales_accounts.website,
          account_type: lead.sales_accounts.account_type,
          notes: '',
          created_by: null,
          archived_at: null,
          created_at: '',
          updated_at: '',
        }
      : null,
    contact: lead.sales_contacts
      ? {
          id: lead.sales_contacts.id,
          account_id: lead.sales_contacts.account_id,
          full_name: lead.sales_contacts.full_name,
          title: lead.sales_contacts.title,
          company: lead.sales_contacts.company,
          primary_email: lead.sales_contacts.primary_email,
          primary_phone: lead.sales_contacts.primary_phone,
          emails: [],
          phones: [],
          notes: '',
          created_by: null,
          archived_at: null,
          created_at: '',
          updated_at: '',
        }
      : null,
  };
}

export function LeadDetailPage({ salesUser }: Props) {
  const { id } = useParams();
  const { openAddTodo } = useAddTodo();
  const [lead, setLead] = useState<SalesLead | null>(null);
  const [party, setParty] = useState<DealPartyValue>({
    accountId: null,
    contactId: null,
    account: null,
    contact: null,
  });
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

  async function refresh() {
    if (!id) return;
    setError(null);
    try {
      const [l, a, e] = await Promise.all([
        getLead(id),
        listActivities(id),
        listEmailMessages({ leadId: id, limit: 40 }),
      ]);
      setLead(l);
      if (l) {
        setParty(partyFromLead(l));
        const email = leadContactEmail(l);
        if (email) setEmailTo((prev) => prev || email);
      }
      setActivities(a);
      setEmails(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deal');
    }
  }

  useEffect(() => {
    void refresh();
  }, [id]);

  async function saveField<K extends keyof SalesLead>(key: K, value: SalesLead[K]) {
    if (!lead) return;
    setSaving(true);
    try {
      const updated = await updateLeadViaEdge(lead.id, { [key]: value } as never);
      setLead(updated);
      setParty(partyFromLead(updated));
      if (key === 'stage') {
        setActivities(await listActivities(lead.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onPartyChange(next: DealPartyValue) {
    setParty(next);
    if (!lead) return;
    if (!next.contactId) {
      setError('A contact is required on the deal.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const snap = dealSnapshotsFromParty(next);
      const updated = await updateLeadViaEdge(lead.id, {
        name: snap.name || lead.name,
        email: snap.email,
        phone: snap.phone,
        company: snap.company,
        contact_id: next.contactId,
        account_id: next.accountId,
      });
      setLead(updated);
      setParty(partyFromLead(updated));
      if (snap.email) setEmailTo(snap.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update party');
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function onAddNote(e: FormEvent) {
    e.preventDefault();
    if (!lead || !note.trim()) return;
    await addLeadNote(lead.id, note.trim(), salesUser.id);
    setNote('');
    await refresh();
  }

  async function onSendTrackedEmail(e: FormEvent) {
    e.preventDefault();
    if (!lead || !emailSubject.trim() || !emailBody.trim()) return;
    setEmailSending(true);
    setEmailNotice(null);
    setError(null);
    try {
      const result = await sendTrackedEmail({
        leadId: lead.id,
        to: emailTo.trim() || undefined,
        subject: emailSubject.trim(),
        html: plainTextToHtml(emailBody.trim()),
      });
      setEmailNotice(
        `Sent from ${result.from} to ${result.to}. Opens and clicks update in the list below.`,
      );
      setEmailSubject('');
      setEmailBody('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setEmailSending(false);
    }
  }

  if (!lead && !error) {
    return <p className="muted">Loading deal…</p>;
  }

  if (!lead) {
    return (
      <>
        <div className="banner error">{error ?? 'Deal not found'}</div>
        <Link className="back-link" to="/sales/deal-sourcing/leads">
          ← Back to deal flow
        </Link>
      </>
    );
  }

  const displayName = leadContactName(lead) || lead.name;
  const displayCompany =
    party.account?.name || lead.sales_accounts?.name || lead.company || 'No account';

  return (
    <>
      <Link className="back-link" to="/sales/deal-sourcing/leads">
        ← Deal flow
      </Link>
      <div className="page-header">
        <div>
          <h1>{displayName}</h1>
          <p className="muted">
            {displayCompany} · {DEAL_PATH_LABELS[lead.deal_path]} ·{' '}
            <span className="stage-pill">{STAGE_LABELS[lead.stage]}</span>
          </p>
          <p className="muted small">{DEAL_PATH_THESES[lead.deal_path]}</p>
        </div>
        <div className="page-actions">
          <PhoneActions
            phone={leadContactPhone(lead)}
            contactId={lead.contact_id}
            leadId={lead.id}
            createdBy={salesUser.id}
            size="compact"
          />
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              openAddTodo({
                leadId: lead.id,
                dealName: `${displayName}${displayCompany !== 'No account' ? ` · ${displayCompany}` : ''}`,
              })
            }
          >
            Follow Up / Next Action
          </button>
          {saving ? <span className="muted">Saving…</span> : null}
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="stage-focus panel mb">
        <div className="stage-focus-head">
          <h2>Focus for {STAGE_LABELS[lead.stage]}</h2>
          <p className="stage-focus-decision">{STAGE_GUIDANCE[lead.stage].decision}</p>
        </div>
        <p className="stage-focus-body">{STAGE_GUIDANCE[lead.stage].focus}</p>
        {stagePathTip(lead.stage, lead.deal_path) ? (
          <p className="stage-focus-path">
            <span className="stage-focus-path-label">{DEAL_PATH_LABELS[lead.deal_path]}</span>
            {stagePathTip(lead.stage, lead.deal_path)}
          </p>
        ) : null}
        <ul className="stage-checklist">
          {STAGE_GUIDANCE[lead.stage].checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="detail-grid lead-detail-grid">
        <div className="lead-detail-stack">
          <div className="panel panel-hug">
            <h2>Details</h2>
            <DealPartyFields
              value={party}
              createdBy={salesUser.id}
              requireContact
              disabled={saving}
              onChange={(next) => void onPartyChange(next)}
            />
            <div className="form-grid mt">
              <label>
                Stage
                <select
                  value={lead.stage}
                  onChange={(e) => void saveField('stage', e.target.value as LeadStage)}
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Thesis / path
                <select
                  value={lead.deal_path}
                  onChange={(e) => void saveField('deal_path', e.target.value as DealPath)}
                >
                  {DEAL_PATHS.map((p) => (
                    <option key={p} value={p}>
                      {DEAL_PATH_LABELS[p]} — {DEAL_PATH_THESES[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Source
                <select
                  value={lead.source}
                  onChange={(e) => void saveField('source', e.target.value as LeadSource)}
                >
                  {LEAD_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted small mt">
              Created {formatDateTime(lead.created_at)} · Updated {formatDateTime(lead.updated_at)}
            </p>
          </div>

          <div className="panel">
            <h2>Notes</h2>
            <p className="muted small">
              Saves to the activity timeline and appends to the deal notes field.
            </p>
            <form className="stack-form" onSubmit={(e) => void onAddNote(e)}>
              <label>
                New note
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={4}
                  required
                  placeholder="Call outcome, next step, diligence ask…"
                />
              </label>
              <button type="submit" className="btn primary" disabled={!note.trim()}>
                Save note
              </button>
            </form>
            <ul className="activity-list mt">
              {activities
                .filter((a) => a.activity_type === 'note')
                .map((a) => (
                  <li key={a.id}>
                    <div className="muted small">{formatDateTime(a.created_at)}</div>
                    <div className="activity-sum">{a.summary}</div>
                  </li>
                ))}
            </ul>
            {activities.every((a) => a.activity_type !== 'note') ? (
              <p className="muted mt">No notes yet.</p>
            ) : null}
          </div>
        </div>

        <div className="lead-detail-side">
          <div className="panel mb">
            <h2>Email</h2>
            <p className="muted small">
              Outlook conversations with this contact — open a message to read the full thread.
            </p>
            <DealMailPanel
              leadEmail={leadContactEmail(lead) || lead.email}
            />
          </div>

          <div className="panel mb">
            <h2>Send tracked email</h2>
            <p className="muted small">
              Sends from your connected Microsoft mailbox (appears in Sent Items; replies land in
              Outlook). Open/click tracking uses a pixel and link redirects — connect Microsoft
              mail in Settings if needed.
            </p>
            <form className="stack-form" onSubmit={(e) => void onSendTrackedEmail(e)}>
              <label>
                To
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder={
                    leadContactEmail(lead) || lead.email || 'recipient@example.com'
                  }
                  required
                />
              </label>
              <label>
                Subject
                <input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  required
                />
              </label>
              <label>
                Body
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={6}
                  required
                  placeholder="Plain text — line breaks become paragraphs. Put full https:// links for click tracking."
                />
              </label>
              <button type="submit" className="btn primary" disabled={emailSending}>
                {emailSending ? 'Sending…' : 'Send tracked email'}
              </button>
            </form>
            {emailNotice ? <p className="muted mt">{emailNotice}</p> : null}
            {emails.length > 0 ? (
              <ul className="email-lead-list mt">
                {emails.map((m) => (
                  <li key={m.id}>
                    <div className="muted small">
                      {formatEmailWhen(m.created_at)} ·{' '}
                      {EMAIL_SOURCE_LABELS[m.source] ?? m.source}
                    </div>
                    <div>{m.subject || '(no subject)'}</div>
                    <div className="muted small">
                      {m.open_count} open{m.open_count === 1 ? '' : 's'} · {m.click_count}{' '}
                      click{m.click_count === 1 ? '' : 's'} · {m.status}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted mt">No tracked emails for this lead yet.</p>
            )}
          </div>

          <div className="panel">
            <h2>Activity</h2>
            <p className="muted small">Stage changes, drip, email, and system events.</p>
            <ul className="activity-list mt">
              {activities
                .filter((a) => a.activity_type !== 'note')
                .map((a) => (
                  <li key={a.id}>
                    <div className="muted small">
                      {formatDateTime(a.created_at)} · {a.activity_type}
                    </div>
                    <div className="activity-sum">{a.summary}</div>
                  </li>
                ))}
            </ul>
            {activities.filter((a) => a.activity_type !== 'note').length === 0 ? (
              <p className="muted">No other activity yet.</p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
