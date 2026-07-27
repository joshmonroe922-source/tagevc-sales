'use client';

import { useActionState } from 'react';
import {
  updateDocumentVisibilityAction,
  type DocActionResult,
} from '@/app/(app)/documents/actions';
import { DocumentVisibilityFields } from '@/components/documents/document-visibility-fields';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatVisibleRolesLabel } from '@/lib/documents/visibility';
import type { AppRole } from '@/lib/types/roles';

export function DocumentAclEditor({
  docId,
  effectiveRoles,
  storedRoles,
}: {
  docId: string;
  effectiveRoles: readonly AppRole[] | null;
  storedRoles: AppRole[] | null;
}) {
  const [state, action, pending] = useActionState<
    DocActionResult | null,
    FormData
  >(updateDocumentVisibilityAction, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Role access</CardTitle>
        <CardDescription>
          Effective now:{' '}
          <span className="font-medium text-foreground">
            {formatVisibleRolesLabel(effectiveRoles)}
          </span>
          {storedRoles == null
            ? ' (inheriting folder default)'
            : storedRoles.length === 0
              ? ' (explicitly open)'
              : ''}
          . Visionary / Admin set who else can open this file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-3">
          <input type="hidden" name="doc_id" value={docId} />
          <DocumentVisibilityFields defaultRoles={storedRoles} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending} name="mode" value="set">
              {pending ? 'Saving…' : 'Save role ACL'}
            </Button>
            <Button
              type="submit"
              variant="outline"
              disabled={pending}
              name="mode"
              value="inherit"
            >
              Reset to folder default
            </Button>
            <Button
              type="submit"
              variant="outline"
              disabled={pending}
              name="mode"
              value="open"
            >
              Make open to all roles
            </Button>
          </div>
          {state && !state.ok ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
          {state?.ok && state.message ? (
            <p className="text-sm text-muted-foreground">{state.message}</p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
