import { useEffect, useMemo, useState } from 'react';
import {
  buildHierarchyRollups,
  listRecruitingKpiFacts,
  listRecruitingLocations,
  listRecruitingOrgMembers,
  listRecruitingRegions,
  upsertRecruitingLocation,
  upsertRecruitingOrgMember,
  upsertRecruitingRegion,
  type HierarchyLevel,
  type HierarchyMetricRow,
  RECRUITING_KPI_PACK,
} from '../lib/recruitingKpiApi';
import { talentDeskUrl } from '../lib/recruit619';
import { openTalentDeskWithSso } from '../lib/talentDeskSso';
import type { SalesUser } from '../lib/types';

type Props = {
  entityId: string;
  periodKey: string;
  salesUser: SalesUser;
};

const LEVELS: { id: HierarchyLevel; label: string }[] = [
  { id: 'recruiter', label: 'Recruiter' },
  { id: 'manager', label: 'Manager' },
  { id: 'location', label: 'Location' },
  { id: 'region', label: 'Region' },
  { id: 'coo', label: 'COO' },
];

function formatMetric(
  key: keyof HierarchyMetricRow,
  row: HierarchyMetricRow,
): string {
  const v = row[key];
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '—';
  if (
    key === 'revenue' ||
    key === 'commissions_earned' ||
    key === 'commissions_paid'
  ) {
    return `$${Math.round(Number(v)).toLocaleString()}`;
  }
  if (key === 'send_outs_per_placement') return `${v}:1`;
  if (key === 'time_to_fill_days') return `${v}d`;
  return String(v);
}

export function Recruit619KpiHierarchyPanel({
  entityId,
  periodKey,
  salesUser,
}: Props) {
  const [level, setLevel] = useState<HierarchyLevel>('coo');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<HierarchyMetricRow[]>([]);
  const [headline, setHeadline] = useState<HierarchyMetricRow | null>(null);
  const [regionName, setRegionName] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [locationRegionId, setLocationRegionId] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberRole, setMemberRole] = useState('recruiter');
  const [memberLocationId, setMemberLocationId] = useState('');
  const [memberManagerId, setMemberManagerId] = useState('');
  const [regions, setRegions] = useState<
    Awaited<ReturnType<typeof listRecruitingRegions>>
  >([]);
  const [locations, setLocations] = useState<
    Awaited<ReturnType<typeof listRecruitingLocations>>
  >([]);
  const [members, setMembers] = useState<
    Awaited<ReturnType<typeof listRecruitingOrgMembers>>
  >([]);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [regs, locs, mems, facts] = await Promise.all([
        listRecruitingRegions(entityId),
        listRecruitingLocations(entityId),
        listRecruitingOrgMembers(entityId),
        listRecruitingKpiFacts(entityId, periodKey),
      ]);
      setRegions(regs);
      setLocations(locs);
      setMembers(mems);
      if (!locationRegionId && regs[0]) setLocationRegionId(regs[0].id);
      if (!memberLocationId && locs[0]) setMemberLocationId(locs[0].id);
      const rollups = buildHierarchyRollups({
        facts,
        members: mems,
        locations: locs,
        regions: regs,
      });
      setHeadline(rollups.coo);
      const byLevel: Record<HierarchyLevel, HierarchyMetricRow[]> = {
        recruiter: rollups.recruiters,
        manager: rollups.managers,
        location: rollups.locations,
        region: rollups.regions,
        coo: [rollups.coo],
      };
      setRows(byLevel[level]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load recruiting KPI hierarchy',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, periodKey, level]);

  const managers = useMemo(
    () => members.filter((m) => m.role === 'manager' || m.role === 'coo'),
    [members],
  );

  async function onAddRegion() {
    if (!regionName.trim() || !regionCode.trim()) return;
    try {
      await upsertRecruitingRegion({
        entity_id: entityId,
        name: regionName,
        code: regionCode,
      });
      setRegionName('');
      setRegionCode('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add region failed');
    }
  }

  async function onAddLocation() {
    if (!locationName.trim() || !locationCode.trim() || !locationRegionId)
      return;
    try {
      await upsertRecruitingLocation({
        entity_id: entityId,
        region_id: locationRegionId,
        name: locationName,
        code: locationCode,
      });
      setLocationName('');
      setLocationCode('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add location failed');
    }
  }

  async function onAddMember() {
    if (!memberEmail.trim()) return;
    try {
      await upsertRecruitingOrgMember({
        entity_id: entityId,
        email: memberEmail,
        display_name: memberName || memberEmail,
        role: memberRole,
        location_id: memberLocationId || null,
        manager_member_id: memberManagerId || null,
        sales_user_id: salesUser.id,
      });
      setMemberEmail('');
      setMemberName('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add member failed');
    }
  }

  return (
    <section className="panel recruit619-section" style={{ marginTop: '1.5rem' }}>
      <div className="panel-head">
        <h2>Recruiter KPI hierarchy</h2>
        <span className="muted small">
          Recruiter → Manager → Location → Region → COO
        </span>
      </div>
      <p className="muted">
        Monthly facts roll up the reporting hierarchy. Revenue and commissions
        earned use <strong>placement date</strong>; commissions paid use{' '}
        <strong>commission paid date</strong> (typically the following month).
        Live computation runs in TalentDesk; this portal stores org dimensions
        and optional fact rows for COO visibility.
      </p>

      <div className="recruit619-actions" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => void openTalentDeskWithSso('/hierarchy')}
        >
          Open TalentDesk hierarchy
        </button>
        <a className="btn" href={talentDeskUrl('performance')} target="_blank" rel="noreferrer">
          Performance
        </a>
        <a className="btn" href={talentDeskUrl('team')} target="_blank" rel="noreferrer">
          My Team
        </a>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="recruit619-actions" style={{ marginBottom: '1rem' }}>
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`btn${level === l.id ? ' primary' : ''}`}
            onClick={() => setLevel(l.id)}
          >
            {l.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="muted">Loading hierarchy…</p>
      ) : (
        <>
          {headline ? (
            <div className="table-wrap" style={{ marginBottom: '1rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company ({periodKey})</th>
                    <th>Send outs</th>
                    <th>Placements</th>
                    <th>Revenue</th>
                    <th>Comm. earned</th>
                    <th>Comm. paid</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <strong>{headline.name}</strong>
                      <div className="muted small">
                        {headline.recruiterCount} recruiters with facts
                      </div>
                    </td>
                    <td>{formatMetric('send_outs', headline)}</td>
                    <td>{formatMetric('placements', headline)}</td>
                    <td>{formatMetric('revenue', headline)}</td>
                    <td>{formatMetric('commissions_earned', headline)}</td>
                    <td>{formatMetric('commissions_paid', headline)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Recruiters</th>
                  <th>Send outs</th>
                  <th>Interviews</th>
                  <th>Applies</th>
                  <th>Placements</th>
                  <th>Ratio</th>
                  <th>Revenue</th>
                  <th>Earned</th>
                  <th>Paid</th>
                  <th>TTF</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="muted">
                      No {level} rows yet. Seed regions/locations/members below,
                      then enter monthly facts (or sync from TalentDesk later).
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={`${r.level}-${r.id}`}>
                      <td>
                        <strong>{r.name}</strong>
                      </td>
                      <td>{r.recruiterCount}</td>
                      <td>{formatMetric('send_outs', r)}</td>
                      <td>{formatMetric('interviews', r)}</td>
                      <td>{formatMetric('job_board_applies', r)}</td>
                      <td>{formatMetric('placements', r)}</td>
                      <td>{formatMetric('send_outs_per_placement', r)}</td>
                      <td>{formatMetric('revenue', r)}</td>
                      <td>{formatMetric('commissions_earned', r)}</td>
                      <td>{formatMetric('commissions_paid', r)}</td>
                      <td>{formatMetric('time_to_fill_days', r)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <details style={{ marginTop: '1.25rem' }}>
        <summary>Seed org dimensions (sandbox)</summary>
        <div className="stack-form" style={{ marginTop: '0.75rem', gap: '0.75rem' }}>
          <div className="recruit619-actions">
            <input
              placeholder="Region name"
              value={regionName}
              onChange={(e) => setRegionName(e.target.value)}
            />
            <input
              placeholder="Code (WEST)"
              value={regionCode}
              onChange={(e) => setRegionCode(e.target.value)}
              style={{ maxWidth: 120 }}
            />
            <button type="button" className="btn" onClick={() => void onAddRegion()}>
              Add region
            </button>
          </div>
          <div className="recruit619-actions">
            <select
              value={locationRegionId}
              onChange={(e) => setLocationRegionId(e.target.value)}
            >
              <option value="">Region…</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <input
              placeholder="Location name"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
            />
            <input
              placeholder="Code (SD)"
              value={locationCode}
              onChange={(e) => setLocationCode(e.target.value)}
              style={{ maxWidth: 120 }}
            />
            <button
              type="button"
              className="btn"
              onClick={() => void onAddLocation()}
            >
              Add location
            </button>
          </div>
          <div className="recruit619-actions">
            <input
              placeholder="Member email"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
            />
            <input
              placeholder="Display name"
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
            />
            <select
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value)}
            >
              <option value="recruiter">recruiter</option>
              <option value="manager">manager</option>
              <option value="coo">coo</option>
            </select>
            <select
              value={memberLocationId}
              onChange={(e) => setMemberLocationId(e.target.value)}
            >
              <option value="">Location…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <select
              value={memberManagerId}
              onChange={(e) => setMemberManagerId(e.target.value)}
            >
              <option value="">Manager…</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name || m.email}
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={() => void onAddMember()}>
              Add member
            </button>
          </div>
        </div>
      </details>

      <details style={{ marginTop: '1rem' }}>
        <summary>KPI pack ({RECRUITING_KPI_PACK.length})</summary>
        <ul className="muted" style={{ marginTop: '0.5rem' }}>
          {RECRUITING_KPI_PACK.map((k) => (
            <li key={k.key}>
              <strong>{k.label}</strong> — {k.unit} · {k.dateBasis}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
