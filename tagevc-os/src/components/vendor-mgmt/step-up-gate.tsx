'use client';

import { useState, useTransition } from 'react';
import {
  clearVmStepUpAction,
  confirmVmStepUpAction,
  issueVmStepUpAction,
} from '@/app/(app)/shared-services/ops/vendor-management/actions';

export function VmStepUpGate({
  email,
  initiallyActive,
}: {
  email: string | null;
  initiallyActive?: boolean;
}) {
  const [active, setActive] = useState(Boolean(initiallyActive));
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [emailConfirm, setEmailConfirm] = useState(email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-2 rounded-md border border-[#9F957C]/50 bg-[#ECE9E6]/50 px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-[#3a414f]">
          Step-up MFA · contract $ / renewal approve
        </p>
        <span
          className={
            active
              ? 'rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800'
              : 'rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900'
          }
        >
          {active ? 'Active (15m)' : 'Required'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        SSO session required. Issue a one-time code (attests IdP MFA / operator
        re-auth), then confirm with your work email. No local passwords.
      </p>

      {!active ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <button
            type="button"
            disabled={pending || !email}
            className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium disabled:opacity-50"
            onClick={() =>
              start(async () => {
                setError(null);
                setMessage(null);
                const res = await issueVmStepUpAction();
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setCode(res.code);
                setMessage(`Code issued — valid ${Math.round(res.ttlSec / 60)}m`);
              })
            }
          >
            Issue step-up code
          </button>
          {code ? (
            <p className="font-mono text-xs tracking-widest text-[#3a414f]">
              CODE: {code}
            </p>
          ) : null}
        </div>
      ) : null}

      {!active && code ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs sm:col-span-1">
            <span className="text-muted-foreground">SSO email</span>
            <input
              value={emailConfirm}
              onChange={(e) => setEmailConfirm(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Code</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm uppercase"
            />
          </label>
          <button
            type="button"
            disabled={pending}
            className="rounded-md bg-[#3a414f] px-3 py-2 text-xs font-medium text-white disabled:opacity-50 sm:self-end"
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await confirmVmStepUpAction({
                  email: emailConfirm,
                  code: typed,
                });
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setActive(true);
                setMessage('Step-up active for 15 minutes');
                setCode(null);
                setTyped('');
              })
            }
          >
            Confirm step-up
          </button>
        </div>
      ) : null}

      {active ? (
        <button
          type="button"
          className="text-xs underline underline-offset-2"
          onClick={() =>
            start(async () => {
              await clearVmStepUpAction();
              setActive(false);
              setMessage('Step-up cleared');
            })
          }
        >
          Clear step-up
        </button>
      ) : null}

      {/* Hidden field so server actions can detect cookie-backed step-up OR legacy checkbox path */}
      <input type="hidden" name="step_up_token" value={active ? '1' : ''} />

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
    </div>
  );
}
