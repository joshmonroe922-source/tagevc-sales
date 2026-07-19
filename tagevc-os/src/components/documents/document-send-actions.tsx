'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  sendDocumentAction,
  simulateWebhookAction,
} from '@/app/(app)/documents/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isCapitalDocument } from '@/lib/documents/capital-gate';
import type { DocType } from '@/lib/types';

export function DocumentSendActions({
  docId,
  docType,
  status,
}: {
  docId: string;
  docType: DocType;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sentBy, setSentBy] = useState('Counsel');
  const capital = isCapitalDocument(docType);
  const canSend = status === 'Ready to Send' || status === 'Draft';
  const canSimulate =
    status === 'Sent' || status === 'Delivered' || status === 'Signed';

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      {capital ? (
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Capital document — human Click Send required (never silent / never
          agent AUTO). Aligns with forbid-list{' '}
          <code>docusign_capital_send</code>.
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="sent_by">Sender (human)</Label>
          <Input
            id="sent_by"
            value={sentBy}
            onChange={(e) => setSentBy(e.target.value)}
            className="w-48"
          />
        </div>
        <Button
          disabled={!canSend || pending || !sentBy.trim()}
          onClick={() =>
            start(async () => {
              const res = await sendDocumentAction(docId, sentBy);
              if (!res.ok) alert(res.error);
              router.refresh();
            })
          }
        >
          {pending ? 'Sending…' : 'Send via DocuSign'}
        </Button>
        <Button
          variant="outline"
          disabled={!canSimulate || pending}
          onClick={() =>
            start(async () => {
              const res = await simulateWebhookAction(docId);
              if (!res.ok) alert(res.error);
              router.refresh();
            })
          }
        >
          Simulate webhook → Completed
        </Button>
      </div>
    </div>
  );
}
