'use client';

import { useState, useTransition } from 'react';
import {
  actionCreateNdaEnvelope,
  actionCreateRecruitReq,
  actionCreateSignentEngagement,
} from '@/app/(app)/shared-services/crm/actions';

export function AccountProductLinks(props: {
  accountId: string;
  recruitReqs: Array<{ id: string; title: string; status: string }>;
  ndaEnvelopes: Array<{ id: string; status: string }>;
  signentEngagements: Array<{ id: string; status: string }>;
}) {
  const [pending, start] = useTransition();
  const [reqTitle, setReqTitle] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <section className="rounded-md border border-border p-4 space-y-4">
      <h2 className="text-sm font-semibold">Product links (C11)</h2>
      <p className="text-xs text-muted-foreground">
        Recruit / NDA / Signent rows FK to this account. Instant NDA App Store
        left alone.
      </p>

      <div className="grid gap-4 md:grid-cols-3 text-sm">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Recruit reqs ({props.recruitReqs.length})
          </div>
          <ul className="mb-2 space-y-1 text-xs">
            {props.recruitReqs.length === 0 ? (
              <li className="text-muted-foreground">None</li>
            ) : (
              props.recruitReqs.map((r) => (
                <li key={r.id}>
                  {r.title} · {r.status}
                </li>
              ))
            )}
          </ul>
          <div className="flex gap-1">
            <input
              className="h-8 flex-1 rounded border border-border px-2 text-xs"
              placeholder="Req title"
              value={reqTitle}
              onChange={(e) => setReqTitle(e.target.value)}
            />
            <button
              type="button"
              disabled={pending || !reqTitle.trim()}
              className="rounded border border-border px-2 text-xs disabled:opacity-50"
              onClick={() =>
                start(async () => {
                  const res = await actionCreateRecruitReq(
                    props.accountId,
                    reqTitle,
                  );
                  setMsg(res.ok ? 'Req created' : res.error);
                  if (res.ok) setReqTitle('');
                })
              }
            >
              Add
            </button>
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            NDA envelopes ({props.ndaEnvelopes.length})
          </div>
          <ul className="mb-2 space-y-1 text-xs">
            {props.ndaEnvelopes.length === 0 ? (
              <li className="text-muted-foreground">None</li>
            ) : (
              props.ndaEnvelopes.map((r) => (
                <li key={r.id}>
                  {r.id.slice(0, 8)} · {r.status}
                </li>
              ))
            )}
          </ul>
          <button
            type="button"
            disabled={pending}
            className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
            onClick={() =>
              start(async () => {
                const res = await actionCreateNdaEnvelope(props.accountId);
                setMsg(res.ok ? 'NDA draft created' : res.error);
              })
            }
          >
            Draft NDA
          </button>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Signent ({props.signentEngagements.length})
          </div>
          <ul className="mb-2 space-y-1 text-xs">
            {props.signentEngagements.length === 0 ? (
              <li className="text-muted-foreground">None</li>
            ) : (
              props.signentEngagements.map((r) => (
                <li key={r.id}>
                  {r.id.slice(0, 8)} · {r.status}
                </li>
              ))
            )}
          </ul>
          <button
            type="button"
            disabled={pending}
            className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
            onClick={() =>
              start(async () => {
                const res = await actionCreateSignentEngagement(
                  props.accountId,
                );
                setMsg(res.ok ? 'Signent engagement created' : res.error);
              })
            }
          >
            Link Signent
          </button>
        </div>
      </div>
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
    </section>
  );
}
