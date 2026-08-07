'use client';

import { useCallback, useMemo, useState } from 'react';
import { EntityBadge } from '@/components/entities/entity-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type CaseRow = {
  id: string;
  event?: string;
  case_type?: string;
  entity_id: string;
  status: string;
  device_path?: string | null;
  correlation_id?: string | null;
  it_offboard_gate?: string | null;
  created_at?: string;
  last_error?: string | null;
};

type ByodRow = {
  id: string;
  entity_id: string;
  employee_id: string;
  platform?: string | null;
  status: string;
  enrollment_type?: string;
  app_protection_status?: string;
};

type Props = {
  initial: {
    open_cases?: number;
    byod_wipe_blocks?: number;
    queued_jobs?: number;
    dead_letter?: number;
    cases?: CaseRow[];
    byod_registrations?: ByodRow[];
    contract_version?: string;
  };
  entities: Array<{ entity_id: string; label: string }>;
};

export function IdentityLifecycleClient({ initial, entities }: Props) {
  const [feed, setFeed] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [entityId, setEntityId] = useState(entities[0]?.entity_id ?? 'ENT-FIRM');
  const [ownership, setOwnership] = useState<'company_owned' | 'personal_byod'>(
    'company_owned',
  );
  const [firstName, setFirstName] = useState('Alex');
  const [lastName, setLastName] = useState('Pilot');
  const [email, setEmail] = useState('alex.pilot@example.com');

  const refresh = useCallback(async () => {
    const res = await fetch('/api/identity/lifecycle');
    const json = await res.json();
    if (json.ok) setFeed(json);
  }, []);

  const simulateHire = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const employeeId = crypto.randomUUID();
      const res = await fetch('/api/identity/hris/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'hris.employee.hired',
          entity_id: entityId,
          payload: {
            employee_id: employeeId,
            legal_first_name: firstName,
            legal_last_name: lastName,
            personal_email: email,
            work_email: '',
            start_date: new Date().toISOString().slice(0, 10),
            primary_role_id: 'R-AE',
            job_title: 'Associate',
            employment_type: 'FTE',
            device_ownership: ownership,
            device_preference:
              ownership === 'personal_byod' ? 'ios' : 'windows',
            entity_id: entityId,
            country: 'US',
            location: 'Remote',
          },
          process_now: true,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessage(json.error || 'Hire event failed');
      } else {
        const path =
          json.orchestrated?.results?.[0]?.device_path ?? ownership;
        setMessage(
          `Joiner queued · path ${path} · jobs ${json.drained?.succeeded ?? 0} ok`,
        );
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [email, entityId, firstName, lastName, ownership, refresh]);

  const drain = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/identity/workers/drain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json = await res.json();
      setMessage(
        json.ok
          ? `Drained ${json.drained?.claimed ?? 0} jobs (${json.drained?.succeeded ?? 0} ok)`
          : json.error || 'Drain failed',
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const cases = useMemo(() => feed.cases ?? [], [feed.cases]);
  const byod = useMemo(
    () => feed.byod_registrations ?? [],
    [feed.byod_registrations],
  );

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            'Open cases',
            feed.open_cases ??
              cases.filter((c) => c.status !== 'Complete').length,
          ],
          ['Queued jobs', feed.queued_jobs ?? 0],
          ['Dead letter', feed.dead_letter ?? 0],
          ['BYOD wipe blocks', feed.byod_wipe_blocks ?? 0],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-lg border border-border/60 bg-gradient-to-br from-background to-muted/30 px-4 py-3"
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {value}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-4 rounded-xl border border-border/70 bg-card/40 p-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Simulate HRIS hire
          </h2>
          <p className="text-sm text-muted-foreground">
            Emits <code className="text-xs">hris.employee.hired</code> — Technology
            never invents hire/term. Dual path from device ownership.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              Entity
            </span>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              {entities.map((e) => (
                <option key={e.entity_id} value={e.entity_id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              Device ownership
            </span>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={ownership}
              onChange={(e) =>
                setOwnership(e.target.value as 'company_owned' | 'personal_byod')
              }
            >
              <option value="company_owned">Company-owned (MDM)</option>
              <option value="personal_byod">Personal / BYOD (MAM)</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              Personal email
            </span>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              First name
            </span>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              Last name
            </span>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={simulateHire} disabled={busy}>
            Run joiner path
          </Button>
          <Button variant="outline" onClick={drain} disabled={busy}>
            Drain workers
          </Button>
          <Button variant="ghost" onClick={refresh} disabled={busy}>
            Refresh
          </Button>
        </div>
        {message ? (
          <p className="text-sm text-muted-foreground">{message}</p>
        ) : null}
        {ownership === 'personal_byod' ? (
          <p className="text-sm leading-relaxed text-amber-800 dark:text-amber-200/90">
            BYOD privacy: only company data in managed apps is protected. Full
            wipe is forbidden — offboard uses selective wipe / Retire only.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Company path reserves Autopilot/ADE hardware from SS§9 inventory.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Lifecycle cases</h2>
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Case</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Path</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Gate</th>
              </tr>
            </thead>
            <tbody>
              {cases.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    No identity lifecycle cases yet.
                  </td>
                </tr>
              ) : (
                cases.map((c) => (
                  <tr key={c.id} className="border-t border-border/50">
                    <td className="px-3 py-2 font-mono text-xs">{c.id}</td>
                    <td className="px-3 py-2">
                      <EntityBadge entity={c.entity_id} />
                    </td>
                    <td className="px-3 py-2">
                      {c.case_type || c.event || '—'}
                    </td>
                    <td className="px-3 py-2">{c.device_path || '—'}</td>
                    <td className="px-3 py-2">{c.status}</td>
                    <td className="px-3 py-2">{c.it_offboard_gate || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          BYOD registrations
        </h2>
        <p className="text-sm text-muted-foreground">
          Logical MAM rows — not corporate hardware assets.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Enrollment</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">APP</th>
              </tr>
            </thead>
            <tbody>
              {byod.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    No BYOD registrations.
                  </td>
                </tr>
              ) : (
                byod.map((b) => (
                  <tr key={b.id} className="border-t border-border/50">
                    <td className="px-3 py-2 font-mono text-xs">
                      {b.employee_id.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2">
                      <EntityBadge entity={b.entity_id} />
                    </td>
                    <td className="px-3 py-2">{b.enrollment_type}</td>
                    <td className="px-3 py-2">{b.status}</td>
                    <td className="px-3 py-2">{b.app_protection_status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
