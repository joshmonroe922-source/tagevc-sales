import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  createSocialPost,
  deleteSocialPost,
  listSocialPosts,
  processScheduledContent,
  updateSocialPost,
} from '../lib/content/api';
import {
  ALL_PLATFORMS,
  PLATFORM_LABELS,
  PLATFORM_LIMITS,
  DEAL_PATH_LABELS,
  type DealPathTopic,
  type SocialPlatform,
  type SocialPost,
} from '../lib/content/types';
import type { SalesUser } from '../lib/types';
import { formatDateTime } from '../lib/types';

type Props = { salesUser: SalesUser };

const TABS = [
  { id: 'compose', label: 'Compose' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'queue', label: 'Queue' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'published', label: 'Published' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export function SocialPage({ salesUser }: Props) {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'compose';
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [content, setContent] = useState('');
  const [platforms, setPlatforms] = useState<SocialPlatform[]>(['linkedin']);
  const [scheduledAt, setScheduledAt] = useState('');
  const [linkUrl, setLinkUrl] = useState('https://tagevc.com');
  const [campaignTag, setCampaignTag] = useState('');
  const [dealPath, setDealPath] = useState<DealPathTopic>('general');

  async function refresh() {
    setError(null);
    try {
      setPosts(await listSocialPosts());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    switch (tab) {
      case 'queue':
        return posts.filter((p) => p.status === 'scheduled' && p.approval_status !== 'pending');
      case 'approvals':
        return posts.filter((p) => p.approval_status === 'pending');
      case 'drafts':
        return posts.filter((p) => p.status === 'draft');
      case 'published':
        return posts.filter((p) => p.status === 'published');
      case 'calendar':
        return posts.filter((p) => p.scheduled_at);
      default:
        return posts;
    }
  }, [posts, tab]);

  const pendingCount = posts.filter((p) => p.approval_status === 'pending').length;
  const minLimit = Math.min(...platforms.map((p) => PLATFORM_LIMITS[p]), 3000);

  function setTab(t: Tab) {
    setParams({ tab: t });
  }

  function togglePlatform(p: SocialPlatform) {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  }

  async function savePost(status: string, approvalStatus = 'none') {
    if (!content.trim() || platforms.length === 0) {
      setError('Content and at least one platform required.');
      return;
    }
    if (content.length > minLimit) {
      setError(`Content exceeds shortest platform limit (${minLimit} chars).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createSocialPost({
        content: content.trim(),
        platforms,
        author_id: salesUser.id,
        status,
        scheduled_at: scheduledAt
          ? new Date(scheduledAt).toISOString()
          : null,
        link_url: linkUrl || null,
        campaign_tag: campaignTag || null,
        deal_path: dealPath,
        approval_status: approvalStatus,
      });
      setContent('');
      setMessage(
        approvalStatus === 'pending'
          ? 'Submitted for approval.'
          : `Post saved as ${status}.`,
      );
      await refresh();
      if (approvalStatus === 'pending') setTab('approvals');
      else if (status === 'scheduled') setTab('queue');
      else if (status === 'draft') setTab('drafts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function publishNow(id: string) {
    setBusy(true);
    try {
      await updateSocialPost(id, {
        status: 'scheduled',
        scheduled_at: new Date().toISOString(),
        approval_status: 'approved',
      });
      await processScheduledContent();
      setMessage('Publish triggered.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setBusy(false);
    }
  }

  async function approvePost(id: string) {
    setBusy(true);
    try {
      await updateSocialPost(id, {
        approval_status: 'approved',
        status: 'scheduled',
        rejection_note: null,
      });
      setMessage('Post approved and moved to queue.');
      await refresh();
      setTab('queue');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  }

  async function rejectPost(id: string) {
    const note =
      window.prompt('Rejection note (optional — shown on the draft):', 'Needs revision') ??
      'Needs revision';
    setBusy(true);
    try {
      await updateSocialPost(id, {
        approval_status: 'rejected',
        status: 'draft',
        rejection_note: note.trim() || 'Needs revision',
      });
      setMessage('Post rejected — back in drafts.');
      await refresh();
      setTab('drafts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link className="back-link" to="/sales/content">
        ← Content hub
      </Link>
      <div className="page-header">
        <div>
          <h1>Social scheduler</h1>
          <p className="muted">
            Compose, schedule, approve, and publish founder-facing content. Mock publish until
            OAuth (phase 2).
          </p>
        </div>
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={() =>
            void processScheduledContent()
              .then((r) => setMessage(`Processed: ${JSON.stringify(r)}`))
              .catch((e) => setError(e.message))
          }
        >
          Run scheduler
        </button>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {message ? <div className="banner ok">{message}</div> : null}

      <div className="seg seg-tabs mb">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'approvals' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      {tab === 'compose' ? (
        <div className="panel">
          <h2>Compose</h2>
          <div className="stack-form">
            <div>
              <span className="muted small">Platforms</span>
              <div className="page-actions" style={{ marginTop: '0.35rem' }}>
                {ALL_PLATFORMS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`btn ${platforms.includes(p) ? 'primary' : 'ghost'}`}
                    onClick={() => togglePlatform(p)}
                  >
                    {PLATFORM_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
            <label>
              Content ({content.length}/{minLimit})
              <textarea
                rows={8}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write a post for founders and operators…"
              />
            </label>
            <label>
              Link URL
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
            </label>
            <label>
              Schedule (optional)
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </label>
            <label>
              Campaign tag
              <input
                value={campaignTag}
                onChange={(e) => setCampaignTag(e.target.value)}
                placeholder="blog-launch-q1"
              />
            </label>
            <label>
              Thesis / path
              <select
                value={dealPath}
                onChange={(e) => setDealPath(e.target.value as DealPathTopic)}
              >
                <option value="launch">Launch — build with us</option>
                <option value="partner">Partner — grow with us</option>
                <option value="exit">Exit — transition with us</option>
                <option value="general">General</option>
              </select>
            </label>
            <div className="page-actions">
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => void savePost('draft')}
              >
                Save draft
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void savePost(scheduledAt ? 'scheduled' : 'draft')}
              >
                {scheduledAt ? 'Schedule' : 'Save'}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => void savePost(scheduledAt ? 'scheduled' : 'draft', 'pending')}
              >
                Submit for approval
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'calendar' ? (
        <div className="panel">
          <h2>Calendar</h2>
          <ul className="activity-list">
            {filtered
              .slice()
              .sort(
                (a, b) =>
                  new Date(a.scheduled_at ?? 0).getTime() -
                  new Date(b.scheduled_at ?? 0).getTime(),
              )
              .map((p) => (
                <li key={p.id}>
                  <div className="muted small">
                    {formatDateTime(p.scheduled_at)} · {p.status}
                    {p.approval_status === 'pending' ? ' · pending approval' : ''}
                  </div>
                  <div className="activity-sum">{p.content.slice(0, 120)}…</div>
                  <div className="muted small">
                    {p.platforms.map((pl) => PLATFORM_LABELS[pl]).join(', ')}
                    {p.campaign_tag ? ` · #${p.campaign_tag}` : ''}
                  </div>
                </li>
              ))}
          </ul>
          {filtered.length === 0 ? <p className="muted">Nothing scheduled.</p> : null}
        </div>
      ) : null}

      {tab === 'approvals' ? (
        <div className="panel">
          <h2>Approval queue</h2>
          <p className="muted small" style={{ marginTop: '-0.35rem', marginBottom: '1rem' }}>
            Posts submitted for approval stay here until approved (→ queue) or rejected (→ drafts
            with a note). Scheduler only publishes when approval is none or approved.
          </p>
          <ul className="task-list large">
            {filtered.map((p) => (
              <li key={p.id}>
                <div style={{ flex: 1 }}>
                  <div className="page-actions" style={{ marginBottom: '0.5rem' }}>
                    <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>
                      pending
                    </span>
                    {p.deal_path ? (
                      <span className="badge">{DEAL_PATH_LABELS[p.deal_path]}</span>
                    ) : null}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{p.content}</div>
                  <div className="muted small">
                    {p.platforms.map((pl) => PLATFORM_LABELS[pl]).join(', ')}
                    {p.scheduled_at ? ` · ${formatDateTime(p.scheduled_at)}` : ''}
                    {p.campaign_tag ? ` · #${p.campaign_tag}` : ''}
                    {p.link_url ? ` · ${p.link_url}` : ''}
                  </div>
                </div>
                <div className="task-meta">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void approvePost(p.id)}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void rejectPost(p.id)}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {filtered.length === 0 ? (
            <p className="muted">No posts pending approval.</p>
          ) : null}
        </div>
      ) : null}

      {tab !== 'compose' && tab !== 'calendar' && tab !== 'approvals' ? (
        <div className="panel">
          <h2>{TABS.find((t) => t.id === tab)?.label ?? tab}</h2>
          <ul className="task-list large">
            {filtered.map((p) => (
              <li key={p.id}>
                <div style={{ flex: 1 }}>
                  <div>
                    {p.content.slice(0, 160)}
                    {p.content.length > 160 ? '…' : ''}
                  </div>
                  <div className="muted small">
                    {p.platforms.map((pl) => PLATFORM_LABELS[pl]).join(', ')} · {p.status}
                    {p.approval_status !== 'none' ? ` · ${p.approval_status}` : ''}
                    {p.scheduled_at ? ` · ${formatDateTime(p.scheduled_at)}` : ''}
                    {p.campaign_tag ? ` · #${p.campaign_tag}` : ''}
                  </div>
                  {p.rejection_note ? (
                    <div className="muted small" style={{ color: '#92400e' }}>
                      Rejection: {p.rejection_note}
                    </div>
                  ) : null}
                </div>
                <div className="task-meta">
                  {p.status === 'draft' || p.status === 'scheduled' ? (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => void publishNow(p.id)}
                    >
                      Publish now
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn link"
                    onClick={() => void deleteSocialPost(p.id).then(refresh)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {filtered.length === 0 ? <p className="muted">No posts in this view.</p> : null}
        </div>
      ) : null}
    </>
  );
}
