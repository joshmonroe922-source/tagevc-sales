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
import { listEntities } from '@/lib/data/repositories';
import { listTemplates } from '@/lib/data/document-store';
import { listScopedDocuments } from '@/lib/data/pipeline-scope';
import { isCapitalDocument } from '@/lib/documents/capital-gate';
import { FIRM_FOLDERS } from '@/lib/documents/library';
import { ENTITY_DOC_FOLDERS } from '@/lib/types/enums';

export default async function DocumentsPage() {
  const [entities, docs, templates] = await Promise.all([
    listEntities(),
    listScopedDocuments(),
    Promise.resolve(listTemplates()),
  ]);
  const subs = entities.filter((e) => e.entity_type !== 'Firm');

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Document Library
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Company files and signing workflows. Capital documents always need a
          human to send.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {subs.map((e) => (
          <Link key={e.entity_id} href={`/documents/entities/${e.entity_id}`}>
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardHeader>
                <CardTitle className="text-base">{e.canonical_name}</CardTitle>
                <CardDescription>
                  {docs.filter((d) => d.entity_id === e.entity_id).length}{' '}
                  documents
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Folder structure</CardTitle>
          <CardDescription>
            Each company has standard folders (corporate through signed). Firm
            paths: {FIRM_FOLDERS.join(', ')}
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="flex flex-wrap gap-2">
        {ENTITY_DOC_FOLDERS.map((f) => (
          <Badge key={f} variant="outline">
            {f}
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
                <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground">
                  {d.library_path}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CreateFromTemplateForm entities={subs} templates={templates} />
        <UploadDocumentForm entities={subs} />
      </div>
    </div>
  );
}
