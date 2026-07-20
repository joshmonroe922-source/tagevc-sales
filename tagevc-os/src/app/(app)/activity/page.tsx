import Link from 'next/link';
import { NotificationInbox } from '@/components/activity/notification-inbox';
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
  messages: 'Messages',
};

function hrefFor(refType: string | null, refId: string | null): string | null {
  if (!refType || !refId) return null;
  if (refType === 'lead') return `/deal-flow/vc/leads/${refId}`;
  if (refType === 'deal') return `/deal-flow/vc/deals/${refId}`;
  if (refType === 'entity') return `/entities/${refId}`;
  if (refType === 'ticket') return `/shared-services/tickets/${refId}`;
  if (refType === 'doc' || refType === 'document') return `/documents/${refId}`;
  if (refType === 'ma') return `/deal-flow/ma/${refId}`;
  if (refType === 're') return `/deal-flow/re/${refId}`;
  if (refType === 'ic') return `/deal-flow/vc/ic`;
  if (refType === 'role') return '/activity';
  if (refType === 'conversation') return `/messages?c=${refId}`;
  return null;
}

export default async function ActivityPage() {
  const [activity, notes] = await Promise.all([
    listRecentActivity(50),
    listMyNotifications(40),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Activity
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Notification inbox (including chat) and recent firm actions across
          Deal Flow, Shared Services, Documents, and Messages.{' '}
          <Link
            href="/settings/notifications"
            className="font-medium text-[#3a414f] underline-offset-4 hover:underline"
          >
            Notification preferences
          </Link>
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notifications</CardTitle>
          <CardDescription>
            Chat messages, leads, and capital events. Unread items are
            highlighted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationInbox
            notifications={notes.ok ? notes.notifications : []}
            error={notes.ok ? null : notes.error}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent actions</CardTitle>
          <CardDescription>
            {!activity.ok
              ? 'Could not load activity'
              : activity.events.length === 0
                ? 'No activity yet — create a lead, ticket, document, or chat link to start the feed.'
                : `${activity.events.length} most recent events`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!activity.ok ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {activity.error}
            </p>
          ) : activity.events.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="Apply Phase 7 SQL if tables are missing, then create a lead, ticket, or document."
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
            activity.events.map((e) => {
              const href = hrefFor(e.ref_type, e.ref_id);
              const body = (
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border px-4 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-normal">
                        {MODULE_LABEL[e.module] ?? e.module}
                      </Badge>
                      {e.impersonating_as ? (
                        <Badge variant="outline" className="font-normal">
                          as {e.impersonating_as}
                        </Badge>
                      ) : null}
                      <span className="text-sm font-medium text-foreground">
                        {e.title}
                      </span>
                    </div>
                    {e.detail ? (
                      <p className="text-xs text-muted-foreground">{e.detail}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {e.actor_name || e.actor_email || 'System'}
                      {e.real_role ? ` · ${e.real_role}` : ''} ·{' '}
                      {new Date(e.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
              return href ? (
                <Link
                  key={e.event_id}
                  href={href}
                  className="block hover:opacity-90"
                >
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
