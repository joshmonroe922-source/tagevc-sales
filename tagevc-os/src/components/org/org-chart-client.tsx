'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, MessageSquare, User } from 'lucide-react';
import { updateOrgProfileAction } from '@/app/(app)/admin/org-chart/actions';
import { startDirectMessageAction } from '@/app/(app)/messages/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { entityDisplayName } from '@/lib/entities/display-name';
import type { OrgTreeNode } from '@/lib/org/tree';
import { cn } from '@/lib/utils';

type Props = {
  forest: OrgTreeNode[];
  canEdit: boolean;
  isConsolidated: boolean;
  scope: string;
  scopeOptions?: Array<{ value: string; label: string }>;
  basePath?: string;
  messageHref?: (userId: string) => string;
};

function NodeCard({
  node,
  canEdit,
  depth,
  onZoom,
  onMessage,
  editingId,
  setEditingId,
}: {
  node: OrgTreeNode;
  canEdit: boolean;
  depth: number;
  onZoom: (id: string) => void;
  onMessage: (id: string) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(node.job_title ?? '');
  const [managerId, setManagerId] = useState(node.manager_profile_id ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const editing = editingId === node.id;

  return (
    <li className="relative">
      <div
        className={cn(
          'rounded-lg border border-border bg-background px-3 py-2 shadow-sm',
          depth === 0 && 'border-[#3a414f]/40',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <button
            type="button"
            className="min-w-0 text-left hover:opacity-90"
            onClick={() => onZoom(node.id)}
            title="Zoom to subtree"
          >
            <p className="truncate text-sm font-semibold text-[#3a414f]">
              {node.full_name || node.email}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {node.job_title || 'No title'}
              {node.entity_id
                ? ` · ${entityDisplayName(node.entity_id)}`
                : ''}
            </p>
          </button>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => onMessage(node.id)}
              title="Message"
            >
              <MessageSquare className="size-3.5" />
            </Button>
            {canEdit ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => setEditingId(editing ? null : node.id)}
              >
                {editing ? 'Close' : 'Edit'}
              </Button>
            ) : null}
          </div>
        </div>
        {editing ? (
          <div className="mt-2 space-y-2 border-t border-border pt-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Job title"
              className="h-8 text-xs"
            />
            <Input
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              placeholder="Reports-to profile UUID"
              className="h-8 font-mono text-[11px]"
            />
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await updateOrgProfileAction({
                    profileId: node.id,
                    jobTitle: title,
                    managerProfileId: managerId.trim() || null,
                  });
                  setMsg(res.ok ? 'Saved' : res.error);
                  if (res.ok) {
                    setEditingId(null);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? 'Saving…' : 'Save reports-to'}
            </Button>
            {msg ? (
              <p className="text-[11px] text-muted-foreground">{msg}</p>
            ) : null}
          </div>
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <ul className="mt-3 ml-4 space-y-3 border-l border-border pl-4">
          {node.children.map((c) => (
            <NodeCard
              key={c.id}
              node={c}
              canEdit={canEdit}
              depth={depth + 1}
              onZoom={onZoom}
              onMessage={onMessage}
              editingId={editingId}
              setEditingId={setEditingId}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function OrgChartClient({
  forest,
  canEdit,
  isConsolidated,
  scope,
  scopeOptions,
  basePath = '/admin/org-chart',
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const zoom = searchParams.get('zoom');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const heading = useMemo(() => {
    if (zoom && forest[0]) {
      return `Subtree · ${forest[0].full_name || forest[0].email}`;
    }
    return isConsolidated
      ? 'Consolidated org chart'
      : `Org chart · ${entityDisplayName(scope)}`;
  }, [forest, isConsolidated, scope, zoom]);

  const setScope = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === 'all') params.delete('entity');
    else params.set('entity', value);
    params.delete('zoom');
    router.push(`${basePath}?${params.toString()}`);
  };

  const zoomTo = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('zoom', id);
    router.push(`${basePath}?${params.toString()}`);
  };

  const clearZoom = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('zoom');
    router.push(`${basePath}?${params.toString()}`);
  };

  const message = (userId: string) => {
    start(async () => {
      const res = await startDirectMessageAction(userId);
      if (res.ok) router.push(`/messages?c=${res.conversationId}`);
      else router.push('/messages');
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Admin · Org Chart
          </p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-[#3a414f]">
            {heading}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Name + title. Click a person to zoom into their subtree. Message
            opens the existing Message Center — no second chat.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {zoom ? (
            <Button type="button" variant="outline" size="sm" onClick={clearZoom}>
              <ArrowLeft className="mr-1 size-3.5" />
              Back to whole view
            </Button>
          ) : null}
          {canEdit ? (
            <Badge variant="secondary">Admin/HR edit</Badge>
          ) : (
            <Badge variant="outline">View only</Badge>
          )}
        </div>
      </div>

      {scopeOptions && scopeOptions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {scopeOptions.map((o) => (
            <Button
              key={o.value}
              type="button"
              size="sm"
              variant={
                (o.value === 'all' && isConsolidated) || o.value === scope
                  ? 'default'
                  : 'outline'
              }
              className={
                (o.value === 'all' && isConsolidated) || o.value === scope
                  ? 'bg-[#3a414f] text-white hover:bg-[#535c63]'
                  : undefined
              }
              onClick={() => setScope(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      ) : null}

      {forest.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          <User className="mx-auto mb-2 size-6 opacity-40" />
          No people in this view yet. Set Reports to + title on hire / Admin.
        </div>
      ) : (
        <ul className="space-y-4">
          {forest.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              canEdit={canEdit}
              depth={0}
              onZoom={zoomTo}
              onMessage={message}
              editingId={editingId}
              setEditingId={setEditingId}
            />
          ))}
        </ul>
      )}
      {pending ? (
        <p className="text-xs text-muted-foreground">Opening Message Center…</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        <Link href="/messages" className="underline">
          Open Message Center directory
        </Link>
      </p>
    </div>
  );
}
