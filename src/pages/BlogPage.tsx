import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createBlogPost, listBlogPosts } from '../lib/content/api';
import type { BlogPost } from '../lib/content/types';
import { DEAL_PATH_LABELS } from '../lib/content/types';
import type { SalesUser } from '../lib/types';
import { formatDateTime } from '../lib/types';

type Props = { salesUser: SalesUser };

export function BlogPage({ salesUser }: Props) {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  async function refresh() {
    setError(null);
    try {
      const all = await listBlogPosts();
      setPosts(
        filter === 'all' ? all : all.filter((p) => p.status === filter),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    void refresh();
  }, [filter]);

  async function onCreate() {
    if (!title.trim()) return;
    try {
      const post = await createBlogPost({
        title: title.trim(),
        body: '## Draft\n\nStart writing…',
        author_id: salesUser.id,
      });
      setTitle('');
      window.location.href = `/sales/content/blog/${post.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <>
      <Link className="back-link" to="/sales/content">
        ← Content hub
      </Link>
      <div className="page-header">
        <div>
          <h1>Blog</h1>
          <p className="muted">SEO articles for tagevc.com — sync to public site when ready.</p>
        </div>
        <div className="page-actions">
          <div className="seg">
            {['all', 'draft', 'scheduled', 'published'].map((f) => (
              <button
                key={f}
                type="button"
                className={filter === f ? 'active' : ''}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="panel mb">
        <div className="inline-form">
          <input
            placeholder="New post title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onCreate();
            }}
          />
          <button type="button" className="btn primary" onClick={() => void onCreate()}>
            New post
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th className="hide-sm">Path</th>
              <th>Status</th>
              <th className="hide-sm">Slug</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/sales/content/blog/${p.id}`}>{p.title}</Link>
                  <div className="muted small">{p.excerpt.slice(0, 80)}…</div>
                </td>
                <td className="hide-sm">{p.deal_path ? DEAL_PATH_LABELS[p.deal_path] : '—'}</td>
                <td>
                  <span className="stage-pill">{p.status}</span>
                </td>
                <td className="hide-sm">
                  <code className="small">{p.slug}</code>
                </td>
                <td>{formatDateTime(p.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {posts.length === 0 ? (
          <p className="muted" style={{ padding: '1rem' }}>
            No posts. Run migration 0002 for SEO seed content or create a new post.
          </p>
        ) : null}
      </div>
    </>
  );
}
