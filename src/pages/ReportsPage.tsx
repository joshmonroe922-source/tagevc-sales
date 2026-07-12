import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { listLeads } from '../lib/api';
import { computeDashboard } from '../lib/reports';
import type { SalesLead } from '../lib/types';
import { DEAL_PATH_LABELS, STAGE_LABELS, formatDateTime } from '../lib/types';

export function ReportsPage() {
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listLeads()
      .then(setLeads)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, []);

  const stats = useMemo(() => computeDashboard(leads), [leads]);

  const stageChart = stats.byStage.map((row) => ({
    name: STAGE_LABELS[row.stage],
    count: row.count,
  }));

  const pathChart = stats.byPath.map((row) => ({
    name: DEAL_PATH_LABELS[row.path],
    count: row.count,
  }));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Deal flow reports</h1>
          <p className="muted">Pipeline health by stage and thesis (Launch · Partner · Exit).</p>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Open</div>
          <div className="kpi-value">{stats.openCount}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Closed won</div>
          <div className="kpi-value">{stats.wonCount}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Lost</div>
          <div className="kpi-value">{stats.lostCount}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Passed</div>
          <div className="kpi-value">{stats.passedCount}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Win rate</div>
          <div className="kpi-value">{stats.conversionRate}%</div>
        </div>
      </div>

      <div className="charts-row">
        <div className="panel">
          <h2>Deals by stage</h2>
          <div className="chart-box" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ddd8cf" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={70}
                />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b4559" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel">
          <h2>By thesis / path</h2>
          <div className="chart-box" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pathChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ddd8cf" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#b2a384" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Recent activity</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Deal</th>
                <th>Thesis</th>
                <th>Stage</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentLeads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <Link to={`/sales/leads/${lead.id}`}>{lead.name}</Link>
                    <div className="muted small">{lead.company || '—'}</div>
                  </td>
                  <td>{DEAL_PATH_LABELS[lead.deal_path]}</td>
                  <td>
                    <span className="stage-pill">{STAGE_LABELS[lead.stage]}</span>
                  </td>
                  <td>{formatDateTime(lead.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stats.recentLeads.length === 0 ? <p className="muted">No deals yet.</p> : null}
      </div>
    </>
  );
}
