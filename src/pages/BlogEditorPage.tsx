import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { deleteBlogPost, getBlogPost, updateBlogPost } from '../lib/content/api';
import type { BlogPost, DealPathTopic } from '../lib/content/types';
import { DEAL_PATH_LABELS } from '../lib/content/types';
import { formatDateTime } from '../lib/types';

export function BlogEditorPage() {
  const { id } = useParams();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void getBlogPost(id)
      .then(setPost)
      .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'));
  }, [id]);

  async function save(patch: Partial<BlogPost>) {
    if (!post) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateBlogPost(post.id, patch);
      setPost(updated);
      setMessage('Saved');
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onPublish() {
    if (!post) return;
    await save({
      status: 'published',
      published_at: new Date().toISOString(),
    });
  }

  async function onSchedule(date: string) {
    if (!post || !date) return;
    await save({
      status: 'scheduled',
      scheduled_at: new Date(`${date}T12:00:00`).toISOString(),
    });
  }

  async function onDelete() {
    if (!post || !confirm('Delete this post?')) return;
    await deleteBlogPost(post.id);
    window.location.href = '/sales/content/blog';
  }

  function exportMarkdown() {
    if (!post) return;
    const md = `---\ntitle: ${post.seo_title || post.title}\ndescription: ${post.seo_description}\nkeywords: ${post.seo_keywords.join(', ')}\nslug: ${post.slug}\n---\n\n${post.body}`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${post.slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!post && !error) return <p className="muted">Loading…</p>;
  if (!post) {
    return (
      <>
        <div className="banner error">{error}</div>
        <Link className="back-link" to="/sales/content/blog">
          ← Blog
        </Link>
      </>
    );
  }

  return (
    <>
      <Link className="back-link" to="/sales/content/blog">
        ← Blog
      </Link>
      <div className="page-header">
        <div>
          <h1>Edit post</h1>
          <p className="muted">
            /blog/{post.slug} · {saving ? 'Saving…' : message ?? formatDateTime(post.updated_at)}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn ghost" onClick={exportMarkdown}>
            Export MD
          </button>
          <button type="button" className="btn primary" onClick={() => void onPublish()}>
            Publish now
          </button>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="panel">
        <div className="form-grid">
          <label className="full">
            Title
            <input
              value={post.title}
              onChange={(e) => setPost({ ...post, title: e.target.value })}
              onBlur={() => void save({ title: post.title })}
            />
          </label>
          <label>
            Deal path
            <select
              value={post.deal_path ?? 'general'}
              onChange={(e) => {
                const deal_path = e.target.value as DealPathTopic;
                setPost({ ...post, deal_path });
                void save({ deal_path });
              }}
            >
              {Object.entries(DEAL_PATH_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={post.status}
              onChange={(e) => {
                const status = e.target.value as BlogPost['status'];
                setPost({ ...post, status });
                void save({ status });
              }}
            >
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published</option>
            </select>
          </label>
          <label>
            Schedule date
            <input
              type="date"
              value={post.scheduled_at?.slice(0, 10) ?? ''}
              onChange={(e) => void onSchedule(e.target.value)}
            />
          </label>
          <label className="full">
            Excerpt
            <textarea
              value={post.excerpt}
              onChange={(e) => setPost({ ...post, excerpt: e.target.value })}
              onBlur={() => void save({ excerpt: post.excerpt })}
              rows={2}
            />
          </label>
          <label className="full">
            Body (Markdown)
            <textarea
              value={post.body}
              onChange={(e) => setPost({ ...post, body: e.target.value })}
              onBlur={() => void save({ body: post.body })}
              rows={16}
            />
          </label>
          <label className="full">
            SEO title
            <input
              value={post.seo_title}
              onChange={(e) => setPost({ ...post, seo_title: e.target.value })}
              onBlur={() => void save({ seo_title: post.seo_title })}
            />
          </label>
          <label className="full">
            SEO description
            <textarea
              value={post.seo_description}
              onChange={(e) => setPost({ ...post, seo_description: e.target.value })}
              onBlur={() => void save({ seo_description: post.seo_description })}
              rows={2}
            />
          </label>
          <label className="full">
            SEO keywords (comma-separated)
            <input
              value={post.seo_keywords.join(', ')}
              onChange={(e) =>
                setPost({
                  ...post,
                  seo_keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean),
                })
              }
              onBlur={() => void save({ seo_keywords: post.seo_keywords })}
            />
          </label>
        </div>
        <div className="modal-actions mt">
          <button type="button" className="btn ghost" onClick={() => void onDelete()}>
            Delete
          </button>
        </div>
      </div>
    </>
  );
}
