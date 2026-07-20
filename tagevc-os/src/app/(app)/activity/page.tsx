import Link from 'next/link';
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
  listMyNotifications,
  listRecentActivity,
} from '@/lib/data/activity';

const MODULE_LABEL: Record<string, string> = {
  vc: 'VC',
  ma: 'M&A',
  re: 'RE',
  shared_services: 'Shared Services',
  documents: 'Documents',
  portfolio: 'Portfolio',
  auth: 'Auth',
  system: 'System',
};

function hrefFor(refType: string | null, refId: string | null): string | null {
  if (!refType || !refId) return null;
  if (refType === 'lead') return `/deal-flow/vc/leads/${refId}`;
  if (refType === 'deal') return `/deal-flow/vc/deals/${refId}`;
  if (refType === 'ticket') return `/shared-services/tickets/${refId}`;
  if (refType === 'doc' || refType === 'document') return `/documents/${refId}`;
  if (refType === 'ma') return `/deal-flow/ma/${refId}`;
  if (refType === 're') return `/deal-flow/re/${refId}`;
  if (refType === 'ic') return `/deal-flow/vc/ic`;
  return null;
}

export default async function ActivityPage() {
  const [events, notifications] = await Promise.all([
    listRecentActivity(50),
    listMyNotifications(12),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Activity
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Recent firm actions across Deal Flow, Shared Services, and Documents.
          Events persist in Supabase.
        </p>
      </header>

      {notifications.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notifications</CardTitle>
            <CardDescription>
              Important events (new leads, signed docs).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {notifications.map((n) => {
              const row = n as {
                notification_id: string;
                title: string;
                body: string | null;
                href: string | null;
                created_at: string;
                kind: string;
              };
              const inner = (
                <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{row.title}</p>
                    {row.body ? (
                      <p className="text-xs text-muted-foreground">{row.body}</p>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </p>
                </div>
              );
              return row.href ? (
                <Link
                  key={row.notification_id}
                  href={row.href}
                  className="block hover:opacity-90"
                >
                  {inner}
                </Link>
              ) : (
                <div key={row.notification_id}>{inner}</div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent actions</CardTitle>
          <CardDescription>
            {events.length === 0
              ? 'No activity yet — create a lead, ticket, or document to start the feed.'
              : `${events.length} most recent events`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {events.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="Apply Phase 7 SQL in Supabase, then create a lead, ticket, or document. Events will appear here."
              action={
                <Link
                  href="/deal-flow/vc/intake"
                  className="text-sm font-medium text-[#3a414f] underline-offset-4 hover:underline"
                >
                  Create a lead →
                </Link>
              }
            />
          ) : (
            events.map((e) => {
              const href = hrefFor(e.ref_type, e.ref_id);
              const body = (
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border px-4 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-normal">
                        {MODULE_LABEL[e.module] ?? e.module}
                      </Badge>
                      <span className="text-sm font-medium text-foreground">
                        {e.title}
                      </span>
                    </div>
                    {e.detail ? (
                      <p className="text-xs text-muted-foreground">{e.detail}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {e.actor_name || e.actor_email || 'System'} ·{' '}
                      {new Date(e.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
              return href ? (
                <Link key={e.event_id} href={href} className="block hover:opacity-90">
                  {body}
                </Link>
              ) : (
                <div key={e.event_id}>{body}</div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
