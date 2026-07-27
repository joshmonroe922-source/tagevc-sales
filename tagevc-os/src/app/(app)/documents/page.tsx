import Link from 'next/link';
import { CreateFromTemplateForm } from '@/components/documents/create-from-template-form';
import { UploadDocumentForm } from '@/components/documents/upload-document-form';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ViewModeLayout } from '@/components/ui/view-mode-toggle';
import { listDocumentLibraryEntities } from '@/lib/data/entity-os';
import { listTemplates } from '@/lib/data/document-store';
import { listScopedDocuments } from '@/lib/data/pipeline-scope';
import { isCapitalDocument } from '@/lib/documents/capital-gate';
import { FIRM_FOLDERS, isFirmDocumentEntity } from '@/lib/documents/library';
import {
  canManageDocumentAcl,
  formatVisibleRolesLabel,
  libraryViewModeLabel,
  resolveDocumentVisibleRoles,
} from '@/lib/documents/visibility';
import { getSessionContext } from '@/lib/rbac/session';
import { ENTITY_DOC_FOLDERS } from '@/lib/types/enums';
import { VIEW_MODE_DEFAULTS } from '@/lib/view-mode';

export default async function DocumentsPage() {
  const session = await getSessionContext();
  const role = session?.profile.role ?? null;
  const view = libraryViewModeLabel(role);
  const canSetAcl = canManageDocumentAcl(role);
  const [entities, docs, templates] = await Promise.all([
    listDocumentLibraryEntities(),
    listScopedDocuments(),
    Promise.resolve(listTemplates()),
  ]);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Shared Services
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Document Library
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Firm and company files with signing workflows. Capital documents
          always need a human to send. This page is the whole-library browser
          for your access level.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{view.title}</CardTitle>
          <CardDescription>{view.detail}</CardDescription>
        </CardHeader>
      </Card>

      <ViewModeLayout
        surface="documents-entities"
        defaultMode={VIEW_MODE_DEFAULTS['documents-entities']}
        cards={
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {entities.map((e) => (
              <Link
                key={e.entity_id}
                href={`/documents/entities/${e.entity_id}`}
              >
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardHeader>
                    <CardTitle className="text-base">{e.canonical_name}</CardTitle>
                    <CardDescription>
                      {docs.filter((d) => d.entity_id === e.entity_id).length}{' '}
                      documents
                      {isFirmDocumentEntity(e.entity_id) ? ' · firm' : ''}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </section>
        }
        list={
          <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border">
            {entities.map((e) => (
              <Link
                key={e.entity_id}
                href={`/documents/entities/${e.entity_id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40"
              >
                <div>
                  <p className="font-medium text-[#3a414f]">{e.canonical_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.entity_id}
                    {isFirmDocumentEntity(e.entity_id) ? ' · firm' : ''}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {docs.filter((d) => d.entity_id === e.entity_id).length} docs →
                </span>
              </Link>
            ))}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Folder structure</CardTitle>
          <CardDescription>
            Tage Venture Capital (ENT-FIRM) and each subsidiary use the same
            folders (corporate through signed). Legacy firm paths:{' '}
            {FIRM_FOLDERS.join(', ')}. Folder{' '}
            <span className="font-medium text-foreground">05_HR</span> is
            role-restricted by default. Visionary / Admin set per-file ACL on
            upload or the document detail page.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="flex flex-wrap gap-2">
        {ENTITY_DOC_FOLDERS.map((f) => (
          <Badge key={f} variant="outline">
            {f}
            {f === '05_HR' ? ' · restricted' : ''}
          </Badge>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Document</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Path</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.map((d) => (
              <TableRow key={d.doc_id}>
                <TableCell>
                  <Link
                    href={`/documents/${d.doc_id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {d.title}
                  </Link>
                  <div className="text-xs text-muted-foreground">{d.doc_id}</div>
                </TableCell>
                <TableCell className="text-sm">{d.entity_id ?? '—'}</TableCell>
                <TableCell>
                  {d.doc_type}
                  {isCapitalDocument(d.doc_type) ? (
                    <Badge variant="secondary" className="ml-2">
                      capital
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{d.status}</TableCell>
                <TableCell className="max-w-[12rem] truncate text-xs text-muted-foreground">
                  {formatVisibleRolesLabel(resolveDocumentVisibleRoles(d))}
                </TableCell>
                <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground">
                  {d.library_path}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CreateFromTemplateForm
          entities={entities}
          templates={templates}
          canSetAcl={canSetAcl}
        />
        <UploadDocumentForm entities={entities} canSetAcl={canSetAcl} />
      </div>
    </div>
  );
}
