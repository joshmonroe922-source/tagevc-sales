'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  generateL10Action,
  saveL10NotesAction,
} from '@/app/(app)/eos/l10-actions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { L10Meeting } from '@/lib/eos/l10-meetings';

export function L10MeetingsPanel({
  current,
  previous,
  entityId,
  canGenerate,
}: {
  current: L10Meeting | null;
  previous: L10Meeting[];
  entityId: string;
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(current?.notes_body ?? '');
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(current?.id ?? null);

  const active =
    previous.find((m) => m.id === activeId) ??
    (current?.id === activeId ? current : current);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Weekly L10 (this team)</CardTitle>
        <CardDescription>
          Per meeting owner/team — auto-filled from live EOS. Save notes back to
          the directory; download/print Word anytime. Not one company-wide
          meeting.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {canGenerate ? (
            <Button
              type="button"
              size="sm"
              disabled={pending || !entityId}
              onClick={() =>
                start(async () => {
                  const res = await generateL10Action(entityId);
                  setMessage(res.ok ? 'This week’s L10 ready' : res.error);
                  if (res.ok && res.meetingId) setActiveId(res.meetingId);
                  router.refresh();
                })
              }
            >
              {pending ? 'Working…' : 'Generate this week’s L10'}
            </Button>
          ) : null}
          {active ? (
            <a
              className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
              href={`/api/eos/l10/${active.id}/download`}
            >
              Download / print Word
            </a>
          ) : null}
        </div>

        {previous.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Previous weeks
            </p>
            <div className="flex flex-wrap gap-1.5">
              {previous.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`rounded-md border px-2 py-1 text-xs ${
                    m.id === active?.id
                      ? 'border-[#3a414f] bg-[#3a414f] text-white'
                      : 'border-border hover:bg-muted'
                  }`}
                  onClick={() => {
                    setActiveId(m.id);
                    setNotes(m.notes_body);
                  }}
                >
                  {m.week_key}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {active ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-[#3a414f]">{active.title}</p>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={14}
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await saveL10NotesAction({
                      id: active.id,
                      notesBody: notes,
                    });
                    setMessage(
                      res.ok
                        ? 'Saved to meeting + Document Library'
                        : res.error,
                    );
                    router.refresh();
                  })
                }
              >
                Save notes
              </Button>
              {active.document_id ? (
                <Link
                  href="/documents"
                  className="text-xs text-muted-foreground underline"
                >
                  Open Document Library
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No L10 for this week yet — generate to pull rocks, scorecard, IDS,
            and to-dos for your team subtree.
          </p>
        )}

        {message ? (
          <p className="text-xs text-muted-foreground">{message}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
