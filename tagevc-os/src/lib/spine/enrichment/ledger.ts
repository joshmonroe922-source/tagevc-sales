/**
 * credit_ledger helpers — month spend gate + paid-call recording (C6).
 * Columns: units, usd_estimate, provider, job_id, note (phase94).
 */

export type CreditLedgerClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        gte: (
          col: string,
          val: string,
        ) => PromiseLike<{
          data: Array<{ usd_estimate?: number | string | null }> | null;
          error: unknown;
        }>;
      };
    };
    insert: (
      row: Record<string, unknown>,
    ) => PromiseLike<{ error: { message: string } | null }>;
  };
};

export function monthStartIso(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function sumMonthSpendUsd(
  sb: CreditLedgerClient,
  orgId: string,
): Promise<number> {
  const { data, error } = await sb
    .from('credit_ledger')
    .select('usd_estimate')
    .eq('org_id', orgId)
    .gte('at', monthStartIso());
  if (error) return 0;
  return (data ?? []).reduce((sum, r) => sum + Number(r.usd_estimate || 0), 0);
}

export async function recordCreditSpend(input: {
  sb: CreditLedgerClient;
  orgId: string;
  provider: string;
  usd: number;
  jobId?: string | null;
  note?: string;
  units?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await input.sb.from('credit_ledger').insert({
    org_id: input.orgId,
    provider: input.provider,
    units: input.units ?? 1,
    usd_estimate: input.usd,
    job_id: input.jobId || null,
    note: input.note || null,
    at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
