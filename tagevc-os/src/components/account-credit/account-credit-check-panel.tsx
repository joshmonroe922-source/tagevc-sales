'use client';

import { useState, useTransition } from 'react';

import {
  requestAccountCreditCheckAction,
  saveAccountCreditManualAction,
  uploadAccountCreditReportAction,
  waiveAccountCreditCheckAction,
  type AccountCreditActionResult,
} from '@/app/(app)/account-credit/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ACCOUNT_CREDIT_BUREAUS,
  ACCOUNT_CREDIT_NET_PROMPT,
  ACCOUNT_CREDIT_PAID_BUREAU_HELP,
  DUR_POLICY_COPY,
  RISK_BAND_LABELS,
  TERMS_LABELS,
  type AccountCreditCheck,
  type AccountCreditRefType,
  type AccountCreditRiskBand,
} from '@/lib/account-credit/types';
import { BUSINESS_BUREAU_LABELS } from '@/lib/net-worth/business-credit-types';

type Props = {
  entityId: string;
  accountRefType: AccountCreditRefType;
  accountRefId: string;
  accountDisplayName: string;
  accountBusinessId?: string;
  canRun: boolean;
  checks: AccountCreditCheck[];
  showNetPrompt?: boolean;
};

function riskBadge(band: AccountCreditRiskBand | null, status: string) {
  if (status === 'thin_file') return <Badge variant="outline">Thin file</Badge>;
  if (!band) return <Badge variant="outline">Unknown</Badge>;
  const variant =
    band === 'high'
      ? 'destructive'
      : band === 'medium'
        ? 'secondary'
        : band === 'low'
          ? 'secondary'
          : 'outline';
  return <Badge variant={variant}>{RISK_BAND_LABELS[band]}</Badge>;
}

export function AccountCreditCheckPanel({
  entityId,
  accountRefType,
  accountRefId,
  accountDisplayName,
  accountBusinessId,
  canRun,
  checks,
  showNetPrompt,
}: Props) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeCheckId, setActiveCheckId] = useState<string | null>(
    checks[0]?.id ?? null,
  );

  const run = (fn: () => Promise<AccountCreditActionResult>) => {
    setError(null);
    setMessage(null);
    start(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
      else {
        setMessage(result.message ?? 'Done.');
        if (result.checkId) setActiveCheckId(result.checkId);
      }
    });
  };

  const active = checks.find((c) => c.id === activeCheckId) ?? checks[0] ?? null;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Account credit check
          </p>
          <h3 className="font-heading text-lg font-semibold">{accountDisplayName}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{DUR_POLICY_COPY}</p>
        </div>
        {canRun ? (
          <Button type="button" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Close' : 'Run credit check'}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Read-only · manager+ to run</p>
        )}
      </div>

      {showNetPrompt ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {ACCOUNT_CREDIT_NET_PROMPT}
        </p>
      ) : null}

      {checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No checks yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {checks.slice(0, 5).map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2 py-1.5"
            >
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => {
                  setActiveCheckId(c.id);
                  setOpen(true);
                }}
              >
                {new Date(c.requested_at).toLocaleString()} · {c.status}
              </button>
              <div className="flex flex-wrap items-center gap-1">
                {riskBadge(c.risk_band, c.status)}
                {c.suggested_terms ? (
                  <Badge variant="outline">
                    Suggest {TERMS_LABELS[c.suggested_terms]}
                  </Badge>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && canRun ? (
        <div className="space-y-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">{ACCOUNT_CREDIT_PAID_BUREAU_HELP}</p>

          <form
            className="flex flex-wrap gap-2"
            action={(fd) =>
              run(async () => {
                fd.set('entity_id', entityId);
                fd.set('account_ref_type', accountRefType);
                fd.set('account_ref_id', accountRefId);
                fd.set('account_display_name', accountDisplayName);
                if (accountBusinessId) {
                  fd.set('account_business_id', accountBusinessId);
                }
                return requestAccountCreditCheckAction(fd);
              })
            }
          >
            <Button type="submit" size="sm" disabled={pending}>
              Start new check
            </Button>
          </form>

          {active ? (
            <>
              <p className="text-xs text-muted-foreground">
                Active check {active.id.slice(0, 8)}… · {active.status}
                {active.recommendation_notes
                  ? ` — ${active.recommendation_notes}`
                  : ''}
              </p>

              <form
                className="grid gap-2 rounded-lg border p-3"
                action={(fd) =>
                  run(async () => {
                    fd.set('check_id', active.id);
                    fd.set('entity_id', entityId);
                    return uploadAccountCreditReportAction(fd);
                  })
                }
              >
                <Label>Bureau report upload</Label>
                <select
                  name="bureau"
                  className="flex h-9 rounded-lg border border-input bg-background px-3 text-sm"
                  defaultValue="dnb"
                >
                  {ACCOUNT_CREDIT_BUREAUS.map((b) => (
                    <option key={b} value={b}>
                      {BUSINESS_BUREAU_LABELS[b]}
                    </option>
                  ))}
                </select>
                <Input name="file" type="file" accept=".pdf,.txt,.csv,application/pdf,text/plain" />
                <textarea
                  name="paste_text"
                  placeholder="Or paste report text"
                  className="min-h-[80px] rounded-lg border border-input bg-background px-3 py-2 text-sm"
                />
                <Button type="submit" size="sm" disabled={pending}>
                  Upload & parse
                </Button>
              </form>

              <form
                className="grid gap-2 rounded-lg border p-3"
                action={(fd) =>
                  run(async () => {
                    fd.set('check_id', active.id);
                    fd.set('entity_id', entityId);
                    return saveAccountCreditManualAction(fd);
                  })
                }
              >
                <Label>Manual scores (if parse partial)</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input name="paydex" placeholder="PAYDEX" />
                  <Input name="intelliscore_plus" placeholder="Intelliscore Plus" />
                  <Input
                    name="business_credit_risk"
                    placeholder="Equifax business credit risk"
                  />
                  <Input name="payment_index" placeholder="Payment index" />
                </div>
                <Button type="submit" size="sm" variant="outline" disabled={pending}>
                  Save manual
                </Button>
              </form>

              <form
                className="grid gap-2 rounded-lg border border-dashed p-3"
                action={(fd) =>
                  run(async () => {
                    fd.set('check_id', active.id);
                    fd.set('entity_id', entityId);
                    return waiveAccountCreditCheckAction(fd);
                  })
                }
              >
                <Label>Waive check (reason required)</Label>
                <Input
                  name="waiver_reason"
                  required
                  minLength={8}
                  placeholder="Why proceed without a completed check?"
                />
                <Button type="submit" size="sm" variant="secondary" disabled={pending}>
                  Waive — stay DUR
                </Button>
              </form>
            </>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
    </div>
  );
}
