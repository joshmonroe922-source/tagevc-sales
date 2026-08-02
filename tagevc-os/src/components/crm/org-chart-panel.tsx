'use client';

import { useTransition } from 'react';

type Node = { id: string; full_name: string; title: string | null };
type Edge = {
  id: string;
  manager_contact_id: string;
  report_contact_id: string;
  status: string;
  confidence: number | null;
  rationale: string | null;
};

export function OrgChartPanel(props: {
  accountId: string;
  nodes: Node[];
  edges: Edge[];
  suggestAction: (
    accountId: string,
  ) => Promise<{ ok: true; created: number } | { ok: false; error: string }>;
  edgeAction: (
    edgeId: string,
    status: 'confirmed' | 'rejected',
    accountId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [pending, start] = useTransition();
  const byId = Object.fromEntries(props.nodes.map((n) => [n.id, n]));

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
        Solid = confirmed · Dashed = suggested. Accept/reject never auto-confirms
        (P4 / agent.hierarchy).
      </p>
      <ul className="divide-y divide-border p-2 text-sm">
        {props.edges.length === 0 ? (
          <li className="px-2 py-6 text-muted-foreground">
            No edges yet — add people, then Suggest hierarchy.
          </li>
        ) : (
          props.edges.map((e) => {
            const mgr = byId[e.manager_contact_id];
            const rep = byId[e.report_contact_id];
            const dashed = e.status === 'suggested';
            return (
              <li
                key={e.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-3 ${
                  dashed ? 'border border-dashed border-border/80' : ''
                }`}
              >
                <div>
                  <div className="font-medium">
                    {rep?.full_name || e.report_contact_id.slice(0, 8)}
                    <span className="text-muted-foreground"> → reports to </span>
                    {mgr?.full_name || e.manager_contact_id.slice(0, 8)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.status}
                    {e.confidence != null
                      ? ` · conf ${Number(e.confidence).toFixed(2)}`
                      : ''}
                    {e.rationale ? ` · ${e.rationale}` : ''}
                  </div>
                </div>
                {e.status === 'suggested' ? (
                  <div className="flex gap-2">
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
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
