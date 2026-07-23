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
import { getEntityById, listEntities } from '@/lib/data/repositories';
import {
  documentsByFolder,
  listTemplates,
} from '@/lib/data/document-store';
import { FOLDER_LABELS } from '@/lib/documents/library';
import { ENTITY_DOC_FOLDERS } from '@/lib/types/enums';

type Props = { params: Promise<{ entityId: string }> };

export default async function EntityDocumentsPage({ params }: Props) {
  const { entityId } = await params;
  const entity = await getEntityById(entityId);
  if (!entity) notFound();
  const byFolder = documentsByFolder(entityId);
  const [entities, templates] = await Promise.all([
    listEntities(),
    Promise.resolve(listTemplates()),
  ]);
  const subs = entities.filter((e) => e.entity_type !== 'Firm');

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link
          href="/documents"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Document Library
        </Link>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          {entity.canonical_name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Company document folders
          {' · '}
          <Link
            href={`/entities/${entity.entity_id}`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Open company
          </Link>
        </p>
      </div>

      <div className="space-y-4">
        {ENTITY_DOC_FOLDERS.map((folder) => (
          <Card key={folder}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{FOLDER_LABELS[folder]}</CardTitle>
              <CardDescription>{FOLDER_LABELS[folder]} folder</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(byFolder[folder] ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Empty</p>
              ) : (
                (byFolder[folder] ?? []).map((d) => (
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
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CreateFromTemplateForm
          entities={subs}
          templates={templates}
          defaultEntityId={entity.entity_id}
        />
        <UploadDocumentForm
          entities={subs}
          defaultEntityId={entity.entity_id}
        />
      </div>
    </div>
  );
}
