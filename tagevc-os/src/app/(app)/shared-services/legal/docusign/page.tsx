import Link from 'next/link';
import { DocuSignHubActions } from '@/components/shared-services/docusign-hub-actions';
import { DocuSignTemplateSendForm } from '@/components/shared-services/docusign-template-send-form';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getDocuSignMode, isDocuSignConfigured } from '@/lib/docusign/config';
import { listRecentEnvelopes } from '@/lib/docusign/envelopes';
import {
  countDocuSignEvents,
  listDocuSignEvents,
} from '@/lib/docusign/events-repo';
import { listSignedFiles } from '@/lib/docusign/signed-docs';
import { listReminderJobs } from '@/lib/docusign/reminder-jobs';
import { listCachedTemplates } from '@/lib/docusign/templates';
import { DOCUSIGN_ENV_KEYS } from '@/lib/docusign/types';
import { roleHasPermission } from '@/lib/types/roles';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

function formatBytes(n: number | null | undefined): string {
  if (n == null || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DocuSignModulePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('read:documents');

  const sp = (await searchParams) ?? {};
  const statusFilter =
    typeof sp.status === 'string' ? sp.status.trim() : undefined;
  const eventTypeFilter =
    typeof sp.event_type === 'string' ? sp.event_type.trim() : undefined;
  const envelopeFilter =
    typeof sp.envelope_id === 'string' ? sp.envelope_id.trim() : undefined;

  const mode = getDocuSignMode();
  const configured = isDocuSignConfigured();
  const ctx = await getSessionContext();
  const canWrite = ctx
    ? roleHasPermission(ctx.profile.role, 'write:documents')
    : false;
  const [events, count, signed, templates, reminders, liveEnvelopes] =
    await Promise.all([
    listDocuSignEvents({
      limit: 40,
      status: statusFilter,
      eventType: eventTypeFilter,
      envelopeId: envelopeFilter,
    }),
    countDocuSignEvents(),
    listSignedFiles({ limit: 20, withDownloadUrls: true }),
    listCachedTemplates(40),
    listReminderJobs(20),
    configured
      ? listRecentEnvelopes({ status: statusFilter, count: 40 })
      : Promise.resolve({
          ok: true as const,
          envelopes: [],
        }),
  ]);

  const voidPolicy = process.env.DOCUSIGN_VOID_POLICY?.trim() || 'allow';

  const missingEnv = DOCUSIGN_ENV_KEYS.filter((k) => {
    if (k === 'DOCUSIGN_OAUTH_HOST' || k === 'DOCUSIGN_BASE_PATH') return false;
    if (k === 'DOCUSIGN_WEBHOOK_SECRET' || k === 'DOCUSIGN_CONNECT_HMAC_SECRET')
      return false;
    return !process.env[k]?.trim();
  });

  const storageOk = signed.rows.filter((r) => r.storage_path).length;
  const storageErr = signed.rows.filter((r) => r.storage_error).length;
  const cocCount = signed.rows.filter((r) => r.file_kind === 'certificate').length;
  const voidEvents = events.filter(
    (e) =>
      e.event_type === 'envelope-voided' ||
      String(e.status).toLowerCase() === 'voided',
  );

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
          <Badge variant="secondary">Phase 31</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">DocuSign</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Live envelope management, irreversible void replacement policy (
          {voidPolicy}), action diagnostics, template roles, CoC email, and
          reminders. Capital sends still require{' '}
          <code className="text-xs">action:docusign_capital</code>.
        </p>
        <DocuSignHubActions canWrite={canWrite} />
        <DocuSignTemplateSendForm
          templates={templates.rows}
          canWrite={canWrite}
        />
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
            <p className="text-muted-foreground">
              Object storage: {storageOk} in bucket · CoC rows: {cocCount}
              {storageErr > 0 ? (
                <span className="text-amber-700"> · {storageErr} with errors</span>
              ) : null}
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
              Apply <code className="text-xs">phase29_paid_media_warranty.sql</code>{' '}
              for paid campaign stubs and warranty.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>
              Docs: <code className="text-xs">docs/OS_DOCUSIGN.md</code>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Templates</CardTitle>
          <CardDescription>
            Cached from DocuSign account — use Refresh templates to sync
            {templates.error ? ` · ${templates.error}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templates.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No templates cached yet — configure JWT and click Refresh templates.
            </p>
          ) : (
            <ul className="space-y-1 text-sm max-h-48 overflow-y-auto">
              {templates.rows.map((t) => (
                <li
                  key={t.template_id}
                  className="border-b border-border/40 py-1.5"
                >
                  <span className="font-medium">{t.name}</span>
                  {t.shared ? (
                    <span className="ml-1 text-xs text-muted-foreground">shared</span>
                  ) : null}
                  <span className="block font-mono text-xs text-muted-foreground">
                    {t.template_id}
                    {t.last_modified
                      ? ` · ${t.last_modified.slice(0, 10)}`
                      : ''}
                  </span>
                  {t.roles?.length ? (
                    <span className="block text-xs text-muted-foreground">
                      Roles: {t.roles.join(', ')}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live envelopes</CardTitle>
          <CardDescription>
            Authoritative DocuSign status changes from the last 30 days
            {!liveEnvelopes.ok ? ` · ${liveEnvelopes.error}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            {['all', 'sent', 'delivered', 'completed', 'voided'].map((s) => (
              <Link
                key={s}
                href={
                  s === 'all'
                    ? '/shared-services/legal/docusign'
                    : `/shared-services/legal/docusign?status=${s}`
                }
                className="rounded-full border px-2 py-1 underline-offset-4 hover:underline"
              >
                {s}
              </Link>
            ))}
          </div>
          {liveEnvelopes.ok && liveEnvelopes.envelopes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3">Subject</th>
                    <th className="py-2 pr-3">Envelope</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Changed</th>
                  </tr>
                </thead>
                <tbody>
                  {liveEnvelopes.envelopes.map((e) => (
                    <tr
                      key={e.envelopeId}
                      className="border-b border-border/40"
                    >
                      <td className="py-2 pr-3">
                        {e.emailSubject ?? 'Untitled'}
                        {e.voidedReason ? (
                          <span className="block text-xs text-amber-700">
                            Void: {e.voidedReason}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        <Link
                          href={`/shared-services/legal/docusign?envelope_id=${encodeURIComponent(e.envelopeId)}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {e.envelopeId.slice(0, 18)}
                          {e.envelopeId.length > 18 ? '…' : ''}
                        </Link>
                      </td>
                      <td
                        className={`py-2 pr-3 ${
                          e.status === 'voided'
                            ? 'text-amber-700'
                            : e.status === 'completed'
                              ? 'text-emerald-700'
                              : ''
                        }`}
                      >
                        {e.status}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {e.statusChangedDateTime
                          ?.slice(0, 16)
                          .replace('T', ' ') ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {configured
                ? 'No matching live envelopes in the last 30 days.'
                : 'Configure DocuSign JWT to load live envelopes.'}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Voids cannot be undone in DocuSign. Use “Replace voided envelope”
            to create a new envelope with audit lineage.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reminder queue</CardTitle>
          <CardDescription>
            Scheduled +1/+3/+7d reminders (daily worker)
            {reminders.error ? ` · ${reminders.error}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reminders.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Empty — schedule reminders from an envelope or template send.
            </p>
          ) : (
            <ul className="space-y-1 text-sm max-h-40 overflow-y-auto text-muted-foreground">
              {reminders.rows.map((j) => (
                <li key={j.job_id}>
                  <span
                    className={
                      j.status === 'pending'
                        ? 'text-amber-700'
                        : j.status === 'failed'
                          ? 'text-destructive'
                          : j.status === 'succeeded'
                            ? 'text-emerald-700'
                            : undefined
                    }
                  >
                    {j.status}
                  </span>
                  {' · '}
                  {j.scheduled_for.slice(0, 16).replace('T', ' ')} ·{' '}
                  {j.envelope_id.slice(0, 16)}…
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Void audit</CardTitle>
          <CardDescription>
            Recent envelope-voided events (reason + actor in payload)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {voidEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No voids logged yet.</p>
          ) : (
            <ul className="space-y-1 text-sm max-h-40 overflow-y-auto">
              {voidEvents.slice(0, 10).map((e) => {
                const raw = (e.raw_payload ?? {}) as {
                  reason?: string;
                  actor_email?: string;
                };
                return (
                  <li
                    key={e.event_id ?? `${e.envelope_id}-${e.received_at}`}
                    className="border-b border-border/40 py-1.5"
                  >
                    <span className="font-mono text-xs">
                      {e.envelope_id.slice(0, 16)}…
                    </span>
                    {' · '}
                    {e.received_at?.slice(0, 16).replace('T', ' ')}
                    {raw.reason ? (
                      <span className="block text-xs text-muted-foreground">
                        {raw.reason}
                        {raw.actor_email ? ` · ${raw.actor_email}` : ''}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent events</CardTitle>
          <CardDescription>
            From <code className="text-xs">os_docusign_events</code> (newest first)
            {(statusFilter || eventTypeFilter || envelopeFilter) &&
              ' · filtered'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Link
              href="/shared-services/legal/docusign"
              className="underline-offset-4 hover:underline"
            >
              All
            </Link>
            <Link
              href="/shared-services/legal/docusign?status=voided"
              className="underline-offset-4 hover:underline"
            >
              Voided
            </Link>
            <Link
              href="/shared-services/legal/docusign?status=completed"
              className="underline-offset-4 hover:underline"
            >
              Completed
            </Link>
            <Link
              href="/shared-services/legal/docusign?status=sent"
              className="underline-offset-4 hover:underline"
            >
              Sent
            </Link>
            <Link
              href="/shared-services/legal/docusign?event_type=envelope-voided"
              className="underline-offset-4 hover:underline"
            >
              Void events
            </Link>
            <Link
              href="/shared-services/legal/docusign?event_type=envelope-sent-from-template"
              className="underline-offset-4 hover:underline"
            >
              Template sends
            </Link>
          </div>
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
                    <th className="py-2 pr-3 font-medium">Event</th>
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
                      <td
                        className={`py-2 pr-3 ${
                          e.status === 'voided' ? 'text-amber-700' : ''
                        }`}
                      >
                        {e.status}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {e.event_type ?? '—'}
                      </td>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signed archives + CoC</CardTitle>
          <CardDescription>
            Combined PDFs and Certificates of Completion in{' '}
            <code className="text-xs">docusign-signed</code>
            {signed.error ? ` · ${signed.error}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {signed.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No signed files yet — complete an envelope via Connect or simulate.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3 font-medium">File</th>
                    <th className="py-2 pr-3 font-medium">Kind</th>
                    <th className="py-2 pr-3 font-medium">Size</th>
                    <th className="py-2 pr-3 font-medium">Storage</th>
                    <th className="py-2 font-medium">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {signed.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/40">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{row.file_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {row.source} · {row.library_path ?? '—'} ·{' '}
                          {row.envelope_id.slice(0, 16)}…
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {row.file_kind ?? 'combined'}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {formatBytes(row.size_bytes)}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {row.storage_path ? (
                          <span className="text-emerald-700">object</span>
                        ) : row.storage_error ? (
                          <span className="text-amber-700" title={row.storage_error}>
                            error
                          </span>
                        ) : (
                          <span className="text-muted-foreground">inline/legacy</span>
                        )}
                        {row.storage_error ? (
                          <span className="block text-amber-700/90 max-w-[14rem] truncate">
                            {row.storage_error}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 text-xs">
                        {row.download_url ? (
                          <a
                            href={row.download_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            Download
                          </a>
                        ) : (
                          '—'
                        )}
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
