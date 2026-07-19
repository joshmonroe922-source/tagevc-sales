import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  createEmployee,
  formatDate,
  listEmployees,
  listHrEntities,
} from '../lib/hrApi';
import {
  HR_EMPLOYMENT_STATUSES,
  HR_EMPLOYMENT_STATUS_LABELS,
  type HrEmployee,
  type HrEmploymentStatus,
} from '../lib/hrTypes';
import type { OpsEntity } from '../lib/opsTypes';
import type { SalesUser } from '../lib/types';
import { PortalTasksPanel } from '../components/PortalTasksPanel';

type Props = { salesUser: SalesUser };

const QUICK_FILTERS: Array<HrEmploymentStatus | 'all'> = [
  'all',
  'prospect',
  'onboarding',
  'active',
];

export function HrEmployeesPage({ salesUser }: Props) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<HrEmployee[]>([]);
  const [entities, setEntities] = useState<OpsEntity[]>([]);
  const [statusFilter, setStatusFilter] = useState<HrEmploymentStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const [fullName, setFullName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [entityId, setEntityId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [employmentStatus, setEmploymentStatus] =
    useState<HrEmploymentStatus>('prospect');

  const refresh = useCallback(async () => {
    setRows(await listEmployees({ status: statusFilter, q }));
  }, [statusFilter, q]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const ents = await listHrEntities();
        if (mounted) setEntities([...ents].sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        /* entity picker optional if ops tables gated */
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await refresh();
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load employees (run migration 0035 if tables are missing)',
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refresh]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    setError(null);
    try {
      const emp = await createEmployee({
        full_name: fullName,
        work_email: workEmail,
        personal_email: personalEmail,
        role_title: roleTitle,
        department,
        entity_id: entityId || null,
        start_date: startDate || null,
        employment_status: employmentStatus,
        created_by: salesUser.id,
      });
      navigate(`/sales/hr/employees/${emp.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Employees</h1>
          <p className="muted">
            Track prospects through talent acquisition, then onboarding, then the active
            employee file. Company audit controls stay under Compliance.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setShowNew((v) => !v)}>
            {showNew ? 'Cancel' : 'Add prospect / employee'}
          </button>
          <Link to="/sales" className="btn ghost">
            All portals
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="toolbar hr-toolbar">
        <input
          className="input"
          placeholder="Search name, email, title…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as HrEmploymentStatus | 'all')}
        >
          <option value="all">All statuses</option>
          {HR_EMPLOYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {HR_EMPLOYMENT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="hr-quick-filters" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {QUICK_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={statusFilter === f ? 'btn' : 'btn ghost'}
            onClick={() => setStatusFilter(f)}
          >
            {f === 'all' ? 'All' : HR_EMPLOYMENT_STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      {showNew ? (
        <section className="panel">
          <h3 className="subhead">New person</h3>
          <p className="muted small">
            Defaults to <strong>Prospect</strong> and starts a talent acquisition checklist.
            Choose Onboarding / Active only when skipping recruiting.
          </p>
          <form className="form-grid" onSubmit={(e) => void onCreate(e)}>
            <label>
              Full name
              <input
                className="input"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </label>
            <label>
              Status
              <select
                className="input"
                value={employmentStatus}
                onChange={(e) =>
                  setEmploymentStatus(e.target.value as HrEmploymentStatus)
                }
              >
                {HR_EMPLOYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {HR_EMPLOYMENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Work email
              <input
                className="input"
                type="email"
                value={workEmail}
                onChange={(e) => setWorkEmail(e.target.value)}
              />
            </label>
            <label>
              Personal email
              <input
                className="input"
                type="email"
                value={personalEmail}
                onChange={(e) => setPersonalEmail(e.target.value)}
              />
            </label>
            <label>
              Role / title
              <input
                className="input"
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
              />
            </label>
            <label>
              Department
              <input
                className="input"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </label>
            <label>
              Company
              <select
                className="input"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
              >
                <option value="">Tage parent / shared</option>
                {entities.map((ent) => (
                  <option key={ent.id} value={ent.id}>
                    {ent.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start date (optional)
              <input
                className="input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn">
                Create
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && rows.length === 0 ? (
        <p className="muted">
          No people yet. Add a prospect to open a file and start talent acquisition.
        </p>
      ) : null}

      {!loading && rows.length > 0 ? (
        <section className="panel">
          <ul className="hr-list">
            {rows.map((row) => (
              <li key={row.id}>
                <div>
                  <Link className="hr-list-title" to={`/sales/hr/employees/${row.id}`}>
                    {row.full_name}
                  </Link>
                  <div className="muted small">
                    {row.role_title || 'No title'}
                    {row.department ? ` · ${row.department}` : ''}
                    {' · '}
                    {row.ops_entities?.name ?? 'Tage parent'}
                    {row.work_email ? ` · ${row.work_email}` : ''}
                    {row.start_date ? ` · starts ${formatDate(row.start_date)}` : ''}
                  </div>
                </div>
                <Link
                  to={`/sales/hr/employees/${row.id}`}
                  className="hr-status-pill"
                >
                  {HR_EMPLOYMENT_STATUS_LABELS[row.employment_status]}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PortalTasksPanel portalSlug="human-resources" />
    </>
  );
}
