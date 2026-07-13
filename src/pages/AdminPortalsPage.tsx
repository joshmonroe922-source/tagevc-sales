import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchAllPortals,
  fetchAssignmentsForUser,
  fetchSalesUsersForAdmin,
  setUserPortalAssignment,
} from '../lib/portalApi';
import type { SalesPortal, SalesUser } from '../lib/types';

type Props = {
  salesUser: SalesUser;
};

type UserRow = Pick<
  SalesUser,
  'id' | 'email' | 'full_name' | 'role' | 'active' | 'is_house_account'
>;

export function AdminPortalsPage({ salesUser }: Props) {
  const [portals, setPortals] = useState<SalesPortal[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [portalRows, userRows] = await Promise.all([
          fetchAllPortals(),
          fetchSalesUsersForAdmin(),
        ]);
        if (!mounted) return;
        const people = userRows.filter((u) => !u.is_house_account);
        setPortals(portalRows);
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
      setAssignedIds(new Set());
      return;
    }
    setError(null);
    try {
      const ids = await fetchAssignmentsForUser(userId);
      setAssignedIds(new Set(ids));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assignments');
    }
  }, []);

  useEffect(() => {
    void loadAssignments(selectedUserId);
  }, [selectedUserId, loadAssignments]);

  async function togglePortal(portalId: string, next: boolean) {
    if (!selectedUserId) return;
    setSaving(portalId);
    setNotice(null);
    setError(null);
    try {
      await setUserPortalAssignment(selectedUserId, portalId, next, salesUser.id);
      setAssignedIds((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(portalId);
        else copy.delete(portalId);
        return copy;
      });
      setNotice('Assignment updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update assignment');
    } finally {
      setSaving(null);
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

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Portal assignments</h1>
          <p className="muted">Grant or revoke portal access for allowlisted users.</p>
          <p className="muted admin-note">
            Admins always have access to every portal in the app, even if assignment rows
            are incomplete. Use this page for reps and managers.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/admin/email" className="btn ghost">
            Email analytics
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

          <ul className="admin-portal-list">
            {portals.map((portal) => {
              const checked = assignedIds.has(portal.id);
              return (
                <li key={portal.id}>
                  <label className="admin-portal-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saving === portal.id}
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
        </div>
      ) : null}
    </>
  );
}
