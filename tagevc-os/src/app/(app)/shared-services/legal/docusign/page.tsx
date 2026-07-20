import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getDocuSignMode, isDocuSignConfigured } from '@/lib/docusign/config';
import {
  countDocuSignEvents,
  listDocuSignEvents,
} from '@/lib/docusign/events-repo';
import { DOCUSIGN_ENV_KEYS } from '@/lib/docusign/types';
import { requirePermission } from '@/lib/rbac/session';

export default async function DocuSignModulePage() {
  await requirePermission('read:documents');

  const mode = getDocuSignMode();
  const configured = isDocuSignConfigured();
  const [events, count] = await Promise.all([
    listDocuSignEvents({ limit: 25 }),
    countDocuSignEvents(),
  ]);

  const missingEnv = DOCUSIGN_ENV_KEYS.filter((k) => {
    if (k === 'DOCUSIGN_OAUTH_HOST' || k === 'DOCUSIGN_BASE_PATH') return false;
    if (k === 'DOCUSIGN_WEBHOOK_SECRET' || k === 'DOCUSIGN_CONNECT_HMAC_SECRET')
      return false;
    return !process.env[k]?.trim();
  });

  return (
    <div className="space-y-6">
      <Link
        href="/shared-services"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Shared Services
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Legal</Badge>
          <Badge variant={mode === 'live' ? 'default' : 'secondary'}>
            {mode === 'live' ? 'Live JWT' : 'Mock envelopes'}
          </Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">DocuSign</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Send from Documents uses JWT when configured; Connect webhooks land in{' '}
          <code className="text-xs">os_docusign_events</code> and update document
          status. Capital sends still require{' '}
          <code className="text-xs">action:docusign_capital</code>.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integration status</CardTitle>
            <CardDescription>
              Mode: <strong>{mode}</strong>
              {count !== null ? ` · ${count} events logged` : ' · events table unavailable'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              JWT configured:{' '}
              <span className={configured ? 'text-emerald-700' : ''}>
                {configured ? 'yes' : 'no — falling back to mock ENV- ids'}
              </span>
            </p>
            {!configured && missingEnv.length > 0 && (
              <p className="text-muted-foreground">
                Missing: {missingEnv.join(', ')}
              </p>
            )}
            <p className="text-muted-foreground">
              Webhook: <code className="text-xs">POST /api/docusign/webhook</code>
            </p>
            <Link
              href="/documents"
              className="inline-flex text-sm font-medium underline-offset-4 hover:underline"
            >
              Open Documents →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Links</CardTitle>
            <CardDescription>
              Envelopes can carry entity, deal, or ticket refs from the document.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>
              Apply SQL: <code className="text-xs">phase20_docusign_events.sql</code>{' '}
              + <code className="text-xs">phase21_shared_services.sql</code>
            </p>
            <p>
              Docs: <code className="text-xs">docs/OS_DOCUSIGN.md</code>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent events</CardTitle>
          <CardDescription>
            From <code className="text-xs">os_docusign_events</code> (newest first)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events yet — send a document or wait for Connect.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Envelope</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Doc</th>
                    <th className="py-2 pr-3 font-medium">Entity</th>
                    <th className="py-2 font-medium">Deal / Ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-b border-border/40">
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                        {e.received_at.slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {e.envelope_id.slice(0, 18)}
                        {e.envelope_id.length > 18 ? '…' : ''}
                      </td>
                      <td className="py-2 pr-3">{e.status}</td>
                      <td className="py-2 pr-3">
                        {e.doc_id ? (
                          <Link
                            href={`/documents/${e.doc_id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {e.doc_id}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 pr-3">{e.entity_id ?? '—'}</td>
                      <td className="py-2 text-xs">
                        {e.deal_id || e.ticket_id || '—'}
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
