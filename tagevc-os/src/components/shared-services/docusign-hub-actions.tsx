'use client';

import { useState, useTransition } from 'react';
import {
  backfillSignedStorageAction,
  voidEnvelopeAction,
} from '@/app/(app)/shared-services/legal/docusign/actions';
import { Button } from '@/components/ui/button';

export function DocuSignHubActions({ canWrite }: { canWrite: boolean }) {
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canWrite) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setFlash(null);
            setErr(null);
            const envelopeId = window.prompt('Envelope ID to void:');
            if (!envelopeId?.trim()) return;
            const reason =
              window.prompt('Void reason:', 'Voided via Tage VC OS') ||
              'Voided via Tage VC OS';
            startTransition(async () => {
              const res = await voidEnvelopeAction(envelopeId.trim(), reason);
              if (res.ok) setFlash(res.message ?? 'Voided');
              else setErr(res.error);
            });
          }}
        >
          Void envelope
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setFlash(null);
            setErr(null);
            startTransition(async () => {
              const res = await backfillSignedStorageAction();
              if (res.ok) setFlash(res.message ?? 'Done');
              else setErr(res.error);
            });
          }}
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
