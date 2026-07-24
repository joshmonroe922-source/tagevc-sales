'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CompanySelect } from '@/components/shared/company-select';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  HR_POLICY_SKELETON,
  HR_REQUEST_TEMPLATES,
  hrChecklistPacks,
  hrTicketHref,
  lifecycleKindLabel,
  type HrRosterPerson,
} from '@/lib/shared-services/hr-ops-phase62';

type LifecycleRunRow = {
  run_id: string;
  status: string;
  ticket_id?: string | null;
  entity_id?: string | null;
  created_at?: string | null;
};

type Props = {
  roster: HrRosterPerson[];
  rosterError?: string;
  onboardingRuns: LifecycleRunRow[];
  offboardingRuns: LifecycleRunRow[];
  onboardingCandidateCount: number;
  offboardingCandidateCount: number;
  entityId?: string | null;
};

export function HrOpsDepthClient({
  roster,
  rosterError,
  onboardingRuns,
  offboardingRuns,
  onboardingCandidateCount,
  offboardingCandidateCount,
  entityId = null,
}: Props) {
  const [companyFilter, setCompanyFilter] = useState('all');
  const packs = useMemo(() => hrChecklistPacks(entityId), [entityId]);

  const companies = useMemo(() => {
    const set = new Map<string, string>();
    for (const p of roster) {
      set.set(p.entity_id ?? 'ENT-FIRM', p.company_name);
    }
    return Array.from(set.entries());
  }, [roster]);

  const filtered = useMemo(() => {
    if (companyFilter === 'all') return roster;
    if (companyFilter === 'ENT-FIRM') {
      return roster.filter(
        (p) => !p.entity_id || p.entity_id === 'ENT-FIRM',
      );
    }
    return roster.filter((p) => p.entity_id === companyFilter);
  }, [roster, companyFilter]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            People roster
          </h2>
          <p className="text-sm text-muted-foreground">
            Portal users by company and role. Use this to spot assignment gaps
            before starting joiners or leavers.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            Company
            <CompanySelect
              value={companyFilter === 'all' ? '' : companyFilter}
              onChange={(v) => setCompanyFilter(v || 'all')}
              allowAll
              allLabel="All companies"
              options={companies.map(([id, name]) => ({
                value: id,
                label: name,
              }))}
              className="block min-w-[12rem]"
            />
          </label>
          <Badge variant="secondary">{filtered.length} people</Badge>
        </div>
        {rosterError ? (
          <p className="text-sm text-muted-foreground">
            Roster unavailable · {rosterError}
          </p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No people in view"
            description="No portal profiles match this company filter yet."
          />
        ) : (
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 40).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium">
                          {p.full_name ?? p.email}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p.email}
                        </div>
                      </TableCell>
                      <TableCell>{p.role_label}</TableCell>
                      <TableCell>{p.company_name}</TableCell>
                      <TableCell>
                        <Badge variant={p.active ? 'secondary' : 'outline'}>
                          {p.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Joiner · mover · leaver
          </h2>
          <p className="text-sm text-muted-foreground">
            Checklist packs and recent onboarding / offboarding runs. Access
            revoke stays human-gated — no silent account destruction.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Onboarding open"
            value={String(
              onboardingRuns.filter(
                (r) => r.status === 'open' || r.status === 'in_progress',
              ).length,
            )}
          />
          <Metric
            label="Offboarding open"
            value={String(
              offboardingRuns.filter(
                (r) => r.status === 'open' || r.status === 'in_progress',
              ).length,
            )}
          />
          <Metric
            label="Onboarding candidates"
            value={String(onboardingCandidateCount)}
          />
          <Metric
            label="Offboarding candidates"
            value={String(offboardingCandidateCount)}
          />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {packs.map((pack) => (
            <Card key={pack.pack_id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {lifecycleKindLabel(pack.lifecycle)}
                  </Badge>
                  <Badge variant="secondary">{pack.audience}</Badge>
                </div>
                <CardTitle className="text-base">{pack.label}</CardTitle>
                <CardDescription>
                  {pack.steps.length} steps · modular for future fractional HR
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
                  {pack.steps.slice(0, 6).map((s) => (
                    <li key={s.id}>{s.label}</li>
                  ))}
                  {pack.steps.length > 6 ? (
                    <li>+{pack.steps.length - 6} more</li>
                  ) : null}
                </ol>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <RunList title="Recent onboarding runs" runs={onboardingRuns} />
          <RunList title="Recent offboarding runs" runs={offboardingRuns} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            Policies & compliance
          </h2>
          <p className="text-sm text-muted-foreground">
            Skeleton only — full policy packs come later. Ready for Signent /
            fractional HR reuse.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {HR_POLICY_SKELETON.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <Badge variant="outline" className="w-fit">
                  {p.status}
                </Badge>
                <CardTitle className="text-base">{p.title}</CardTitle>
                <CardDescription>{p.summary}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
            HR requests
          </h2>
          <p className="text-sm text-muted-foreground">
            Open a service ticket with company context — no autonomous account
            changes from these links.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {HR_REQUEST_TEMPLATES.map((t) => (
            <Link
              key={t.template_id}
              href={hrTicketHref(t.template_id, entityId)}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
            >
              {t.title}
            </Link>
          ))}
          <Link
            href="/shared-services?service=HR#inbox"
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground"
          >
            Open HR inbox →
          </Link>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-heading text-2xl tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function RunList({
  title,
  runs,
}: {
  title: string;
  runs: LifecycleRunRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>Recent evidence from IT / lifecycle runs.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {runs.length === 0 ? (
          <p className="text-muted-foreground">No runs yet.</p>
        ) : (
          runs.slice(0, 6).map((r) => (
            <div
              key={r.run_id}
              className="rounded-md border border-border px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{r.status}</Badge>
                <span className="font-medium">{r.run_id.slice(0, 8)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {r.ticket_id ? 'Linked ticket' : 'No ticket'}
                {r.created_at
                  ? ` · ${new Date(r.created_at).toLocaleDateString()}`
                  : ''}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
