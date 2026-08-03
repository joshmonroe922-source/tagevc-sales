'use client';

import { useCallback, useMemo, useTransition } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

type ChartNode = { id: string; full_name: string; title: string | null };
type ChartEdge = {
  id: string;
  manager_contact_id: string;
  report_contact_id: string;
  status: string;
  confidence: number | null;
  rationale: string | null;
};

function PersonNode({ data }: NodeProps) {
  const d = data as { label: string; title: string | null };
  return (
    <div className="min-w-[140px] rounded-md border border-border bg-background px-3 py-2 text-xs shadow-sm">
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="font-semibold">{d.label}</div>
      {d.title ? (
        <div className="text-muted-foreground">{d.title}</div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}

const nodeTypes = { person: PersonNode };

function layout(nodes: ChartNode[], edges: ChartEdge[]): {
  flowNodes: Node[];
  flowEdges: Edge[];
} {
  const children = new Map<string, string[]>();
  const reports = new Set(edges.map((e) => e.report_contact_id));
  for (const e of edges) {
    const list = children.get(e.manager_contact_id) || [];
    list.push(e.report_contact_id);
    children.set(e.manager_contact_id, list);
  }
  const roots = nodes.filter((n) => !reports.has(n.id));
  const placed = new Map<string, { x: number; y: number }>();
  let cursor = 0;

  function place(id: string, depth: number) {
    if (placed.has(id)) return;
    const kids = children.get(id) || [];
    if (!kids.length) {
      placed.set(id, { x: cursor * 200, y: depth * 110 });
      cursor += 1;
      return;
    }
    const start = cursor;
    for (const k of kids) place(k, depth + 1);
    const end = cursor;
    const mid = ((start + end - 1) / 2) * 200;
    placed.set(id, { x: mid, y: depth * 110 });
  }

  for (const r of roots.length ? roots : nodes.slice(0, 1)) {
    place(r.id, 0);
  }
  for (const n of nodes) {
    if (!placed.has(n.id)) {
      placed.set(n.id, { x: cursor * 200, y: 0 });
      cursor += 1;
    }
  }

  return {
    flowNodes: nodes.map((n) => ({
      id: n.id,
      type: 'person',
      position: placed.get(n.id) || { x: 0, y: 0 },
      data: { label: n.full_name, title: n.title },
    })),
    flowEdges: edges.map((e) => ({
      id: e.id,
      source: e.manager_contact_id,
      target: e.report_contact_id,
      animated: e.status === 'suggested',
      style: {
        strokeDasharray: e.status === 'suggested' ? '6 4' : undefined,
        stroke: e.status === 'confirmed' ? '#1B2838' : '#94a3b8',
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      label:
        e.status === 'suggested' && e.confidence != null
          ? `${e.confidence.toFixed(2)}`
          : undefined,
    })),
  };
}

export function OrgChartFlow(props: {
  accountId: string;
  nodes: ChartNode[];
  edges: ChartEdge[];
  suggestAction: (
    accountId: string,
  ) => Promise<{ ok: true; created: number } | { ok: false; error: string }>;
  edgeAction: (
    edgeId: string,
    status: 'confirmed' | 'rejected',
    accountId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  dragAction: (
    accountId: string,
    managerContactId: string,
    reportContactId: string,
  ) => Promise<{ ok: true; edgeId: string } | { ok: false; error: string }>;
}) {
  const [pending, start] = useTransition();
  const initial = useMemo(
    () => layout(props.nodes, props.edges),
    [props.nodes, props.edges],
  );
  const [nodes, , onNodesChange] = useNodesState(initial.flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.flowEdges);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      start(async () => {
        const res = await props.dragAction(props.accountId, c.source!, c.target!);
        if (res.ok) {
          setEdges((eds) => [
            ...eds,
            {
              id: res.edgeId,
              source: c.source!,
              target: c.target!,
              style: { stroke: '#1B2838' },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 16,
                height: 16,
              },
            },
          ]);
        }
      });
    },
    [props, setEdges],
  );

  const suggested = props.edges.filter((e) => e.status === 'suggested');

  return (
    <section className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">
          Org chart ({props.edges.length} edges)
        </h2>
        <button
          type="button"
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          onClick={() => start(() => void props.suggestAction(props.accountId))}
        >
          {pending ? 'Running…' : 'Suggest hierarchy'}
        </button>
      </div>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        Solid = confirmed · Dashed = suggested. Drag from manager → report to
        confirm. Accept/reject never auto-confirms.
      </p>
      <div className="h-[420px] w-full">
        {props.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No people yet — add people, then Suggest hierarchy.
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        )}
      </div>
      {suggested.length > 0 ? (
        <ul className="divide-y divide-border border-t border-border text-sm">
          {suggested.map((e) => {
            const mgr = props.nodes.find((n) => n.id === e.manager_contact_id);
            const rep = props.nodes.find((n) => n.id === e.report_contact_id);
            return (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
              >
                <span>
                  {rep?.full_name || 'Report'} → {mgr?.full_name || 'Manager'}
                  <span className="ml-2 text-xs text-muted-foreground">
                    suggested
                    {e.confidence != null
                      ? ` · ${Number(e.confidence).toFixed(2)}`
                      : ''}
                  </span>
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs"
                    disabled={pending}
                    onClick={() =>
                      start(() =>
                        void props.edgeAction(
                          e.id,
                          'confirmed',
                          props.accountId,
                        ),
                      )
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-xs"
                    disabled={pending}
                    onClick={() =>
                      start(() =>
                        void props.edgeAction(
                          e.id,
                          'rejected',
                          props.accountId,
                        ),
                      )
                    }
                  >
                    Reject
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
