import Link from 'next/link';
import { buildPartnerBiReport } from '@/lib/partners/bi';
import { requirePermission } from '@/lib/rbac/session';

export default async function PartnerBiPage() {
  await requirePermission('read:shared_services');
  const report = await buildPartnerBiReport();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          AI Business Intelligence
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cross-system insight shell over partner platforms, marketing presence,
          commissions, and the unified DB signal feed.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/shared-services" className="underline underline-offset-2">
          ← Shared Services
        </Link>
        <Link href="/c-suite" className="underline underline-offset-2">
          AI C-Suite
        </Link>
        <Link
          href="/shared-services/it/technology-stack"
          className="underline underline-offset-2"
        >
          Technology stack
        </Link>
        <Link
          href="/shared-services/marketing/presence"
          className="underline underline-offset-2"
        >
          Marketing presence
        </Link>
      </div>

      <p className="text-xs text-muted-foreground">
        Generated {report.generatedAt}
      </p>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Partners', report.partnerCount],
          ['Live', report.liveCount],
          ['Configured', report.configuredCount],
          ['Scaffolded', report.scaffoldedCount],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-base font-semibold">Insights</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
          {report.insightBullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-base font-semibold">Partner posture</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {report.cards.map((c) => (
            <Link
              key={c.key}
              href={c.href}
              className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/40"
            >
              <div className="flex justify-between gap-2">
                <span className="font-medium">{c.label}</span>
                <span className="text-xs text-muted-foreground">{c.status}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.summary}</p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold">Marketing presence feed</h2>
        {report.presence.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Apply phase89 SQL to seed presence slots.
          </p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {report.presence.slice(0, 24).map((p) => (
              <li key={`${p.entity_id}-${p.kind}`}>
                <span className="font-medium">{p.entity_id}</span> · {p.kind} ·{' '}
                {p.status}
                {p.last_import_at ? ` · imported ${p.last_import_at}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-base font-semibold">Commission queue (Gusto)</h2>
        {report.commissionQueue.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No stubs — paid invoice hook will populate{' '}
            <code>os_gusto_commission_stubs</code>.
          </p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {report.commissionQueue.map((c) => (
              <li key={c.id}>
                {c.entity_id} · {(c.commission_cents / 100).toFixed(2)} ·{' '}
                {c.status}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
