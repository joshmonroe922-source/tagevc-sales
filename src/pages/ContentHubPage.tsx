import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  generateContent,
  getContentStats,
  listBlogPosts,
  listContentActivity,
  processScheduledContent,
} from '../lib/content/api';
import type { BlogPost, ContentActivity, DealPathTopic } from '../lib/content/types';
import { DEAL_PATH_LABELS } from '../lib/content/types';
import { formatDateTime } from '../lib/types';

export function ContentHubPage() {
  const [stats, setStats] = useState({
    totalBlogs: 0,
    publishedBlogs: 0,
    totalSocial: 0,
    scheduledSocial: 0,
    pendingApproval: 0,
  });
  const [blogs, setBlogs] = useState<BlogPost[]>([]);
  const [activity, setActivity] = useState<ContentActivity[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState<DealPathTopic>('launch');

  async function refresh() {
    setError(null);
    try {
      const [s, b, a] = await Promise.all([
        getContentStats(),
        listBlogPosts(),
        listContentActivity(12),
      ]);
      setStats(s);
      setBlogs(b.slice(0, 5));
      setActivity(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onGenerate() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await generateContent({
        topic,
        save_blog: true,
        save_social: true,
      });
      setMessage(
        `Generated (${result.draft.engine as string}) — blog + social drafts saved.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generate failed');
    } finally {
      setBusy(false);
    }
  }

  async function onRunScheduler() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await processScheduledContent();
      setMessage(
        `Scheduler: ${result.social_published ?? 0} social published, ${result.blogs_published ?? 0} blogs published.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scheduler failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Content for inbound founders</h1>
          <p className="muted">
            SEO blog and social scheduling that feeds deal flow — Launch, Partner, and Exit theses.
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => void onRunScheduler()}
          >
            Run scheduler
          </button>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {message ? <div className="banner ok">{message}</div> : null}

      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Blog posts</div>
          <div className="kpi-value">{stats.totalBlogs}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Published</div>
          <div className="kpi-value">{stats.publishedBlogs}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Social posts</div>
          <div className="kpi-value">{stats.totalSocial}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Scheduled</div>
          <div className="kpi-value">{stats.scheduledSocial}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Pending approval</div>
          <div className="kpi-value">{stats.pendingApproval}</div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="panel">
          <h2>Quick actions</h2>
          <div className="stack-form">
            <label>
              Generate topic (thesis)
              <select value={topic} onChange={(e) => setTopic(e.target.value as DealPathTopic)}>
                <option value="launch">Launch — build with us</option>
                <option value="partner">Partner — grow with us</option>
                <option value="exit">Exit — transition with us</option>
                <option value="general">General</option>
              </select>
            </label>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void onGenerate()}
            >
              {busy ? 'Working…' : 'AI generate blog + social draft'}
            </button>
            <p className="muted small">
              Uses OpenAI when configured; falls back to templates. Saves drafts to Blog and Social.
            </p>
          </div>
          <div className="page-actions mt">
            <Link className="btn primary" to="/sales/content/blog">
              Manage blog
            </Link>
            <Link className="btn ghost" to="/sales/content/social">
              Social scheduler
            </Link>
          </div>
        </div>

        <div className="panel">
          <h2>Recent blog posts</h2>
          <ul className="activity-list">
            {blogs.map((b) => (
              <li key={b.id}>
                <Link to={`/sales/content/blog/${b.id}`}>{b.title}</Link>
                <div className="muted small">
                  {b.deal_path ? DEAL_PATH_LABELS[b.deal_path] : 'General'} · {b.status} ·{' '}
                  {formatDateTime(b.updated_at)}
                </div>
              </li>
            ))}
          </ul>
          {blogs.length === 0 ? <p className="muted">No posts yet — run migration seed or generate.</p> : null}
        </div>
      </div>

      <div className="panel mt">
        <h2>Content activity</h2>
        <ul className="activity-list">
          {activity.map((a) => (
            <li key={a.id}>
              <div className="muted small">{formatDateTime(a.created_at)} · {a.activity_type}</div>
              <div className="activity-sum">{a.summary}</div>
            </li>
          ))}
        </ul>
      </div>

      <p className="muted small portal-todo-hint">
        Use <strong>Add To Do</strong> in the header to capture tasks in Microsoft To Do.
      </p>
    </>
  );
}
