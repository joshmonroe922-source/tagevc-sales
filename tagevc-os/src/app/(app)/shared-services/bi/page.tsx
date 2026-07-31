import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  buildPartnerBiInsights,
  listMarketingPresence,
  listPartnerContracts,
} from '@/lib/partners/repo';
import { requirePermission } from '@/lib/rbac/session';

export default async function PartnerBiPage() {
  await requirePermission('read:shared_services');

  const [{ rows: contracts }, { rows: presence }] = await Promise.all([
    listPartnerContracts(),
    listMarketingPresence(),
  ]);
  const insights = buildPartnerBiInsights({ contracts, presence });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link href="/shared-services" className="hover:underline">
            Shared Services
          </Link>
          {' · '}
          AI Business Intelligence
        </p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Partner BI
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Actionable insights across Dialpad, Verified First, MyBasePay, Apollo,
          Gusto, DocuSign, LinkedIn Recruiter, Appcast, Google Business / GA4,
          and LinkedIn Company Pages — plus unified DB event bus when LIVE.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Insights</CardTitle>
          <CardDescription>
            Shell wired to contracts, presence slots, and env connection gaps.
            Live adapters emit into <code className="text-xs">os_partner_events</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {insights.map((insight, idx) => (
            <div
              key={`${insight.partner_key}-${idx}`}
              className="rounded-md border border-border/70 px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{insight.title}</span>
                <Badge
                  variant={
                    insight.severity === 'action'
                      ? 'destructive'
                      : insight.severity === 'watch'
                        ? 'secondary'
                        : 'outline'
                  }
                >
                  {insight.severity}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {insight.partner_key}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{insight.detail}</p>
              {insight.href ? (
                <Link
                  href={insight.href}
                  className="mt-1 inline-block text-xs underline"
                >
                  Open
                </Link>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
