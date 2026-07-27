import Link from 'next/link';
import { Suspense } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ReportingPeriodChips } from '@/components/platform/reporting-period-chips';
import {
  parseReportingPeriodParam,
  reportingWindow,
} from '@/lib/platform/reporting-timeframes';
import { summarizePlatformEmailMessages } from '@/lib/platform/email';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { getSessionContext } from '@/lib/rbac/session';

type Props = { searchParams: Promise<{ period?: string }> };

/**
 * Platform email analytics (entity-scoped).
 * Reads os_platform_email_messages when present; fail-soft empty otherwise.
 */
export default async function AdminPlatformEmailPage({ searchParams }: Props) {
  const session = await getSessionContext();
  if (!session) return null;

  const sp = await searchParams;
  const period = parseReportingPeriodParam(sp.period, 'week');
  const win = reportingWindow(period, 'America/New_York');

  let rows: Array<{
    status: string;
    open_count: number;
    click_count: number;
    subject: string;
    provider: string;
    entity_id: string;
    created_at: string;
  }> = [];
  let tableReady = true;

  try {
    const supabase = await createPersistClient();
    const { data, error } = await supabase
      .from('os_platform_email_messages')
      .select(
        'status, open_count, click_count, subject, provider, entity_id, created_at',
      )
      .gte('created_at', win.start.toISOString())
      .lte('created_at', win.end.toISOString())
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      tableReady = false;
    } else {
      rows = (data ?? []) as typeof rows;
    }
  } catch {
    tableReady = false;
  }

  const summary = summarizePlatformEmailMessages(
    rows.map((r) => ({
      status: r.status as 'sent',
      open_count: r.open_count,
      click_count: r.click_count,
    })),
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Platform · Email
        </p>
        <h1 className="font-heading text-3xl">Email analytics</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Opens and clicks for Graph + Resend sends across Tage and
          subsidiaries. Apply{' '}
          <code className="text-xs">supabase/phase_platform_email.sql</code>{' '}
          if empty. Legacy deal email remains at the Vite portal{' '}
          <code className="text-xs">/sales/admin/email</code>.
        </p>
        <Suspense fallback={null}>
          <ReportingPeriodChips active={period} />
        </Suspense>
        <p className="text-xs text-muted-foreground">{win.rangeLabel}</p>
      </header>

      {!tableReady ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tables not applied</CardTitle>
            <CardDescription>
              Run <code>phase_platform_email.sql</code> on the shared Supabase
              project, then reconnect Microsoft mail on each OS.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Sent', value: summary.sent },
          { label: 'Opened', value: summary.opened },
          { label: 'Clicked', value: summary.clicked },
          { label: 'Bounced', value: summary.bounced },
        ].map((m) => (
          <Card key={m.label}>
            <CardHeader className="pb-2">
              <CardDescription>{m.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{m.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent messages</CardTitle>
          <CardDescription>
            {rows.length === 0
              ? 'No platform sends in this window yet.'
              : `${rows.length} in window`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {rows.slice(0, 40).map((r, i) => (
            <div
              key={`${r.created_at}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-2 last:border-0"
            >
              <div>
                <p className="font-medium">{r.subject || '(no subject)'}</p>
                <p className="text-xs text-muted-foreground">
                  {r.entity_id} · {new Date(r.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">{r.provider}</Badge>
                <Badge variant="secondary">
                  {r.open_count} open · {r.click_count} click
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        <Link href="/admin" className="underline-offset-4 hover:underline">
          ← Admin
        </Link>
        {' · '}
        <a
          href="https://portal.recruit619.com/desk/bulk-email"
          target="_blank"
          rel="noreferrer"
          className="underline-offset-4 hover:underline"
        >
          My Recruiting Desk mass email
        </a>
      </p>
    </div>
  );
}
