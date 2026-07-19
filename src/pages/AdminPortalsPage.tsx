import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchAllEntitiesForAdmin,
  fetchEntityAssignmentsForUser,
  setUserEntityAssignment,
} from '../lib/entityAssignmentApi';
import {
  fetchAllPortals,
  fetchAssignmentsForUser,
  fetchSalesUsersForAdmin,
  setUserPortalAssignment,
} from '../lib/portalApi';
import type { OpsEntity } from '../lib/opsTypes';
import { OPS_ENTITY_STATUS_LABELS, OPS_ENTITY_TYPE_LABELS } from '../lib/opsTypes';
import type { SalesPortal, SalesUser } from '../lib/types';

type Props = {
  salesUser: SalesUser;
};

type UserRow = Pick<
  SalesUser,
  'id' | 'email' | 'full_name' | 'role' | 'active' | 'is_house_account'
>;

type EntityRow = Pick<
  OpsEntity,
  'id' | 'name' | 'slug' | 'entity_type' | 'status' | 'website_url'
>;

function entityCardDesc(ent: EntityRow): string {
  const parts = [
    OPS_ENTITY_TYPE_LABELS[ent.entity_type],
    OPS_ENTITY_STATUS_LABELS[ent.status],
  ];
  if (ent.slug) parts.push('Portfolio');
  return parts.join(' · ');
}

export function AdminPortalsPage({ salesUser }: Props) {
  const [portals, setPortals] = useState<SalesPortal[]>([]);
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [assignedPortalIds, setAssignedPortalIds] = useState<Set<string>>(new Set());
  const [assignedEntityIds, setAssignedEntityIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [savingPortal, setSavingPortal] = useState<string | null>(null);
  const [savingEntity, setSavingEntity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [portalRows, userRows, entityRows] = await Promise.all([
          fetchAllPortals(),
          fetchSalesUsersForAdmin(),
          fetchAllEntitiesForAdmin(),
        ]);
        if (!mounted) return;
        const people = userRows.filter((u) => !u.is_house_account);
        setPortals(portalRows);
        setEntities(entityRows);
        setUsers(people);
        setSelectedUserId((prev) => prev || people[0]?.id || '');
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load admin data');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const loadAssignments = useCallback(async (userId: string) => {
    if (!userId) {
      setAssignedPortalIds(new Set());
      setAssignedEntityIds(new Set());
      return;
    }
    setError(null);
    try {
      const [portalIds, entityIds] = await Promise.all([
        fetchAssignmentsForUser(userId),
        fetchEntityAssignmentsForUser(userId),
      ]);
      setAssignedPortalIds(new Set(portalIds));
      setAssignedEntityIds(new Set(entityIds));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assignments');
    }
  }, []);

  useEffect(() => {
    void loadAssignments(selectedUserId);
  }, [selectedUserId, loadAssignments]);

  async function togglePortal(portalId: string, next: boolean) {
    if (!selectedUserId) return;
    setSavingPortal(portalId);
    setNotice(null);
    setError(null);
    try {
      await setUserPortalAssignment(selectedUserId, portalId, next, salesUser.id);
      setAssignedPortalIds((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(portalId);
        else copy.delete(portalId);
        return copy;
      });
      setNotice('Portal assignment updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update portal assignment');
    } finally {
      setSavingPortal(null);
    }
  }

  async function toggleEntity(entityId: string, next: boolean) {
    if (!selectedUserId) return;
    setSavingEntity(entityId);
    setNotice(null);
    setError(null);
    try {
      await setUserEntityAssignment(selectedUserId, entityId, next, salesUser.id);
      setAssignedEntityIds((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(entityId);
        else copy.delete(entityId);
        return copy;
      });
      setNotice('Portfolio company assignment updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update entity assignment');
    } finally {
      setSavingEntity(null);
    }
  }

  if (salesUser.role !== 'admin') {
    return (
      <div className="empty">
        <p>Admin only.</p>
        <Link to="/sales" className="btn ghost">
          Back to portals
        </Link>
      </div>
    );
  }

  const selectedUser = users.find((u) => u.id === selectedUserId);
  const selectedIsAdmin = selectedUser?.role === 'admin';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Access assignments</h1>
          <p className="muted">
            Grant portals and portfolio companies for allowlisted users.
          </p>
          <p className="muted admin-note">
            Admins always have access to every portal and every entity in the app, even
            if assignment rows are incomplete. Use this page for reps and managers.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/admin/email" className="btn ghost">
            Email Analytics
          </Link>
          <Link to="/sales/admin/audit" className="btn ghost">
            Audit log
          </Link>
          <Link to="/sales" className="btn ghost">
            All portals
          </Link>
        </div>
      </div>

      {loading ? <p className="muted">Loading…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      {!loading && users.length > 0 ? (
        <div className="admin-portals">
          <label className="field">
            <span>User</span>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.full_name || u.email) + ` (${u.role})`}
                </option>
              ))}
            </select>
          </label>

          {selectedIsAdmin ? (
            <p className="muted admin-note">
              This user is an admin — they already see all portals and companies. Checkboxes
              still update assignment rows for consistency.
            </p>
          ) : null}

          <section className="admin-assign-section">
            <h2>Portals</h2>
            <ul className="admin-portal-list">
              {portals.map((portal) => {
                const checked = assignedPortalIds.has(portal.id);
                return (
                  <li key={portal.id}>
                    <label className="admin-portal-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={savingPortal === portal.id}
                        onChange={(e) => void togglePortal(portal.id, e.target.checked)}
                      />
                      <span>
                        <strong>{portal.name}</strong>
                        <span className="muted"> — {portal.description}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="admin-assign-section">
            <h2>Portfolio companies</h2>
            <p className="muted small">
              Controls which entities appear under Manage Portfolio (and deep links into
              Entity Ops). Users also need the Manage Portfolio portal.
            </p>
            {entities.length === 0 ? (
              <p className="muted">No entities yet.</p>
            ) : (
              <div className="portal-grid admin-entity-grid">
                {entities.map((ent) => {
                  const checked = assignedEntityIds.has(ent.id);
                  const busy = savingEntity === ent.id;
                  return (
                    <button
                      key={ent.id}
                      type="button"
                      className={`portal-card admin-entity-card${checked ? ' selected' : ''}`}
                      disabled={busy}
                      aria-pressed={checked}
                      onClick={() => void toggleEntity(ent.id, !checked)}
                    >
                      <div className="portal-card-top">
                        <span className="portal-card-name">{ent.name}</span>
                        {ent.slug ? (
                          <span className="portal-card-badge">Portfolio</span>
                        ) : null}
                      </div>
                      <p className="portal-card-desc">{entityCardDesc(ent)}</p>
                      <span className="portal-card-cta">
                        {checked ? 'Assigned ✓' : 'Click to assign'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
