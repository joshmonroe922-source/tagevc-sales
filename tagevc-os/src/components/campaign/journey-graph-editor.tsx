'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Handle,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  JOURNEY_NODE_META,
  journeyNodePalette,
  layoutJourneyGraph,
  newNodeId,
  normalizeJourneyGraph,
  validateJourneyGraph,
  type JourneyGraph,
  type JourneyNode,
  type JourneyNodeType,
} from '@/lib/campaign/core/journey-graph';

function StepNode({ data, selected }: NodeProps) {
  const d = data as { label: string; type: JourneyNodeType; hint?: string };
  const color = JOURNEY_NODE_META[d.type]?.color || '#7c7871';
  return (
    <div
      className="min-w-[150px] max-w-[200px] rounded-lg border px-3 py-2 text-xs shadow-sm transition-shadow"
      style={{
        borderColor: selected ? color : '#d7d3c3',
        background: 'rgba(255,255,255,0.96)',
        boxShadow: selected ? `0 0 0 2px ${color}33` : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-[#9ca3af] !h-2 !w-2" />
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
        {JOURNEY_NODE_META[d.type]?.label || d.type}
      </p>
      <p className="mt-0.5 font-medium text-[#3a414f]">{d.label}</p>
      {d.hint ? <p className="mt-1 line-clamp-2 text-[10px] text-[#7c7871]">{d.hint}</p> : null}
      <Handle type="source" position={Position.Bottom} className="!bg-[#9ca3af] !h-2 !w-2" />
    </div>
  );
}

const nodeTypes = { step: StepNode };

function hintFor(n: JourneyNode): string {
  const c = n.config || {};
  if (n.type === 'email') return `plane: ${String(c.delivery_plane || 'auto')}`;
  if (n.type === 'wait') {
    if (c.delay_hours) return `${c.delay_hours}h`;
    return `${c.days || 0}d ${c.hours || 0}h`;
  }
  if (n.type === 'call_vm_email') return 'no-answer + VM → email';
  if (n.type === 'send_envelope') return String(c.library_document_id || 'library doc');
  if (n.type === 'goal') return String(c.goal || 'conversion');
  if (n.type === 'branch') return String(c.field || 'condition');
  return JOURNEY_NODE_META[n.type]?.description || '';
}

function toFlow(graph: JourneyGraph): { nodes: Node[]; edges: Edge[] } {
  const laid = layoutJourneyGraph(graph);
  return {
    nodes: laid.nodes.map((n) => ({
      id: n.id,
      type: 'step',
      position: n.position || { x: 0, y: 0 },
      data: {
        label: n.label || JOURNEY_NODE_META[n.type]?.label || n.type,
        type: n.type,
        hint: hintFor(n),
        config: n.config || {},
      },
    })),
    edges: laid.edges.map((e) => ({
      id: e.id || `${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      label: e.label || e.condition,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#7c7871' },
      style: { stroke: '#9ca3af' },
      animated: e.condition === 'yes' || e.label === 'Yes',
    })),
  };
}

function fromFlow(nodes: Node[], edges: Edge[], prev: JourneyGraph): JourneyGraph {
  const byId = new Map(prev.nodes.map((n) => [n.id, n]));
  return normalizeJourneyGraph({
    version: prev.version || 1,
    nodes: nodes.map((n) => {
      const prevN = byId.get(n.id);
      const data = n.data as {
        label?: string;
        type?: JourneyNodeType;
        config?: Record<string, unknown>;
      };
      return {
        id: n.id,
        type: data.type || prevN?.type || 'email',
        label: data.label || prevN?.label,
        position: n.position,
        config: data.config || prevN?.config || {},
      };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      from: e.source,
      to: e.target,
      label: typeof e.label === 'string' ? e.label : undefined,
    })),
  });
}

export function JourneyGraphEditor({
  journeyId,
  initialGraph,
  name,
  status,
  onSaved,
}: {
  journeyId: string;
  initialGraph: unknown;
  name: string;
  status: string;
  onSaved?: () => void;
}) {
  const initial = useMemo(() => toFlow(normalizeJourneyGraph(initialGraph)), [initialGraph]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  useEffect(() => {
    const next = toFlow(normalizeJourneyGraph(initialGraph));
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [initialGraph, setNodes, setEdges]);

  const graph = useMemo(
    () => fromFlow(nodes, edges, normalizeJourneyGraph(initialGraph)),
    [nodes, edges, initialGraph],
  );

  const selected = nodes.find((n) => n.id === selectedId);

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...c,
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#7c7871' },
            style: { stroke: '#9ca3af' },
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  function addNode(type: JourneyNodeType) {
    const id = newNodeId(
      type,
      nodes.map((n) => n.id),
    );
    const defaults: Record<string, unknown> =
      type === 'email'
        ? { delivery_plane: 'graph', include_signature: true }
        : type === 'wait'
          ? { delay_hours: 48 }
          : type === 'call_vm_email'
            ? { send_email_on: ['no_answer', 'vm_dropped'], delay_email_seconds: 60, plane: 'graph' }
            : type === 'send_envelope'
              ? { library_document_id: '' }
              : type === 'goal'
                ? { goal: 'conversation' }
                : {};
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: 'step',
        position: { x: 120 + ns.length * 24, y: 80 + (ns.length % 4) * 40 },
        data: {
          label: JOURNEY_NODE_META[type].label,
          type,
          config: defaults,
          hint: JOURNEY_NODE_META[type].description,
        },
      },
    ]);
    setSelectedId(id);
  }

  function patchSelected(patch: { label?: string; config?: Record<string, unknown> }) {
    if (!selectedId) return;
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== selectedId) return n;
        const data = n.data as {
          label: string;
          type: JourneyNodeType;
          config: Record<string, unknown>;
        };
        const next = {
          id: n.id,
          type: data.type,
          label: patch.label ?? data.label,
          config: { ...data.config, ...(patch.config || {}) },
        };
        return {
          ...n,
          data: {
            ...data,
            label: next.label,
            config: next.config,
            hint: hintFor(next),
          },
        };
      }),
    );
  }

  function removeSelected() {
    if (!selectedId) return;
    const node = nodes.find((n) => n.id === selectedId);
    if (node && (node.data as { type: string }).type === 'trigger') {
      setMsg('Cannot delete trigger');
      return;
    }
    setNodes((ns) => ns.filter((n) => n.id !== selectedId));
    setEdges((es) => es.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  }

  async function save(publish = false) {
    setBusy(true);
    setMsg(null);
    const v = validateJourneyGraph(graph);
    setIssues([...v.errors, ...v.warnings]);
    if (!v.ok) {
      setBusy(false);
      setMsg(v.errors[0] || 'Validation failed');
      return;
    }
    try {
      const res = await fetch(`/api/campaign/v1/journeys/${journeyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph_json: graph,
          status: publish ? 'active' : undefined,
          name,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || 'Save failed');
      setMsg(publish ? 'Published' : 'Saved draft');
      onSaved?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  const selData = selected?.data as
    | { label: string; type: JourneyNodeType; config: Record<string, unknown> }
    | undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="overflow-hidden rounded-xl border border-[#d7d3c3] bg-[#f7f5f0]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#d7d3c3] bg-white/80 px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wider text-[#7c7871]">
            {status} · {nodes.length} steps
          </span>
          <div className="ml-auto flex flex-wrap gap-1">
            {journeyNodePalette().map((p) => (
              <button
                key={p.type}
                type="button"
                onClick={() => addNode(p.type)}
                className="rounded-md border border-[#e5e0d6] bg-white px-2 py-1 text-[11px] text-[#3a414f] transition-colors hover:border-[#c4bdae] hover:bg-[#f3efe6]"
                title={p.hint}
              >
                + {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[520px]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id ?? null)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} color="#d7d3c3" />
            <Controls />
            <MiniMap
              nodeColor={(n) =>
                JOURNEY_NODE_META[(n.data as { type: JourneyNodeType }).type]?.color || '#999'
              }
              maskColor="rgba(58,65,79,0.08)"
            />
          </ReactFlow>
        </div>
      </div>

      <aside className="space-y-3">
        <div className="rounded-xl border border-[#d7d3c3] bg-white p-4">
          <h3 className="font-heading text-sm font-semibold text-[#3a414f]">Inspector</h3>
          {!selData ? (
            <p className="mt-2 text-xs text-[#7c7871]">Select a step to edit label and config.</p>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-[#7c7871]">{selData.type}</p>
              <label className="block text-xs">
                <span className="text-[#5c6570]">Label</span>
                <input
                  className="mt-1 w-full rounded-md border border-[#e5e0d6] px-2 py-1.5"
                  value={selData.label}
                  onChange={(e) => patchSelected({ label: e.target.value })}
                />
              </label>
              {selData.type === 'email' ? (
                <label className="block text-xs">
                  <span className="text-[#5c6570]">Delivery plane</span>
                  <select
                    className="mt-1 w-full rounded-md border border-[#e5e0d6] px-2 py-1.5"
                    value={String(selData.config.delivery_plane || 'graph')}
                    onChange={(e) => patchSelected({ config: { delivery_plane: e.target.value } })}
                  >
                    <option value="graph">graph (1:1)</option>
                    <option value="controlled_graph">controlled_graph</option>
                    <option value="owned_mta">owned_mta</option>
                    <option value="auto">auto</option>
                  </select>
                </label>
              ) : null}
              {selData.type === 'wait' ? (
                <label className="block text-xs">
                  <span className="text-[#5c6570]">Delay hours</span>
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded-md border border-[#e5e0d6] px-2 py-1.5"
                    value={Number(selData.config.delay_hours || selData.config.days || 0)}
                    onChange={(e) =>
                      patchSelected({ config: { delay_hours: Number(e.target.value) } })
                    }
                  />
                </label>
              ) : null}
              {selData.type === 'send_envelope' ? (
                <label className="block text-xs">
                  <span className="text-[#5c6570]">Library document id</span>
                  <input
                    className="mt-1 w-full rounded-md border border-[#e5e0d6] px-2 py-1.5"
                    value={String(selData.config.library_document_id || '')}
                    onChange={(e) =>
                      patchSelected({ config: { library_document_id: e.target.value } })
                    }
                    placeholder="LIB_…"
                  />
                </label>
              ) : null}
              <button
                type="button"
                onClick={removeSelected}
                className="mt-2 text-xs text-[#7a4a4a] underline"
              >
                Remove step
              </button>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#d7d3c3] bg-white p-4">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => save(false)}
              className="flex-1 rounded-md bg-[#3a414f] px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Save graph
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => save(true)}
              className="rounded-md border border-[#d7d3c3] px-3 py-2 text-sm text-[#3a414f]"
            >
              Publish
            </button>
          </div>
          {msg ? <p className="mt-2 text-xs text-[#5c6570]">{msg}</p> : null}
          {issues.length ? (
            <ul className="mt-2 space-y-1 text-[11px] text-[#8a7355]">
              {issues.slice(0, 6).map((i) => (
                <li key={i}>· {i}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
