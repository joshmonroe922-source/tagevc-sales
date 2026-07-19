import { useEffect, useState } from 'react';
import { PortfolioEntityShell } from '../components/PortfolioEntityShell';
import {
  getEntityLeadership,
  upsertEntityLeadership,
} from '../lib/portfolioEntityApi';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

export function EntityLeadershipPage({ salesUser }: Props) {
  return (
    <PortfolioEntityShell section="leadership">
      {(entity) => (
        <LeadershipEditor entityId={entity.id} salesUser={salesUser} />
      )}
    </PortfolioEntityShell>
  );
}

function LeadershipEditor({
  entityId,
  salesUser,
}: {
  entityId: string;
  salesUser: SalesUser;
}) {
  const [strategy, setStrategy] = useState('');
  const [goals, setGoals] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await getEntityLeadership(entityId);
        if (!mounted) return;
        setStrategy(row?.strategy_md ?? '');
        setGoals(row?.goals_md ?? '');
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [entityId]);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const row = await upsertEntityLeadership({
        entityId,
        strategy_md: strategy,
        goals_md: goals,
        updated_by: salesUser.id,
      });
      setSavedAt(row.updated_at);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel recruit619-section">
      <div className="panel-head">
        <h2>Leadership</h2>
        <span className="muted small">Strategy &amp; goals</span>
      </div>
      <p className="muted">
        House strategy and goals for this entity. Markdown-friendly plain text is
        fine for v1.
      </p>
      {error ? <div className="banner error">{error}</div> : null}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
          <div className="stack-form">
          <label>
            <span className="muted small">Strategy</span>
            <textarea
              rows={8}
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              placeholder="Where this company is going, moat, GTM thesis…"
            />
          </label>
          <label>
            <span className="muted small">Goals</span>
            <textarea
              rows={8}
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              placeholder="Quarterly / annual goals, OKRs, hiring milestones…"
            />
          </label>
          <div className="recruit619-actions">
            <button
              type="button"
              className="btn primary"
              disabled={saving}
              onClick={() => void onSave()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {savedAt ? (
              <span className="muted small">Saved {new Date(savedAt).toLocaleString()}</span>
            ) : null}
          </div>
          </div>
      )}
    </section>
  );
}
