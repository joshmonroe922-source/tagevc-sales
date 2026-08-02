'use client';

import { useState, useTransition } from 'react';
import { actionSendLibraryDocuSign } from '@/app/(app)/shared-services/legal/docusign/library-send-actions';
import { CompanySelect } from '@/components/shared/company-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function DocuSignLibrarySendForm({
  canWrite,
  defaultEntityId = '',
}: {
  canWrite: boolean;
  defaultEntityId?: string;
}) {
  const [entityId, setEntityId] = useState(defaultEntityId);
  const [confirm, setConfirm] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canWrite) return null;

  return (
    <div className="space-y-3 rounded-md border border-border/60 p-3">
      <p className="text-sm font-medium">Send from library (autofill + confirm)</p>
      <p className="text-xs text-muted-foreground">
        Human confirmation required. Autofill merges employee/vendor fields into
        the envelope body; Connect returns signed PDF to library.
      </p>
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setFlash(null);
          setErr(null);
          start(async () => {
            const r = await actionSendLibraryDocuSign({
              entityId: entityId || String(fd.get('entityId') || 'ENT-FIRM'),
              docId: String(fd.get('docId') || ''),
              emailSubject: String(fd.get('subject') || ''),
              content: String(fd.get('content') || ''),
              signerName: String(fd.get('signerName') || ''),
              signerEmail: String(fd.get('signerEmail') || ''),
              confirm,
              autofillKind: 'generic',
              autofillFields: {
                FullName: String(fd.get('signerName') || ''),
                Email: String(fd.get('signerEmail') || ''),
                Company: String(fd.get('company') || ''),
                Title: String(fd.get('title') || ''),
              },
            });
            if (r.ok) {
              setFlash(`Sent ${r.envelopeId} (${r.mode})`);
              setConfirm(false);
            } else {
              setErr(r.error);
            }
          });
        }}
      >
        <div className="space-y-1 sm:col-span-2">
          <Label>Company / entity</Label>
          <CompanySelect value={entityId} onChange={setEntityId} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lib-doc">Document ID</Label>
          <Input id="lib-doc" name="docId" required placeholder="DOC-…" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lib-subject">Subject</Label>
          <Input
            id="lib-subject"
            name="subject"
            required
            defaultValue="Please sign"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lib-name">Signer name</Label>
          <Input id="lib-name" name="signerName" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lib-email">Signer email</Label>
          <Input id="lib-email" name="signerEmail" type="email" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lib-company">Company (autofill)</Label>
          <Input id="lib-company" name="company" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lib-title">Title (autofill)</Label>
          <Input id="lib-title" name="title" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="lib-content">Document body</Label>
          <textarea
            id="lib-content"
            name="content"
            required
            rows={5}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Paste agreement text or library excerpt…"
          />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          I confirm this send (required — no silent DocuSign)
        </label>
        <Button
          type="submit"
          disabled={pending || !confirm}
          className="sm:col-span-2"
        >
          {pending ? 'Sending…' : 'Send for signature'}
        </Button>
      </form>
      {flash ? (
        <p className="text-xs text-emerald-700">{flash}</p>
      ) : null}
      {err ? <p className="text-xs text-red-600">{err}</p> : null}
    </div>
  );
}
