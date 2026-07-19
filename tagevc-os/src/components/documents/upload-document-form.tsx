'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  uploadDocumentAction,
  type DocActionResult,
} from '@/app/(app)/documents/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FOLDER_LABELS } from '@/lib/documents/library';
import type { Entity } from '@/lib/types';
import { ENTITY_DOC_FOLDERS } from '@/lib/types/enums';

export function UploadDocumentForm({
  entities,
  defaultEntityId,
}: {
  entities: Entity[];
  defaultEntityId?: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<
    DocActionResult | null,
    FormData
  >(uploadDocumentAction, null);

  useEffect(() => {
    if (state?.ok && state.docId) {
      router.push(`/documents/${state.docId}`);
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Upload / organize</CardTitle>
        <CardDescription>
          Places a document into the entity library folder taxonomy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="entity_id">Entity</Label>
            <select
              id="entity_id"
              name="entity_id"
              required
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              defaultValue={defaultEntityId ?? entities[0]?.entity_id}
            >
              {entities.map((e) => (
                <option key={e.entity_id} value={e.entity_id}>
                  {e.canonical_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="folder">Folder</Label>
            <select
              id="folder"
              name="folder"
              required
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              defaultValue="06_Ops"
            >
              {ENTITY_DOC_FOLDERS.map((f) => (
                <option key={f} value={f}>
                  {FOLDER_LABELS[f]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              required
              placeholder="Certificate of Insurance — Instant NDA"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="content">Content (text stub)</Label>
            <textarea
              id="content"
              name="content"
              rows={5}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm"
              placeholder={`Certificate of Insurance\nExpiration: 2026-09-30\nRenewal: 2026-09-01\nInsured shall maintain continuous coverage.`}
              defaultValue=""
            />
            <p className="text-xs text-muted-foreground">
              Tip: include &quot;Expiration: YYYY-MM-DD&quot; so heuristic_v1
              creates a Shared Services follow-up ticket.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Add to library'}
            </Button>
            {state && !state.ok ? (
              <p className="mt-2 text-sm text-destructive">{state.error}</p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
