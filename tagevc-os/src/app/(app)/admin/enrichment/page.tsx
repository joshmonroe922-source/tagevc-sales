import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/rbac/session';
import { getEnrichmentProviderHealth } from '@/lib/spine/enrichment/providers';
import { enrichmentKillSwitchEnabled } from '@/lib/spine/enrichment/waterfall';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { EnsureMembershipsButton } from '@/components/admin/ensure-memberships-button';
import Link from 'next/link';

export default async function EnrichmentAdminPage() {
  await requirePermission('admin:users');

  const health = getEnrichmentProviderHealth();
  const kill = enrichmentKillSwitchEnabled();

  let orgs: Array<{
    slug: string;
    name: string;
    monthly_enrichment_budget_usd: number;
    auto_expand_cap: number;
  }> = [];
  let monthSpend = 0;
  let queued = 0;

  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('organizations')
      .select('slug, name, monthly_enrichment_budget_usd, auto_expand_cap')
      .order('slug');
    orgs = data ?? [];
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { data: ledger } = await sb
      .from('credit_ledger')
      .select('usd_estimate')
      .gte('at', monthStart.toISOString());
    monthSpend = (ledger ?? []).reduce(
      (s, r) => s + Number(r.usd_estimate || 0),
      0,
    );
    const { count } = await sb
      .from('enrichment_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'queued');
    queued = count ?? 0;
  } catch {
    /* phase94 may be missing in some envs */
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Enrichment control"
        description="C12 budgets · kill switch · LIVE provider flags. Fail-closed until keys + *_LIVE=1."
      />

      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-md border border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">Kill switch</div>
          <div className="font-semibold">
            {kill ? 'ON (all paid calls blocked)' : 'Off'}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Env <code>ENRICHMENT_KILL_SWITCH</code>
          </div>
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">Month spend (ledger)</div>
          <div className="font-semibold">${monthSpend.toFixed(2)}</div>
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">Queued jobs</div>
          <div className="font-semibold">{queued}</div>
        </div>
      </div>

      <section className="rounded-md border border-border">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
          Providers (flip LIVE when contracts + keys land)
        </h2>
        <ul className="divide-y divide-border text-sm">
          {health.map((h) => (
            <li
              key={h.provider}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div>
                <div className="font-medium uppercase">{h.provider}</div>
                <div className="text-xs text-muted-foreground">{h.note}</div>
              </div>
              <span
                className={
                  h.ready
                    ? 'text-xs font-medium text-emerald-700'
                    : 'text-xs font-medium text-amber-700'
                }
              >
                {h.ready
                  ? 'READY'
                  : !h.configured
                    ? 'NO KEY'
                    : !h.liveEnabled
                      ? 'LIVE=0'
                      : 'BLOCKED'}
              </span>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <p>
            To go live: set <code>APOLLO_API_KEY</code> / <code>PDL_API_KEY</code>{' '}
            / <code>HUNTER_API_KEY</code> / <code>ZEROBOUNCE_API_KEY</code> on
            Vercel + worker, then <code>*_LIVE=1</code>. Keep kill switch off.
          </p>
          <p>
            See <code>docs/ENRICHMENT_LIVE_FLIP.md</code>.
          </p>
        </div>
      </section>

      <section className="rounded-md border border-border">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
          Org budgets
        </h2>
        <ul className="divide-y divide-border text-sm">
          {orgs.length === 0 ? (
            <li className="px-4 py-6 text-muted-foreground">
              No organizations — apply phase94.
            </li>
          ) : (
            orgs.map((o) => (
              <li
                key={o.slug}
                className="flex justify-between gap-2 px-4 py-3"
              >
                <span className="font-medium">
                  {o.name}{' '}
                  <span className="text-xs text-muted-foreground">
                    ({o.slug})
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  ${Number(o.monthly_enrichment_budget_usd).toFixed(0)}/mo · cap{' '}
                  {o.auto_expand_cap}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="rounded-md border border-border p-4 space-y-3 text-sm">
        <h2 className="font-semibold">Spine JWT memberships (C2)</h2>
        <p className="text-xs text-muted-foreground">
          After phase95 Auth Hook is enabled, ensure Josh has memberships on all
          four orgs so <code>org_ids[]</code> populates.
        </p>
        <EnsureMembershipsButton />
        <Link
          href="/shared-services/crm"
          className="block text-xs underline underline-offset-2"
        >
          Open CRM graph →
        </Link>
      </section>
    </div>
  );
}
