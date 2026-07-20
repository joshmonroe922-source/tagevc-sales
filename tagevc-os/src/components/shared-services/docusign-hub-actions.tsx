'use client';

import { useState, useTransition } from 'react';
import {
  backfillSignedStorageAction,
  emailCocAction,
  remindEnvelopeAction,
  runReminderWorkerAction,
  scheduleRemindersAction,
  sendFromTemplateAction,
  syncTemplatesAction,
  voidEnvelopeAction,
} from '@/app/(app)/shared-services/legal/docusign/actions';
import { Button } from '@/components/ui/button';

export function DocuSignHubActions({ canWrite }: { canWrite: boolean }) {
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canWrite) return null;

  function run(
    fn: () => Promise<
      { ok: true; message?: string } | { ok: false; error: string }
    >,
  ) {
    setFlash(null);
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) setFlash(res.message ?? 'Done');
      else setErr(res.error);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const templateId = window.prompt('Template ID:');
            if (!templateId?.trim()) return;
            const email = window.prompt('Signer email:');
            if (!email?.trim()) return;
            const name = window.prompt('Signer name:', email) || email;
            const subject =
              window.prompt('Email subject:', 'Please sign') || 'Please sign';
            const role =
              window.prompt('Template role name:', 'Signer') || 'Signer';
            run(() =>
              sendFromTemplateAction({
                templateId: templateId.trim(),
                emailSubject: subject,
                signerEmail: email.trim(),
                signerName: name.trim(),
                roleName: role.trim(),
                scheduleReminders: true,
              }),
            );
          }}
        >
          Quick send (1 role)
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const envelopeId = window.prompt('Envelope ID to email CoC:');
            if (!envelopeId?.trim()) return;
            run(() => emailCocAction(envelopeId.trim()));
          }}
        >
          Email CoC
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const envelopeId = window.prompt('Envelope ID to remind now:');
            if (!envelopeId?.trim()) return;
            run(() => remindEnvelopeAction(envelopeId.trim()));
          }}
        >
          Send reminder
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const envelopeId = window.prompt(
              'Envelope ID to schedule +1/+3/+7d reminders:',
            );
            if (!envelopeId?.trim()) return;
            run(() => scheduleRemindersAction(envelopeId.trim()));
          }}
        >
          Schedule reminders
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => runReminderWorkerAction())}
        >
          Run reminder worker
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const envelopeId = window.prompt('Envelope ID to void:');
            if (!envelopeId?.trim()) return;
            const reason =
              window.prompt('Void reason:', 'Voided via Tage VC OS') ||
              'Voided via Tage VC OS';
            run(() => voidEnvelopeAction(envelopeId.trim(), reason));
          }}
        >
          Void envelope
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => syncTemplatesAction())}
        >
          Refresh templates
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => backfillSignedStorageAction())}
        >
          Backfill Storage
        </Button>
      </div>
      {(flash || err) && (
        <p className={`text-sm ${err ? 'text-destructive' : 'text-emerald-700'}`}>
          {err ?? flash}
        </p>
      )}
    </div>
  );
}
