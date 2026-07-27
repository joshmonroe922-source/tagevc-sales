import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CreateFromTemplateForm } from '@/components/documents/create-from-template-form';
import { UploadDocumentForm } from '@/components/documents/upload-document-form';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { listDocumentLibraryEntities } from '@/lib/data/entity-os';
import { getEntityById } from '@/lib/data/repositories';
import { listTemplates } from '@/lib/data/document-store';
import {
  canAccessScopedEntity,
  listScopedDocuments,
} from '@/lib/data/pipeline-scope';
import { FOLDER_LABELS, isFirmDocumentEntity } from '@/lib/documents/library';
import {
  canManageDocumentAcl,
  canViewLibraryFolderForRole,
  formatVisibleRolesLabel,
  FOLDER_DEFAULT_VISIBLE_ROLES,
  libraryViewModeLabel,
} from '@/lib/documents/visibility';
import { getSessionContext } from '@/lib/rbac/session';
import { ENTITY_DOC_FOLDERS } from '@/lib/types/enums';

type Props = { params: Promise<{ entityId: string }> };

export default async function EntityDocumentsPage({ params }: Props) {
  const { entityId } = await params;
  const entity = await getEntityById(entityId);
  if (!entity) notFound();
  if (!(await canAccessScopedEntity(entity.entity_id))) notFound();

  const session = await getSessionContext();
  const role = session?.profile.role ?? null;
  const view = libraryViewModeLabel(role);
  const canSetAcl = canManageDocumentAcl(role);
  const isFirm = isFirmDocumentEntity(entity.entity_id);
  const [libraryEntities, docs, templates] = await Promise.all([
    listDocumentLibraryEntities(),
    listScopedDocuments(entity.entity_id),
    Promise.resolve(listTemplates()),
  ]);

  const byFolder: Record<string, typeof docs> = {};
  for (const f of ENTITY_DOC_FOLDERS) byFolder[f] = [];
  for (const d of docs) {
    if (byFolder[d.folder]) byFolder[d.folder].push(d);
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link
          href="/documents"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Document Library (whole library)
        </Link>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          {entity.canonical_name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isFirm ? 'Firm' : 'Company'} document folders · {view.title}
          {' · '}
          <Link
            href={`/entities/${entity.entity_id}`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Open {isFirm ? 'firm' : 'company'}
          </Link>
        </p>
      </div>

      <div className="space-y-4">
        {ENTITY_DOC_FOLDERS.map((folder) => {
          if (!canViewLibraryFolderForRole(role, folder)) return null;
          const folderDocs = byFolder[folder] ?? [];
          const folderAcl = FOLDER_DEFAULT_VISIBLE_ROLES[folder];
          return (
            <Card key={folder}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {FOLDER_LABELS[folder]}
                </CardTitle>
                <CardDescription>
                  {folderAcl
                    ? `Default access: ${formatVisibleRolesLabel(folderAcl)} (+ Visionary/Admin)`
                    : 'Open folder (all roles with document access)'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {folderDocs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Empty</p>
                ) : (
                  folderDocs.map((d) => (
                    <Link
                      key={d.doc_id}
                      href={`/documents/${d.doc_id}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
                    >
                      <span>
                        <span className="font-medium">{d.title}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {d.doc_id}
                        </span>
                      </span>
                      <Badge variant="outline">{d.status}</Badge>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CreateFromTemplateForm
          entities={libraryEntities}
          templates={templates}
          defaultEntityId={entity.entity_id}
          canSetAcl={canSetAcl}
        />
        <UploadDocumentForm
          entities={libraryEntities}
          defaultEntityId={entity.entity_id}
          canSetAcl={canSetAcl}
        />
      </div>
    </div>
  );
}
