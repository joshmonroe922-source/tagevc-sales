'use client';

import { useState, useTransition } from 'react';
import { createHelpDeskTicketAction } from '@/app/(app)/help-desk/actions';
import { CompanySelect } from '@/components/shared/company-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { capturePageScreenshot } from '@/lib/help-desk/screenshot';
import { SS_SERVICES, TICKET_PRIORITIES } from '@/lib/types';

export function CreateTicketDialog({
  pathname,
  presetTitle,
  onClose,
}: {
  pathname: string;
  presetTitle?: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(presetTitle ?? '');
  const [description, setDescription] = useState('');
  const [service, setService] = useState<(typeof SS_SERVICES)[number]>('IT');
  const [priority, setPriority] = useState<(typeof TICKET_PRIORITIES)[number]>('P2');
  const [entityId, setEntityId] = useState('ENT-FIRM');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      let screenshotDataUrl: string | null = null;
      let screenshotNote: string | null = null;
      try {
        screenshotDataUrl = await capturePageScreenshot();
      } catch {
        screenshotNote = 'Screenshot capture blocked — page path recorded instead.';
      }

      const fd = new FormData();
      fd.set('title', title.trim());
      fd.set('description', description.trim());
      fd.set('service', service);
      fd.set('priority', priority);
      fd.set('entity_id', entityId);
      fd.set('page_path', pathname || '/');
      if (screenshotDataUrl) fd.set('screenshot_data_url', screenshotDataUrl);
      if (screenshotNote) fd.set('screenshot_note', screenshotNote);
      if (docFile) fd.set('document', docFile);

      const res = await createHelpDeskTicketAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOkMsg(res.message);
      setTitle('');
      setDescription('');
      setDocFile(null);
      window.setTimeout(() => onClose(), 900);
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-ticket-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-5 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="create-ticket-title"
              className="font-heading text-lg text-foreground"
            >
              Create ticket
            </h2>
            <p className="text-xs text-muted-foreground">
              Page context: {pathname}. A screenshot is attached when allowed.
            </p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="grid gap-3">
          <div className="space-y-1">
            <Label htmlFor="ct-title">Subject *</Label>
            <Input
              id="ct-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-desc">Description</Label>
            <textarea
              id="ct-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ct-service">Service</Label>
              <select
                id="ct-service"
                value={service}
                onChange={(e) =>
                  setService(e.target.value as (typeof SS_SERVICES)[number])
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {SS_SERVICES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ct-pri">Priority</Label>
              <select
                id="ct-pri"
                value={priority}
                onChange={(e) =>
                  setPriority(
                    e.target.value as (typeof TICKET_PRIORITIES)[number],
                  )
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-company">Company</Label>
            <CompanySelect
              id="ct-company"
              value={entityId}
              onChange={setEntityId}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-doc">Attach document (optional)</Label>
            <Input
              id="ct-doc"
              type="file"
              onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {okMsg ? (
            <p className="text-sm text-emerald-700">{okMsg}</p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending || title.trim().length < 3}
              onClick={submit}
            >
              {pending ? 'Submitting…' : 'Submit ticket'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
