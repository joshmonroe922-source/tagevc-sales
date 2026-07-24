'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  refreshTemplateRecipientsAction,
  sendFromTemplateRolesAction,
} from '@/app/(app)/shared-services/legal/docusign/actions';
import { CompanySelect } from '@/components/shared/company-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CachedDocuSignTemplate } from '@/lib/docusign/templates';

type RoleDraft = { roleName: string; email: string; name: string };

export function DocuSignTemplateSendForm({
  templates,
  canWrite,
}: {
  templates: CachedDocuSignTemplate[];
  canWrite: boolean;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.template_id ?? '');
  const [subject, setSubject] = useState('Please sign');
  const [entityId, setEntityId] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [roleList, setRoleList] = useState<string[]>(
    () => templates[0]?.roles ?? ['Signer'],
  );

  const selected = useMemo(
    () => templates.find((t) => t.template_id === templateId) ?? null,
    [templates, templateId],
  );

  const [roles, setRoles] = useState<RoleDraft[]>(() =>
    (templates[0]?.roles ?? ['Signer']).map((roleName) => ({
      roleName,
      email: '',
      name: '',
    })),
  );

  function applyRoleNames(names: string[]) {
    setRoleList(names);
    setRoles(
      names.map((roleName) => ({
        roleName,
        email: '',
        name: '',
      })),
    );
  }

  function onSelectTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.template_id === id);
    applyRoleNames(t?.roles ?? ['Signer']);
  }

  if (!canWrite) return null;
  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Refresh templates to enable role mapping send.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border/60 p-3">
      <p className="text-sm font-medium">Send from template (role mapping)</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="ds-template">Template</Label>
          <select
            id="ds-template"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={templateId}
            onChange={(e) => onSelectTemplate(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.template_id} value={t.template_id}>
                {t.name}
              </option>
            ))}
          </select>
          {selected ? (
            <p className="text-xs text-muted-foreground font-mono">
              {selected.template_id}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor="ds-subject">Email subject</Label>
          <Input
            id="ds-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ds-entity">Company (blank for firm-wide send)</Label>
        <CompanySelect
          id="ds-entity"
          value={entityId}
          onChange={setEntityId}
          allowAll
          allLabel="Firm-wide send"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !templateId}
          onClick={() => {
            setFlash(null);
            setErr(null);
            startTransition(async () => {
              const res = await refreshTemplateRecipientsAction(templateId);
              if (!res.ok) {
                setErr(res.error);
                return;
              }
              setFlash(res.message ?? 'Roles refreshed');
              const match = res.message?.match(/roles:\s*(.+)$/i);
              if (match) {
                applyRoleNames(
                  match[1]
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                );
              }
            });
          }}
        >
          Live refresh roles
        </Button>
        <span className="text-xs text-muted-foreground self-center">
          Cached roles: {roleList.join(', ')}
        </span>
      </div>

      <div className="space-y-2">
        {roles.map((r, i) => (
          <div
            key={`${r.roleName}-${i}`}
            className="grid gap-2 sm:grid-cols-3 items-end"
          >
            <div className="space-y-1">
              <Label>Role</Label>
              <Input
                value={r.roleName}
                onChange={(e) => {
                  const next = [...roles];
                  next[i] = { ...next[i], roleName: e.target.value };
                  setRoles(next);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                type="email"
                value={r.email}
                onChange={(e) => {
                  const next = [...roles];
                  next[i] = { ...next[i], email: e.target.value };
                  setRoles(next);
                }}
                placeholder="signer@example.com"
              />
            </div>
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={r.name}
                onChange={(e) => {
                  const next = [...roles];
                  next[i] = { ...next[i], name: e.target.value };
                  setRoles(next);
                }}
                placeholder="Optional"
              />
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          setFlash(null);
          setErr(null);
          startTransition(async () => {
            const res = await sendFromTemplateRolesAction({
              requestId,
              templateId,
              entityId: entityId.trim() || null,
              emailSubject: subject,
              roles: roles.map((r) => ({
                roleName: r.roleName,
                email: r.email,
                name: r.name || r.email,
              })),
              scheduleReminders: true,
            });
            if (res.ok) {
              setFlash(res.message ?? 'Sent');
              setRequestId(crypto.randomUUID());
            }
            else setErr(res.error);
          });
        }}
      >
        {pending ? 'Sending…' : 'Send with role map'}
      </Button>
      {(flash || err) && (
        <p className={`text-sm ${err ? 'text-destructive' : 'text-emerald-700'}`}>
          {err ?? flash}
        </p>
      )}
    </div>
  );
}
