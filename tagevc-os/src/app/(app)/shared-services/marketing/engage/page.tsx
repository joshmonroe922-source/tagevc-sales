import Link from 'next/link';

import { SscFunctionHomeChromeServer } from '@/components/shared-services/ssc-function-home-chrome-server';
import { entityLabel } from '@/lib/entities/display-name';
import { CONSOLIDATED_SELECT_VALUE } from '@/lib/entities/display-order';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';
import {
  listEngageEntityFilterOptions,
  loadEngageAnalytics,
  resolveEngageEntityScope,
} from '@/lib/shared-services/engage-analytics';

export default async function EngageAnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('read:marketing');
  const ctx = await getSessionContext();
  const firmWide = ctx
    ? isFirmWideAccess(ctx.profile.role, ctx.profile.entity_id)
    : false;

  const sp = (await searchParams) ?? {};
  const entityParam = typeof sp.entity === 'string' ? sp.entity : '';
  const scope = resolveEngageEntityScope(entityParam, {
    firmWide,
    profileEntityId: ctx?.profile.entity_id ?? null,
  });
  const bundle = await loadEngageAnalytics(scope);
  const entityOptions = listEngageEntityFilterOptions();

  return (
    <div className="space-y-6">
      <SscFunctionHomeChromeServer
        functionKey="marketing"
        entityId={scope.entityId}
        firmWide={firmWide}
      />

      <div>
        <p className="text-xs font-semibold tracking-[0.16em] text-[#7c7871] uppercase">
          Shared Services · Marketing
        </p>
        <h1 className="font-heading mt-1 text-3xl font-semibold tracking-tight text-[#3a414f]">
          Engage analytics
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[#5c6570]">
          Calls, SMS, and email campaign activity across the firm — or filter to
          one company. Empty chips mean Dialpad or Email Campaign Center is not
          LIVE yet; we do not invent numbers.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/shared-services/marketing"
          className="underline underline-offset-2"
        >
          ← Marketing home
        </Link>
        <Link
          href="/shared-services/marketing/email-campaign-center"
          className="underline underline-offset-2"
        >
          Email Campaign Center
        </Link>
        <Link
          href="/shared-services/marketing/presence"
          className="underline underline-offset-2"
        >
          Presence
        </Link>
      </div>

      {firmWide ? (
        <form className="flex flex-wrap items-end gap-3 rounded-xl border border-[#d7d3c3] bg-white px-4 py-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[#7c7871]">Company</span>
            <select
              name="entity"
              defaultValue={entityParam || CONSOLIDATED_SELECT_VALUE}
              className="rounded-md border border-[#d7d3c3] bg-background px-2 py-1.5"
            >
              {entityOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white"
          >
            Apply filter
          </button>
          <p className="w-full text-xs text-[#7c7871]">
            Showing: <span className="font-medium">{bundle.scopeLabel}</span>
            {scope.entityId ? (
              <span className="ml-1 text-[#b2a384]" title={scope.entityId}>
                ({entityLabel(scope.entityId)})
              </span>
            ) : null}
            . New entities appear from the registry — not a hard-coded forever list.
          </p>
        </form>
      ) : (
        <p className="text-sm text-[#7c7871]">
          Scoped to <span className="font-medium">{bundle.scopeLabel}</span>.
        </p>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        <span
          className={
            bundle.dialpadLive
              ? 'rounded-full bg-[#e8f0e3] px-2 py-1 text-[#3a5340]'
              : 'rounded-full bg-[#f3efe6] px-2 py-1 text-[#7c7871]'
          }
        >
          Dialpad {bundle.dialpadLive ? 'LIVE' : 'not LIVE'}
        </span>
        <span
          className={
            bundle.eccLive
              ? 'rounded-full bg-[#e8f0e3] px-2 py-1 text-[#3a5340]'
              : 'rounded-full bg-[#f3efe6] px-2 py-1 text-[#7c7871]'
          }
        >
          ECC {bundle.eccLive ? 'LIVE' : 'not LIVE'}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {bundle.metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-xl border border-[#d7d3c3] bg-white px-4 py-3"
          >
            <p className="text-[10px] font-semibold tracking-[0.14em] text-[#7c7871] uppercase">
              {m.label}
            </p>
            <p className="font-heading mt-1 text-2xl font-semibold text-[#3a414f]">
              {m.value}
            </p>
            {m.hint ? (
              <p className="mt-1 text-xs text-[#7c7871]">{m.hint}</p>
            ) : null}
          </div>
        ))}
      </div>

      {bundle.notes.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">What still needs connecting</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {bundle.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link
          href={bundle.eccHref}
          className="rounded-md border border-[#d7d3c3] px-3 py-2 text-sm hover:bg-[#faf8f5]"
        >
          Open ECC metrics
        </Link>
        <a
          href={bundle.dialpadHref}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-[#d7d3c3] px-3 py-2 text-sm hover:bg-[#faf8f5]"
        >
          Open Dialpad
        </a>
      </div>
    </div>
  );
}
