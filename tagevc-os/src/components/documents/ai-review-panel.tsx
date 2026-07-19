'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  acceptAiSuggestionAction,
  dismissAiSuggestionAction,
  editAiSuggestionAction,
  rerunAiReviewAction,
} from '@/app/(app)/documents/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/lib/format';
import type {
  AiSuggestionStatus,
  DocumentAiReview,
  DocumentAiSuggestion,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<AiSuggestionStatus, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-950',
  edited: 'border-sky-200 bg-sky-50 text-sky-950',
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  dismissed: 'border-border bg-muted text-muted-foreground',
};

export function AiReviewPanel({
  docId,
  review,
}: {
  docId: string;
  review: DocumentAiReview | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">AI document intelligence</CardTitle>
          <CardDescription>
            Upload → review → Shared Services action. Engine is swappable
            (heuristic_v1 today; LLM later).
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await rerunAiReviewAction(docId);
              if (!res.ok) alert(res.error);
              router.refresh();
            })
          }
        >
          {review ? 'Re-run review' : 'Run AI review'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!review ? (
          <p className="text-sm text-muted-foreground">
            No AI review yet. Run review to extract expirations, renewals, and
            follow-ups.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">AI-generated</Badge>
              <Badge variant="outline">{review.engine}</Badge>
              <Badge variant="outline">{review.confidence}% confidence</Badge>
              {review.time_sensitive ? (
                <Badge
                  variant="outline"
                  className="border-amber-200 bg-amber-50 text-amber-950"
                >
                  Time-sensitive
                </Badge>
              ) : null}
            </div>
            <p className="text-sm">{review.summary}</p>
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <Meta label="Reviewed" value={formatDate(review.reviewed_at)} />
              <Meta
                label="Expiration"
                value={formatDate(review.expiration_date)}
              />
              <Meta label="Renewal" value={formatDate(review.renewal_date)} />
            </div>
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Suggestions ({review.suggestions.length})
              </p>
              {review.suggestions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No follow-up suggestions.
                </p>
              ) : (
                review.suggestions.map((s) => (
                  <SuggestionRow
                    key={s.suggestion_id}
                    docId={docId}
                    suggestion={s}
                    disabled={pending}
                    onBusy={start}
                    onDone={() => router.refresh()}
                  />
                ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function SuggestionRow({
  docId,
  suggestion,
  disabled,
  onBusy,
  onDone,
}: {
  docId: string;
  suggestion: DocumentAiSuggestion;
  disabled: boolean;
  onBusy: (fn: () => Promise<void>) => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(suggestion.title);
  const [dueDate, setDueDate] = useState(suggestion.due_date ?? '');
  const open =
    suggestion.status === 'pending' || suggestion.status === 'edited';

  return (
    <div className="space-y-3 rounded-md border border-border px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={cn(STATUS_STYLE[suggestion.status])}
        >
          {suggestion.status}
        </Badge>
        <Badge variant="secondary">AI-generated</Badge>
        <Badge variant="outline">{suggestion.kind}</Badge>
        <Badge variant="outline">{suggestion.service}</Badge>
        <Badge variant="outline">{suggestion.priority}</Badge>
        {suggestion.ticket_id ? (
          <Link
            href={`/shared-services/tickets/${suggestion.ticket_id}`}
            className="text-xs font-medium underline-offset-4 hover:underline"
          >
            {suggestion.ticket_id}
          </Link>
        ) : null}
      </div>

      {open ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`title-${suggestion.suggestion_id}`}>Title</Label>
            <Input
              id={`title-${suggestion.suggestion_id}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`due-${suggestion.suggestion_id}`}>Due date</Label>
            <Input
              id={`due-${suggestion.suggestion_id}`}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="flex items-end text-xs text-muted-foreground">
            {suggestion.description}
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-sm font-medium">{suggestion.title}</p>
          <p className="text-xs text-muted-foreground">
            {suggestion.description}
          </p>
          <p className="text-xs text-muted-foreground">
            Due {formatDate(suggestion.due_date)}
          </p>
        </div>
      )}

      {open ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled}
            onClick={() =>
              onBusy(async () => {
                const res = await acceptAiSuggestionAction(
                  docId,
                  suggestion.suggestion_id,
                  {
                    title: title.trim() || suggestion.title,
                    due_date: dueDate || undefined,
                  },
                );
                if (!res.ok) alert(res.error);
                onDone();
              })
            }
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onBusy(async () => {
                const res = await editAiSuggestionAction(
                  docId,
                  suggestion.suggestion_id,
                  {
                    title: title.trim() || suggestion.title,
                    due_date: dueDate || undefined,
                  },
                );
                if (!res.ok) alert(res.error);
                onDone();
              })
            }
          >
            Save edits
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() =>
              onBusy(async () => {
                const res = await dismissAiSuggestionAction(
                  docId,
                  suggestion.suggestion_id,
                );
                if (!res.ok) alert(res.error);
                onDone();
              })
            }
          >
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}
