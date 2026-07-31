import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { marketingPresencePartners } from '@/lib/partners/catalog';
import { listPartnerRuntimeStatuses } from '@/lib/partners/env';
import { listMarketingPresence } from '@/lib/partners/repo';
import { requirePermission } from '@/lib/rbac/session';

const KIND_LABEL: Record<string, string> = {
  google_business: 'Google Business Profile',
  google_analytics: 'Google Analytics (GA4)',
  linkedin_company_pages: 'LinkedIn Company Page',
};

export default async function MarketingPresencePage() {
  await requirePermission('read:marketing');

  const partners = marketingPresencePartners();
  const runtime = listPartnerRuntimeStatuses().filter((r) =>
    partners.some((p) => p.key === r.key),
  );
  const { rows, error } = await listMarketingPresence();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link href="/shared-services/marketing" className="hover:underline">
            Marketing
          </Link>
          {' · '}
          Shared Services
        </p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Presence · Google & LinkedIn
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Central ops for per-entity Google Business Pages, GA4 properties, and
          LinkedIn Company / Business Pages. Inherited by every OS entity.
          Distinct from social publish OAuth and LinkedIn Recruiter.
        </p>
      </div>

      {error && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          DB soft-fail (apply phase89): {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection status</CardTitle>
          <CardDescription>
            Env placeholders only — Josh connects each account (see PARTNER_SPINE.md).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {runtime.map((r) => (
            <div
              key={r.key}
              id={r.key}
              className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border/70 px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.setupNote}</div>
              </div>
              <Badge variant={r.status === 'live' ? 'default' : 'outline'}>
                {r.status}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entity properties</CardTitle>
          <CardDescription>
            <code className="text-xs">os_marketing_presence_properties</code> —
            one slot per entity × kind
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rows yet. After phase89, provision seeds ENT-FIRM / R619 /
              Signent / Instant NDA. Or call{' '}
              <code className="text-xs">provision_partner_spine_for_entity</code>.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Entity</th>
                    <th className="py-2 pr-3 font-medium">Kind</th>
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">External ID</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-mono text-xs">{r.entity_id}</td>
                      <td className="py-2 pr-3">
                        {KIND_LABEL[r.kind] ?? r.kind}
                      </td>
                      <td className="py-2 pr-3">{r.display_name}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {r.external_id ?? '— connect —'}
                      </td>
                      <td className="py-2">
                        <Badge variant="outline">{r.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
