import { useEffect, useState } from 'react';
import { PortfolioEntityShell } from '../components/PortfolioEntityShell';
import { Recruit619KpiHierarchyPanel } from '../components/Recruit619KpiHierarchyPanel';
import {
  listEntityKpiValues,
  listEntityKpis,
  upsertEntityKpi,
  upsertEntityKpiValue,
  type EntityKpi,
} from '../lib/portfolioEntityApi';
import { isRecruit619Entity } from '../lib/recruit619';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

export function EntityKpisPage({ salesUser }: Props) {
  return (
    <PortfolioEntityShell section="kpis">
      {(entity) => (
        <EntityKpisBody
          entityId={entity.id}
          entityName={entity.name}
          entitySlug={entity.slug}
          salesUser={salesUser}
        />
      )}
    </PortfolioEntityShell>
  );
}

function EntityKpisBody({
  entityId,
  entityName,
  entitySlug,
  salesUser,
}: {
  entityId: string;
  entityName: string;
  entitySlug?: string | null;
  salesUser: SalesUser;
}) {
  const [periodKey, setPeriodKey] = useState(currentMonthKey());

  return (
    <>
      <KpiManager
        entityId={entityId}
        entityName={entityName}
        salesUser={salesUser}
        periodKey={periodKey}
        onPeriodKeyChange={setPeriodKey}
      />
      {isRecruit619Entity({ slug: entitySlug }) ? (
        <Recruit619KpiHierarchyPanel
          entityId={entityId}
          periodKey={periodKey}
          salesUser={salesUser}
        />
      ) : null}
    </>
  );
}

function KpiManager({
  entityId,
  entityName,
  salesUser,
  periodKey,
  onPeriodKeyChange,
}: {
  entityId: string;
  entityName: string;
  salesUser: SalesUser;
  periodKey: string;
  onPeriodKeyChange: (value: string) => void;
}) {
  const [kpis, setKpis] = useState<EntityKpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const list = await listEntityKpis(entityId);
      setKpis(list);
      const vals = await listEntityKpiValues(list.map((k) => k.id));
      const map: Record<string, string> = {};
      for (const k of list) {
        const match = vals.find(
          (v) => v.kpi_id === k.id && v.period_key === periodKey,
        );
        map[k.id] = match?.value != null ? String(match.value) : '';
      }
      setDraftValues(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load KPIs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, periodKey]);

  async function onAddKpi() {
    const label = newLabel.trim();
    if (!label) return;
    const key = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
    try {
      await upsertEntityKpi({
        entity_id: entityId,
        key: key || `kpi_${Date.now()}`,
        label,
        sort_order: (kpis.at(-1)?.sort_order ?? 0) + 10,
      });
      setNewLabel('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add KPI failed');
    }
  }

  async function onSaveValues() {
    try {
      for (const k of kpis) {
        const raw = draftValues[k.id]?.trim() ?? '';
        const value = raw === '' ? null : Number(raw);
        if (raw !== '' && Number.isNaN(value)) {
          throw new Error(`Invalid number for ${k.label}`);
        }
        await upsertEntityKpiValue({
          kpi_id: k.id,
          period_key: periodKey,
          period_label: periodKey,
          value,
          recorded_by: salesUser.id,
        });
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <section className="panel recruit619-section">
      <div className="panel-head">
        <h2>KPIs</h2>
        <span className="muted small">{entityName}</span>
      </div>
      <p className="muted">
        Entity-specific KPIs tied to Leadership goals. Defaults are seeded per
        company (Recruit 619, Signent HR, Instant NDA, Tage VC) or a generic set
        for new subsidiaries. For Recruit 619, see the hierarchy rollup below.
      </p>
      {error ? <div className="banner error">{error}</div> : null}

      <label className="stack-form" style={{ maxWidth: 220, marginBottom: '1rem' }}>
        <span className="muted small">Period key</span>
        <input
          value={periodKey}
          onChange={(e) => onPeriodKeyChange(e.target.value)}
          placeholder="2026-07"
        />
      </label>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>KPI</th>
                  <th>Unit</th>
                  <th>Target</th>
                  <th>Value ({periodKey})</th>
                </tr>
              </thead>
              <tbody>
                {kpis.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <strong>{k.label}</strong>
                      {k.description ? (
                        <div className="muted small">{k.description}</div>
                      ) : null}
                    </td>
                    <td>{k.unit || '—'}</td>
                    <td>{k.target_value ?? '—'}</td>
                    <td>
                      <input
                        value={draftValues[k.id] ?? ''}
                        onChange={(e) =>
                          setDraftValues((prev) => ({
                            ...prev,
                            [k.id]: e.target.value,
                          }))
                        }
                        inputMode="decimal"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="recruit619-actions" style={{ marginTop: '1rem' }}>
            <button type="button" className="btn primary" onClick={() => void onSaveValues()}>
              Save values
            </button>
          </div>
          <div className="recruit619-actions" style={{ marginTop: '1.25rem' }}>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="New KPI label"
            />
            <button type="button" className="btn" onClick={() => void onAddKpi()}>
              Add KPI
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
