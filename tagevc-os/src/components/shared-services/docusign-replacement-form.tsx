'use client';

import { useMemo, useState, useTransition } from 'react';
import { createReplacementEnvelopeAction } from '@/app/(app)/shared-services/legal/docusign/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CachedDocuSignTemplate } from '@/lib/docusign/templates';

type RoleDraft = { roleName: string; email: string; name: string };

export function DocuSignReplacementForm({
  templates,
  voidedEnvelopeIds,
  canWrite,
}: {
  templates: CachedDocuSignTemplate[];
  voidedEnvelopeIds: string[];
  canWrite: boolean;
}) {
  const [templateId, setTemplateId] = useState('');
  const [roles, setRoles] = useState<RoleDraft[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const selected = useMemo(
    () => templates.find((template) => template.template_id === templateId),
    [templateId, templates],
  );
  if (!canWrite) return null;

  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setMessage(null);
        startTransition(async () => {
          const result = await createReplacementEnvelopeAction({
            requestId,
            sourceEnvelopeId: String(form.get('source_envelope_id') ?? ''),
            templateId,
            emailSubject: String(form.get('email_subject') ?? ''),
            reason: String(form.get('reason') ?? ''),
            roles,
          });
          setMessage(result.ok ? result.message ?? 'Replacement sent' : result.error);
          if (
            result.ok ||
            (!result.error.includes('recovery is pending') &&
              !result.error.includes('outcome unknown'))
          ) {
            setRequestId(crypto.randomUUID());
          }
        });
      }}
    >
      <h2 className="text-sm font-semibold">Multi-role replacement</h2>
      <p className="text-xs text-muted-foreground">
        Only voided envelopes are eligible. Durable intent prevents duplicate
        active replacements for the same source.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          name="source_envelope_id"
          required
          defaultValue=""
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">Voided source envelope</option>
          {voidedEnvelopeIds.map((id) => (
            <option value={id} key={id}>
              {id}
            </option>
          ))}
        </select>
        <select
          required
          value={templateId}
          onChange={(event) => {
            const nextId = event.target.value;
            setTemplateId(nextId);
            const template = templates.find(
              (candidate) => candidate.template_id === nextId,
            );
            setRoles(
              (template?.roles ?? []).map((roleName) => ({
                roleName,
                email: '',
                name: '',
              })),
            );
          }}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">Replacement template</option>
          {templates.map((template) => (
            <option value={template.template_id} key={template.template_id}>
              {template.name}
            </option>
          ))}
        </select>
      </div>
      <Input
        name="email_subject"
        required
        placeholder="Replacement signature request"
      />
      <Input name="reason" required placeholder="Replacement reason / reference" />
      {selected && roles.length === 0 ? (
        <p className="text-xs text-destructive">
          Template roles are unavailable; refresh this template before sending.
        </p>
      ) : null}
      {roles.map((role, index) => (
        <div className="grid gap-2 sm:grid-cols-3" key={`${role.roleName}-${index}`}>
          <Input value={role.roleName} readOnly aria-label="Role name" />
          <Input
            type="email"
            required
            value={role.email}
            placeholder={`${role.roleName} email`}
            onChange={(event) =>
              setRoles((current) =>
                current.map((item, roleIndex) =>
                  roleIndex === index
                    ? { ...item, email: event.target.value }
                    : item,
                ),
              )
            }
          />
          <Input
            required
            value={role.name}
            placeholder={`${role.roleName} name`}
            onChange={(event) =>
              setRoles((current) =>
                current.map((item, roleIndex) =>
                  roleIndex === index
                    ? { ...item, name: event.target.value }
                    : item,
                ),
              )
            }
          />
        </div>
      ))}
      <Button
        type="submit"
        size="sm"
        disabled={pending || !templateId || roles.length === 0}
      >
        {pending ? 'Sending replacement…' : 'Send replacement'}
      </Button>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </form>
  );
}
