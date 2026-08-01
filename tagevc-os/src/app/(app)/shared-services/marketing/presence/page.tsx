import Link from 'next/link';
import { SscFunctionHomeChromeServer } from '@/components/shared-services/ssc-function-home-chrome-server';
import { dryRunPresenceImportAction } from '@/app/(app)/shared-services/marketing/presence/actions';
import { marketingPresencePartners } from '@/lib/partners/catalog';
import { missingEnvForPartner, resolvePartnerStatus } from '@/lib/partners/registry';
import { listMarketingPresence, listPartnerBindings } from '@/lib/partners/repo';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { roleHasPermission } from '@/lib/types/roles';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

const KIND_LABEL: Record<string, string> = {
  google_business: 'Google Business Profile',
  google_analytics: 'Google Analytics (GA4)',
  linkedin_company: 'LinkedIn Company Page',
};

export default async function MarketingPresencePage() {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;
  const entityId = firmWide ? null : (ctx?.profile.entity_id ?? null);
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:marketing')
    : false;

  const [properties, bindings] = await Promise.all([
    listMarketingPresence(entityId),
    listPartnerBindings(entityId),
  ]);
  const partners = marketingPresencePartners();

  const entityOptions = Array.from(
    new Set(properties.map((p) => p.entity_id)),
  ).sort();
  const defaultEntity =
    entityId ?? entityOptions[0] ?? ctx?.profile.entity_id ?? 'ENT-FIRM';

  async function runPresenceDryRun(formData: FormData) {
    'use server';
    await dryRunPresenceImportAction(formData);
  }

  return (
    <div className="space-y-6">
      <SscFunctionHomeChromeServer
        functionKey="marketing"
        entityId={entityId}
        firmWide={firmWide}
      />

      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Marketing presence
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Google Business Pages, Google Analytics (GA4), and LinkedIn Company
          Pages for every entity — central ops under Marketing Shared Services.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/shared-services/marketing"
          className="underline underline-offset-2"
        >
          ← Marketing home
        </Link>
        <Link href="/shared-services/bi" className="underline underline-offset-2">
          Partner BI
        </Link>
        <Link
          href="/shared-services/it/technology-stack"
          className="underline underline-offset-2"
        >
          Technology stack
        </Link>
      </div>

      {canWrite ? (
        <section className="rounded-lg border border-border p-4">
          <h2 className="text-base font-semibold">Import dry-run</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Runs fail-closed stubs for GBP · GA4 · LinkedIn and writes BI
            signal rows. No remote calls until LIVE flags are on.
          </p>
          <form action={runPresenceDryRun} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">
                Entity
              </span>
              <select
                name="entity_id"
                defaultValue={defaultEntity}
                className="rounded-md border border-border bg-background px-2 py-1.5"
              >
                {(entityOptions.length ? entityOptions : [defaultEntity]).map(
                  (id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ),
                )}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              Run presence import dry-run
            </button>
          </form>
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-3">
        {partners.map((def) => {
          const binding = bindings.find((b) => b.partner_key === def.key);
          const status = resolvePartnerStatus(def, binding?.status);
          const missing = missingEnvForPartner(def.key).filter(
            (k) => !k.endsWith('_LIVE'),
          );
          return (
            <div key={def.key} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{def.label}</h2>
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                  {status}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{def.summary}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                Env:{' '}
                {missing.length === 0
                  ? 'configured'
                  : `needs ${missing.slice(0, 3).join(', ')}`}
              </p>
            </div>
          );
        })}
      </section>

      <section>
        <h2 className="text-base font-semibold">Per-entity properties</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Slots auto-created when an entity inherits the partner spine. Attach
          external IDs when Josh connects each account — no fake credentials.
        </p>

        {properties.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No presence rows yet. Apply{' '}
            <code>supabase/phase89_partner_spine.sql</code> then reopen.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th className="px-3 py-2 font-medium">Entity</th>
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">External ID</th>
                  <th className="px-3 py-2 font-medium">Last import</th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => (
                  <tr key={p.id} className="border-b border-border/70">
                    <td className="px-3 py-2 font-medium">{p.entity_id}</td>
                    <td className="px-3 py-2">
                      {KIND_LABEL[p.kind] ?? p.kind}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                        {p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {p.external_id ?? '— attach when connected'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {p.last_import_at ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
