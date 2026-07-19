import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PortfolioEntityShell } from '../components/PortfolioEntityShell';
import {
  FINANCIAL_PERIOD_OPTIONS,
  type FinancialPeriodType,
} from '../lib/portfolioEntity';
import {
  listFinancialSnapshots,
  syncEntityFinancialsFromReporting,
  type EntityFinancialSnapshot,
} from '../lib/portfolioEntityApi';
import { analyzeFinancialsWithGrok } from '../lib/thinkTankApi';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

export function EntityFinancialPage({ salesUser: _salesUser }: Props) {
  return (
    <PortfolioEntityShell section="financial">
      {(entity) => (
        <FinancialOverview
          entityId={entity.id}
          entityName={entity.name}
        />
      )}
    </PortfolioEntityShell>
  );
}

function FinancialOverview({
  entityId,
  entityName,
}: {
  entityId: string;
  entityName: string;
}) {
  const [periodType, setPeriodType] = useState<FinancialPeriodType>('mtd');
  const [rows, setRows] = useState<EntityFinancialSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const data = await listFinancialSnapshots(entityId, periodType);
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on period/entity
  }, [entityId, periodType]);

  async function onSync() {
    setSyncNote(null);
    try {
      const result = await syncEntityFinancialsFromReporting(entityId);
      setSyncNote(
        result.stub
          ? 'Sync hook is stubbed — wire entity reporting / Company-Books when ready. Finance audit lives in Accounting & Finance portal.'
          : `Synced ${result.synced} periods.`,
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    }
  }

  async function onAnalyze() {
    const primary = rows[0];
    setAnalyzing(true);
    setAnalysis(null);
    setError(null);
    try {
      const result = await analyzeFinancialsWithGrok({
        entityId,
        periodType,
        periodKey: primary?.period_key ?? periodType,
        snapshot: primary
          ? {
              period_label: primary.period_label,
              revenue: primary.revenue,
              cogs: primary.cogs,
              opex: primary.opex,
              net_income: primary.net_income,
              cash: primary.cash,
              currency: primary.currency,
              source: primary.source,
            }
          : {
              note: 'No snapshot rows yet — analyze based on missing data and ask what to sync.',
              entity: entityName,
              period_type: periodType,
            },
      });
      setAnalysis(result.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <section className="panel recruit619-section">
      <div className="panel-head">
        <h2>Financial Overview</h2>
        <span className="muted small">{entityName}</span>
      </div>
      <p className="muted">
        Period views for this entity. Numbers sync from entity reporting when
        wired; until then rows may be empty or manual. Control audits remain in{' '}
        <Link to="/sales/finance">Accounting &amp; Finance</Link>.
      </p>

      <div className="seg phase-seg" style={{ marginBottom: '1rem' }}>
        {FINANCIAL_PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={periodType === opt.id ? 'active' : undefined}
            onClick={() => setPeriodType(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="recruit619-actions" style={{ marginBottom: '1rem' }}>
        <button type="button" className="btn" onClick={() => void onSync()}>
          Sync from entity reporting
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={analyzing}
          onClick={() => void onAnalyze()}
        >
          {analyzing ? 'Analyzing…' : 'Grok summary'}
        </button>
      </div>

      {syncNote ? <div className="banner warn">{syncNote}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          No snapshots for this period yet. Use sync (stub) or insert into{' '}
          <code>entity_financial_snapshots</code> when reporting is ready.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Revenue</th>
                <th>COGS</th>
                <th>OpEx</th>
                <th>Net</th>
                <th>Cash</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.period_label || r.period_key}</td>
                  <td>{fmt(r.revenue, r.currency)}</td>
                  <td>{fmt(r.cogs, r.currency)}</td>
                  <td>{fmt(r.opex, r.currency)}</td>
                  <td>{fmt(r.net_income, r.currency)}</td>
                  <td>{fmt(r.cash, r.currency)}</td>
                  <td>{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {analysis ? (
        <div className="think-tank-msg think-tank-msg--assistant" style={{ marginTop: '1rem' }}>
          <div className="think-tank-msg-role">Grok financial summary</div>
          <div className="think-tank-msg-body">{analysis}</div>
        </div>
      ) : null}
    </section>
  );
}

function fmt(n: number | null, currency: string): string {
  if (n == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return String(n);
  }
}
