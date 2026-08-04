import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AiReviewPanel } from '@/components/documents/ai-review-panel';
import { DocumentAclEditor } from '@/components/documents/document-acl-editor';
import { DocumentSendActions } from '@/components/documents/document-send-actions';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  getDocument,
  listDocAudits,
} from '@/lib/data/document-store';
import { canAccessScopedEntity } from '@/lib/data/pipeline-scope';
import { isCapitalDocument } from '@/lib/documents/capital-gate';
import {
  canManageDocumentAcl,
  canViewDocumentForRole,
  formatVisibleRolesLabel,
  resolveDocumentVisibleRoles,
} from '@/lib/documents/visibility';
import { formatDate } from '@/lib/format';
import { entityDisplayName } from '@/lib/entities/display-name';
import { getSessionContext, isImpersonating } from '@/lib/rbac/session';

type Props = { params: Promise<{ docId: string }> };

export default async function DocumentDetailPage({ params }: Props) {
  const { docId } = await params;
  const doc = getDocument(docId);
  if (!doc) notFound();
  if (!(await canAccessScopedEntity(doc.entity_id))) notFound();
  const session = await getSessionContext();
  const role = session?.profile.role ?? null;
  if (!canViewDocumentForRole(role, doc)) notFound();
  const breakGlassBlocked = await isImpersonating();
  const audits = listDocAudits(doc.doc_id);
  const capital = isCapitalDocument(doc.doc_type);
  const effectiveRoles = resolveDocumentVisibleRoles(doc);
  const canSetAcl = canManageDocumentAcl(role);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link
          href={
            doc.entity_id
              ? `/documents/entities/${doc.entity_id}`
              : '/documents'
          }
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Library
        </Link>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          {doc.title}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{doc.doc_id}</Badge>
          <Badge variant="secondary">{doc.doc_type}</Badge>
          <Badge variant="outline">{doc.status}</Badge>
          {capital ? <Badge variant="destructive">Capital · human send</Badge> : null}
          {effectiveRoles ? (
            <Badge variant="outline">Role-restricted</Badge>
          ) : (
            <Badge variant="secondary">Open access</Badge>
          )}
          {doc.ai_review ? (
            <Badge
              variant="outline"
              className="border-sky-200 bg-sky-50 text-sky-950"
            >
              AI reviewed
            </Badge>
          ) : null}
        </div>
      </div>

      <DocumentSendActions
        docId={doc.doc_id}
        docType={doc.doc_type}
        status={doc.status}
        breakGlassBlocked={breakGlassBlocked}
      />

      {canSetAcl ? (
        <DocumentAclEditor
          docId={doc.doc_id}
          effectiveRoles={effectiveRoles}
          storedRoles={doc.visible_roles}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Role access</CardTitle>
            <CardDescription>
              Visible to: {formatVisibleRolesLabel(effectiveRoles)}. Only
              Visionary or Admin can change file ACL.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <AiReviewPanel docId={doc.doc_id} review={doc.ai_review} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record</CardTitle>
            <CardDescription>Excel docs table fields.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row
              label="Entity"
              value={
                doc.entity_id ? entityDisplayName(doc.entity_id) : '—'
              }
            />
            <Row label="Deal / task" value={doc.deal_or_task_id ?? '—'} />
            <Row label="Template" value={doc.template_id ?? '—'} />
            <Row label="Envelope" value={doc.envelope_id ?? '—'} />
            <Row label="Folder" value={doc.folder} />
            <Row label="Access" value={formatVisibleRolesLabel(effectiveRoles)} />
            <Row label="Path" value={doc.library_path} />
            <Row label="Sent by" value={doc.sent_by ?? '—'} />
            <Row label="Sent at" value={formatDate(doc.sent_at)} />
            <Row label="Completed" value={formatDate(doc.completed_at)} />
            <Row label="Hash" value={doc.content_hash ?? '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Signers</CardTitle>
            <CardDescription>§4 step 3 — routing order.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {doc.signers.length === 0 ? (
              <p className="text-muted-foreground">No signers (upload only).</p>
            ) : (
              doc.signers.map((s) => (
                <div
                  key={`${s.email}-${s.order}`}
                  className="rounded-md border border-border px-3 py-2"
                >
                  <p className="font-medium">
                    #{s.order} {s.name} · {s.role}
                  </p>
                  <p className="text-xs text-muted-foreground">{s.email}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Merged preview</CardTitle>
          <CardDescription>§4 step 2 — tokens from entity/deal/party.</CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(doc.merge_values).length > 0 ? (
            <div className="mb-4 grid gap-1 text-xs sm:grid-cols-2">
              {Object.entries(doc.merge_values).map(([k, v]) => (
                <div key={k} className="truncate">
                  <code>{k}</code> → {v || '∅'}
                </div>
              ))}
            </div>
          ) : null}
          <SeparatorLine />
          <pre className="mt-3 whitespace-pre-wrap rounded-md bg-muted/50 p-4 text-sm">
            {doc.merged_body ?? '—'}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lifecycle audit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {audits.map((a) => (
            <div
              key={a.event_id}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{a.event_id}</Badge>
                <span className="font-medium">{a.action}</span>
                <span className="text-xs text-muted-foreground">{a.actor}</span>
              </div>
              <p className="text-xs text-muted-foreground">{a.detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-all font-medium">{value}</dd>
    </div>
  );
}

function SeparatorLine() {
  return <div className="border-t border-border" />;
}
