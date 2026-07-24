'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  createFromTemplateAction,
  type DocActionResult,
} from '@/app/(app)/documents/actions';
import { CompanySelect } from '@/components/shared/company-select';
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
import type { DocTemplate, Entity } from '@/lib/types';
import { isCapitalDocument } from '@/lib/documents/capital-gate';

export function CreateFromTemplateForm({
  entities,
  templates,
  defaultEntityId,
}: {
  entities: Entity[];
  templates: DocTemplate[];
  defaultEntityId?: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<
    DocActionResult | null,
    FormData
  >(createFromTemplateAction, null);

  useEffect(() => {
    if (state?.ok && state.docId) {
      router.push(`/documents/${state.docId}`);
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New from template</CardTitle>
        <CardDescription>
          Merge entity/deal fields. Capital docs (TS/SPA/PSA/wire) stay Ready to
          Send until a human clicks Send.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="template_id">Template</Label>
            <select
              id="template_id"
              name="template_id"
              required
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              defaultValue={templates[0]?.template_id}
            >
              {templates.map((t) => (
                <option key={t.template_id} value={t.template_id}>
                  {t.name}
                  {isCapitalDocument(t.doc_type) ? ' · capital' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entity_id">Company</Label>
            <CompanySelect
              id="entity_id"
              name="entity_id"
              required
              defaultValue={defaultEntityId ?? entities[0]?.entity_id}
              options={entities.map((e) => ({
                value: e.entity_id,
                label: e.canonical_name,
              }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signatory_name">Signatory name</Label>
            <Input id="signatory_name" name="signatory_name" defaultValue="Alex Founder" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signatory_email">Signatory email</Label>
            <Input
              id="signatory_email"
              name="signatory_email"
              type="email"
              defaultValue="alex@example.com"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="deal_id">Deal ID (optional)</Label>
            <Input id="deal_id" name="deal_id" placeholder="DE-001" />
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Merging…' : 'Create draft'}
            </Button>
            {state && !state.ok ? (
              <p className="text-sm text-destructive">{state.error}</p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
