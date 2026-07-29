/**
 * Bank / card feed OAuth (ENT-03) — Plaid-ready with clean stub when secrets missing.
 * SSOT: connect provider → select last4 → map to bank_account_id → test import.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { AF_BANKS, AF_PERSONAL_BANKS } from '@/lib/af/master-data';
import type { EntityCode } from '@/lib/af/types';

export type FeedBooksScope = 'company' | 'personal';

type FeedBankRef = {
  id: string;
  entityCode: EntityCode | 'PERS';
  name: string;
  institution: string;
  glAccount: string;
  type: string;
  books: FeedBooksScope;
};

function resolveFeedBank(bankAccountId: string): FeedBankRef | null {
  const company = AF_BANKS.find((b) => b.id === bankAccountId);
  if (company) {
    return {
      id: company.id,
      entityCode: company.entityCode,
      name: company.name,
      institution: company.institution || '',
      glAccount: company.glAccount,
      type: company.type,
      books: 'company',
    };
  }
  const personal = AF_PERSONAL_BANKS.find((b) => b.id === bankAccountId);
  if (personal) {
    return {
      id: personal.id,
      entityCode: 'PERS',
      name: personal.name,
      institution: '',
      glAccount: personal.glAccount,
      type: personal.type,
      books: 'personal',
    };
  }
  return null;
}

export type BankFeedProvider = 'plaid' | 'mx' | 'unit' | 'teller' | 'stub';

export type BankConnectionStatus =
  | 'not_connected'
  | 'pending'
  | 'connected'
  | 'error'
  | 'revoked'
  | 'stubbed';

export type BankConnection = {
  id?: string;
  bankAccountId: string;
  entityCode: EntityCode | 'PERS';
  provider: BankFeedProvider;
  status: BankConnectionStatus;
  institutionName?: string | null;
  accountMask?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  linkToken?: string | null;
  stubMode: boolean;
};

export type PlaidAccountOption = {
  accountId: string;
  name: string;
  mask: string | null;
  type: string | null;
  subtype: string | null;
};

export type FeedCredentials = {
  provider: BankFeedProvider;
  ready: boolean;
  missing: string[];
};

function plaidApiBase(): string {
  const env = process.env.PLAID_ENV?.trim() || 'sandbox';
  if (env === 'production') return 'https://production.plaid.com';
  if (env === 'development') return 'https://development.plaid.com';
  return 'https://sandbox.plaid.com';
}

export function detectFeedCredentials(): FeedCredentials {
  const plaidId = process.env.PLAID_CLIENT_ID?.trim();
  const plaidSecret = process.env.PLAID_SECRET?.trim();
  if (plaidId && plaidSecret) {
    return { provider: 'plaid', ready: true, missing: [] };
  }
  const mxId = process.env.MX_CLIENT_ID?.trim();
  const mxKey = process.env.MX_API_KEY?.trim();
  if (mxId && mxKey) {
    return { provider: 'mx', ready: true, missing: [] };
  }
  const unit = process.env.UNIT_TOKEN?.trim();
  if (unit) {
    return { provider: 'unit', ready: true, missing: [] };
  }
  const teller = process.env.TELLER_APP_ID?.trim();
  if (teller) {
    return { provider: 'teller', ready: true, missing: [] };
  }
  return {
    provider: 'stub',
    ready: false,
    missing: [
      'PLAID_CLIENT_ID',
      'PLAID_SECRET',
      '(or MX_CLIENT_ID + MX_API_KEY / UNIT_TOKEN / TELLER_APP_ID)',
    ],
  };
}

export async function listBankConnections(): Promise<BankConnection[]> {
  const creds = detectFeedCredentials();
  const supabase = await createPersistClient();
  const byId = new Map<string, BankConnection>();

  if (supabase) {
    const { data } = await supabase
      .from('os_af_bank_connections')
      .select('*')
      .order('bank_account_id');
    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      byId.set(String(r.bank_account_id), {
        id: String(r.id),
        bankAccountId: String(r.bank_account_id),
        entityCode: r.entity_code as EntityCode | 'PERS',
        provider: r.provider as BankFeedProvider,
        status: r.status as BankConnectionStatus,
        institutionName: (r.institution_name as string) ?? null,
        accountMask: (r.account_mask as string) ?? null,
        lastSyncAt: (r.last_sync_at as string) ?? null,
        lastError: (r.last_error as string) ?? null,
        stubMode: r.provider === 'stub' || !creds.ready,
      });
    }
  }

  return AF_BANKS.filter((b) => b.feedEnabled).map((b) => {
    const existing = byId.get(b.id);
    if (existing) return existing;
    return {
      bankAccountId: b.id,
      entityCode: b.entityCode,
      provider: creds.ready ? creds.provider : 'stub',
      status: 'not_connected' as const,
      stubMode: !creds.ready,
    };
  });
}

export async function listPersonalBankConnections(): Promise<BankConnection[]> {
  const creds = detectFeedCredentials();
  const supabase = await createPersistClient();
  const byId = new Map<string, BankConnection>();

  if (supabase) {
    const { data } = await supabase
      .from('os_af_bank_connections')
      .select('*')
      .eq('entity_code', 'PERS')
      .order('bank_account_id');
    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      byId.set(String(r.bank_account_id), {
        id: String(r.id),
        bankAccountId: String(r.bank_account_id),
        entityCode: 'PERS',
        provider: r.provider as BankFeedProvider,
        status: r.status as BankConnectionStatus,
        institutionName: (r.institution_name as string) ?? null,
        accountMask: (r.account_mask as string) ?? null,
        lastSyncAt: (r.last_sync_at as string) ?? null,
        lastError: (r.last_error as string) ?? null,
        stubMode: r.provider === 'stub' || !creds.ready,
      });
    }
  }

  return AF_PERSONAL_BANKS.filter((b) => b.feedEnabled).map((b) => {
    const existing = byId.get(b.id);
    if (existing) return existing;
    return {
      bankAccountId: b.id,
      entityCode: 'PERS' as const,
      provider: creds.ready ? creds.provider : 'stub',
      status: 'not_connected' as const,
      stubMode: !creds.ready,
    };
  });
}

/**
 * Start connect flow. Returns link_token when Plaid credentials exist;
 * otherwise records a stubbed connection so ENT-03 can proceed in demo.
 */
export async function startBankConnect(input: {
  bankAccountId: string;
  actorLabel?: string;
}): Promise<{
  ok: boolean;
  connection: BankConnection;
  mode: 'live' | 'stub';
  message: string;
  linkToken?: string;
  redirectUri?: string;
}> {
  const bank = resolveFeedBank(input.bankAccountId);
  if (!bank || bank.books !== 'company') {
    throw new Error(`Unknown company bank account ${input.bankAccountId}`);
  }
  const creds = detectFeedCredentials();
  const supabase = await createPersistClient();
  const redirectUri = plaidRedirectUri('company');

  if (creds.ready && creds.provider === 'plaid') {
    const linkToken = await createPlaidLinkToken({
      clientUserId: `af-${bank.entityCode}`,
      clientName: 'Tage VC A&F',
      redirectUri,
    }).catch(() => null);
    if (linkToken) {
      if (supabase) {
        await supabase.from('os_af_bank_connections').upsert(
          {
            bank_account_id: bank.id,
            entity_code: bank.entityCode,
            provider: 'plaid',
            status: 'pending',
            institution_name: bank.institution || null,
            last_error: null,
            updated_at: new Date().toISOString(),
            meta: {
              books_id: bank.entityCode,
              link_started_at: new Date().toISOString(),
              redirect_uri: redirectUri,
            },
          },
          { onConflict: 'bank_account_id' },
        );
      }
      return {
        ok: true,
        mode: 'live',
        message: 'Plaid Link token issued. Complete OAuth in Link UI.',
        linkToken,
        redirectUri,
        connection: {
          bankAccountId: bank.id,
          entityCode: bank.entityCode,
          provider: 'plaid',
          status: 'pending',
          institutionName: bank.institution || null,
          stubMode: false,
          linkToken,
        },
      };
    }
  }

  const stubConn: BankConnection = {
    bankAccountId: bank.id,
    entityCode: bank.entityCode,
    provider: 'stub',
    status: 'stubbed',
    institutionName: bank.institution || null,
    accountMask: '••••',
    lastSyncAt: new Date().toISOString(),
    stubMode: true,
  };

  if (supabase) {
    await supabase.from('os_af_bank_connections').upsert(
      {
        bank_account_id: bank.id,
        entity_code: bank.entityCode,
        provider: 'stub',
        status: 'stubbed',
        institution_name: bank.institution || null,
        account_mask: '0000',
        last_sync_at: new Date().toISOString(),
        last_error: creds.ready
          ? 'Provider API unavailable — stubbed'
          : `Missing secrets: ${creds.missing.join(', ')}`,
        updated_at: new Date().toISOString(),
        meta: {
          stub: true,
          actor: input.actorLabel ?? null,
          missing: creds.missing,
        },
      },
      { onConflict: 'bank_account_id' },
    );
  }

  return {
    ok: true,
    mode: 'stub',
    message: creds.ready
      ? 'Provider credentials present but Link unavailable — connection stubbed for ENT-03.'
      : `Bank feed stubbed (missing ${creds.missing[0]}). Add Plaid/MX secrets to enable live OAuth.`,
    connection: stubConn,
  };
}

function normalizePlaidAccounts(
  accounts: Array<{
    account_id?: string;
    accountId?: string;
    id?: string;
    name?: string;
    mask?: string;
    type?: string;
    subtype?: string;
  }>,
): PlaidAccountOption[] {
  const out: PlaidAccountOption[] = [];
  const seen = new Set<string>();
  for (const a of accounts) {
    const accountId = String(
      a.account_id ?? a.accountId ?? a.id ?? '',
    ).trim();
    if (!accountId || seen.has(accountId)) continue;
    seen.add(accountId);
    out.push({
      accountId,
      name: a.name?.trim() || 'Account',
      mask: a.mask?.trim() || null,
      type: a.type?.trim() || null,
      subtype: a.subtype?.trim() || null,
    });
  }
  return out;
}

/**
 * Exchange Plaid public_token → access_token and return accounts for last4 matching.
 * Does not mark MD banks connected until applyPlaidAccountMaps.
 */
export async function completePlaidLink(input: {
  bankAccountId: string;
  publicToken: string;
  institutionName?: string | null;
  accounts?: Array<{
    id?: string;
    name?: string;
    mask?: string;
    type?: string;
    subtype?: string;
  }>;
}): Promise<{
  ok: boolean;
  message: string;
  needsMapping?: boolean;
  sourceBankAccountId?: string;
  institutionName?: string | null;
  accounts?: PlaidAccountOption[];
  connection?: BankConnection;
  error?: string;
}> {
  const bank = resolveFeedBank(input.bankAccountId);
  if (!bank) {
    return { ok: false, message: 'Unknown bank', error: 'NOT_FOUND' };
  }
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SECRET?.trim();
  if (!clientId || !secret) {
    return {
      ok: false,
      message: 'Plaid secrets missing',
      error: 'MISSING_SECRETS',
    };
  }

  const exchangeRes = await fetch(
    `${plaidApiBase()}/item/public_token/exchange`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        secret,
        public_token: input.publicToken,
      }),
    },
  );
  if (!exchangeRes.ok) {
    const detail = await exchangeRes.text();
    console.error('Plaid item/public_token/exchange', detail);
    return {
      ok: false,
      message: 'Plaid token exchange failed',
      error: 'EXCHANGE_FAILED',
    };
  }
  const exchanged = (await exchangeRes.json()) as {
    access_token?: string;
    item_id?: string;
  };
  if (!exchanged.access_token) {
    return {
      ok: false,
      message: 'Plaid exchange returned no access_token',
      error: 'EXCHANGE_FAILED',
    };
  }

  let accounts = normalizePlaidAccounts(input.accounts ?? []);
  try {
    const accountsRes = await fetch(`${plaidApiBase()}/accounts/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        secret,
        access_token: exchanged.access_token,
      }),
    });
    if (accountsRes.ok) {
      const accountsJson = (await accountsRes.json()) as {
        accounts?: Array<{
          account_id?: string;
          name?: string;
          mask?: string;
          type?: string;
          subtype?: string;
        }>;
      };
      const fromApi = normalizePlaidAccounts(accountsJson.accounts ?? []);
      if (fromApi.length) accounts = fromApi;
    }
  } catch {
    /* non-fatal — use Link metadata accounts */
  }

  if (!accounts.length) {
    return {
      ok: false,
      message: 'Plaid returned no accounts to map',
      error: 'NO_ACCOUNTS',
    };
  }

  const institutionName = input.institutionName ?? bank.institution ?? null;
  const now = new Date().toISOString();
  const connection: BankConnection = {
    bankAccountId: bank.id,
    entityCode: bank.entityCode,
    provider: 'plaid',
    status: 'pending',
    institutionName,
    stubMode: false,
  };

  const supabase = await createPersistClient();
  if (supabase) {
    await supabase.from('os_af_bank_connections').upsert(
      {
        bank_account_id: bank.id,
        entity_code: bank.entityCode,
        provider: 'plaid',
        status: 'pending',
        institution_name: institutionName,
        access_token_enc: exchanged.access_token,
        item_id: exchanged.item_id ?? null,
        last_error: null,
        updated_at: now,
        meta: {
          await_mapping: true,
          books_id: bank.books === 'personal' ? 'PERS' : bank.entityCode,
          linked_at: now,
          plaid_item_id: exchanged.item_id ?? null,
          plaid_accounts: accounts,
        },
      },
      { onConflict: 'bank_account_id' },
    );
  }

  return {
    ok: true,
    needsMapping: true,
    sourceBankAccountId: bank.id,
    institutionName,
    accounts,
    message: `Select last4 and map to OS bank accounts (${accounts.length} from Plaid).`,
    connection,
  };
}

/** Apply last4 / account_id maps from one Plaid Item onto MD bank rows. */
export async function applyPlaidAccountMaps(input: {
  sourceBankAccountId: string;
  institutionName?: string | null;
  mappings: Array<{
    plaidAccountId: string;
    bankAccountId: string;
  }>;
}): Promise<{
  ok: boolean;
  message: string;
  connected: BankConnection[];
  error?: string;
}> {
  const mappings = input.mappings.filter(
    (m) => m.plaidAccountId && m.bankAccountId,
  );
  if (!mappings.length) {
    return {
      ok: false,
      message: 'Map at least one Plaid account to an OS bank',
      error: 'NO_MAPS',
      connected: [],
    };
  }

  const bankIds = new Set(mappings.map((m) => m.bankAccountId));
  if (bankIds.size !== mappings.length) {
    return {
      ok: false,
      message: 'Each OS bank can only map to one Plaid account',
      error: 'DUPLICATE_BANK',
      connected: [],
    };
  }

  const supabase = await createPersistClient();
  if (!supabase) {
    return {
      ok: false,
      message: 'Database unavailable',
      error: 'NO_DB',
      connected: [],
    };
  }

  const { data: sourceRow } = await supabase
    .from('os_af_bank_connections')
    .select('*')
    .eq('bank_account_id', input.sourceBankAccountId)
    .maybeSingle();

  const source = sourceRow as Record<string, unknown> | null;
  const accessToken = String(source?.access_token_enc ?? '').trim();
  const itemId = (source?.item_id as string | null) ?? null;
  const meta = (source?.meta as Record<string, unknown> | null) ?? {};
  const storedAccounts = normalizePlaidAccounts(
    (Array.isArray(meta.plaid_accounts)
      ? meta.plaid_accounts
      : []) as Array<{
      accountId?: string;
      account_id?: string;
      id?: string;
      name?: string;
      mask?: string;
      type?: string;
      subtype?: string;
    }>,
  );
  // Also accept camelCase from our stored shape
  const byId = new Map<string, PlaidAccountOption>();
  for (const a of storedAccounts) byId.set(a.accountId, a);
  if (Array.isArray(meta.plaid_accounts)) {
    for (const raw of meta.plaid_accounts as Array<Record<string, unknown>>) {
      const id = String(raw.accountId ?? raw.account_id ?? raw.id ?? '').trim();
      if (!id) continue;
      byId.set(id, {
        accountId: id,
        name: String(raw.name ?? 'Account'),
        mask: (raw.mask as string | null) ?? null,
        type: (raw.type as string | null) ?? null,
        subtype: (raw.subtype as string | null) ?? null,
      });
    }
  }

  if (!accessToken) {
    return {
      ok: false,
      message: 'Plaid session expired — click Connect again',
      error: 'NO_SESSION',
      connected: [],
    };
  }

  const institutionName =
    input.institutionName ??
    (source?.institution_name as string | null) ??
    null;
  const now = new Date().toISOString();
  const connected: BankConnection[] = [];

  for (const map of mappings) {
    const md = resolveFeedBank(map.bankAccountId);
    if (!md) {
      return {
        ok: false,
        message: `Unknown OS bank ${map.bankAccountId}`,
        error: 'NOT_FOUND',
        connected: [],
      };
    }
    const plaid = byId.get(map.plaidAccountId);
    if (!plaid) {
      return {
        ok: false,
        message: `Unknown Plaid account ${map.plaidAccountId}`,
        error: 'NOT_FOUND',
        connected: [],
      };
    }

    const connection: BankConnection = {
      bankAccountId: md.id,
      entityCode: md.entityCode,
      provider: 'plaid',
      status: 'connected',
      institutionName,
      accountMask: plaid.mask,
      lastSyncAt: now,
      stubMode: false,
    };
    connected.push(connection);

    await supabase.from('os_af_bank_connections').upsert(
      {
        bank_account_id: md.id,
        entity_code: md.entityCode,
        provider: 'plaid',
        status: 'connected',
        institution_name: institutionName,
        account_mask: plaid.mask,
        access_token_enc: accessToken,
        item_id: itemId,
        last_sync_at: now,
        last_error: null,
        updated_at: now,
        meta: {
          linked_at: now,
          await_mapping: false,
          books_id: md.books === 'personal' ? 'PERS' : md.entityCode,
          plaid_item_id: itemId,
          plaid_account_id: plaid.accountId,
          plaid_account_name: plaid.name,
          plaid_account_type: plaid.type,
          plaid_account_subtype: plaid.subtype,
        },
      },
      { onConflict: 'bank_account_id' },
    );
  }

  // If source row was only a staging seat and wasn't mapped, clear await flag
  if (!bankIds.has(input.sourceBankAccountId)) {
    await supabase
      .from('os_af_bank_connections')
      .update({
        status: 'not_connected',
        access_token_enc: null,
        item_id: null,
        updated_at: now,
        meta: { await_mapping: false, remapped_away: true },
      })
      .eq('bank_account_id', input.sourceBankAccountId)
      .eq('status', 'pending');
  }

  return {
    ok: true,
    message: `Mapped ${connected.length} Plaid account(s) to OS banks.`,
    connected,
  };
}

export async function runTestImport(bankAccountId: string): Promise<{
  ok: boolean;
  imported: number;
  message: string;
  balance?: number | null;
}> {
  const live = await syncPlaidBankFeed(bankAccountId);
  if (live.ok) {
    return {
      ok: true,
      imported: live.imported,
      balance: live.balance,
      message:
        live.imported > 0
          ? `Live Plaid sync: ${live.imported} transaction(s)${
              live.balance != null
                ? ` · balance ${live.balance.toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD',
                  })}`
                : ''
            }.`
          : live.message,
    };
  }
  const supabase = await createPersistClient();
  const now = new Date().toISOString();
  if (supabase) {
    await supabase
      .from('os_af_bank_connections')
      .update({
        last_sync_at: now,
        status: 'connected',
        updated_at: now,
        last_error: live.message,
      })
      .eq('bank_account_id', bankAccountId);
  }
  return {
    ok: false,
    imported: 0,
    message: live.message || 'Live Plaid sync failed',
  };
}

/** Pull transactions + balances from Plaid for one mapped OS bank. */
export async function syncPlaidBankFeed(bankAccountId: string): Promise<{
  ok: boolean;
  imported: number;
  balance: number | null;
  message: string;
}> {
  const bank = resolveFeedBank(bankAccountId);
  if (!bank) {
    return {
      ok: false,
      imported: 0,
      balance: null,
      message: 'Unknown bank',
    };
  }
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SECRET?.trim();
  if (!clientId || !secret) {
    return {
      ok: false,
      imported: 0,
      balance: null,
      message: 'Plaid secrets missing',
    };
  }

  const supabase = await createPersistClient();
  if (!supabase) {
    return {
      ok: false,
      imported: 0,
      balance: null,
      message: 'Database unavailable',
    };
  }

  const { data: row } = await supabase
    .from('os_af_bank_connections')
    .select('*')
    .eq('bank_account_id', bankAccountId)
    .maybeSingle();
  const conn = row as Record<string, unknown> | null;
  const accessToken = String(conn?.access_token_enc ?? '').trim();
  const meta = (conn?.meta as Record<string, unknown> | null) ?? {};
  const plaidAccountId = String(meta.plaid_account_id ?? '').trim();
  if (!accessToken || !plaidAccountId) {
    return {
      ok: false,
      imported: 0,
      balance: null,
      message: 'Bank not linked to a Plaid account — Connect & map first',
    };
  }

  let balance: number | null = null;
  try {
    const accountsRes = await fetch(`${plaidApiBase()}/accounts/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        secret,
        access_token: accessToken,
      }),
    });
    if (accountsRes.ok) {
      const accountsJson = (await accountsRes.json()) as {
        accounts?: Array<{
          account_id?: string;
          balances?: { current?: number | null; available?: number | null };
        }>;
      };
      const match = (accountsJson.accounts ?? []).find(
        (a) => a.account_id === plaidAccountId,
      );
      const current = match?.balances?.current;
      const available = match?.balances?.available;
      if (typeof current === 'number') balance = current;
      else if (typeof available === 'number') balance = available;
    }
  } catch {
    /* non-fatal */
  }

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 90);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  let imported = 0;
  const txns: Array<{
    id: string;
    amount: number;
    date: string;
    description: string;
    ref?: string;
  }> = [];

  try {
    const txRes = await fetch(`${plaidApiBase()}/transactions/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        secret,
        access_token: accessToken,
        start_date: startDate,
        end_date: endDate,
        options: {
          account_ids: [plaidAccountId],
          count: 100,
        },
      }),
    });
    if (txRes.ok) {
      const txJson = (await txRes.json()) as {
        transactions?: Array<{
          transaction_id?: string;
          amount?: number;
          date?: string;
          name?: string;
          merchant_name?: string | null;
        }>;
      };
      for (const t of txJson.transactions ?? []) {
        const id = String(t.transaction_id ?? '').trim();
        if (!id) continue;
        // Plaid: positive amount = money leaving the account
        const amount = -(Number(t.amount) || 0);
        txns.push({
          id: `PLAID-${id}`,
          amount,
          date: String(t.date ?? endDate),
          description:
            t.merchant_name?.trim() || t.name?.trim() || 'Plaid transaction',
          ref: id,
        });
      }
      imported = txns.length;
    } else {
      const detail = await txRes.text();
      console.error('Plaid transactions/get', detail);
      // Still OK if we got a balance
      if (balance == null) {
        return {
          ok: false,
          imported: 0,
          balance: null,
          message: 'Plaid transactions sync failed',
        };
      }
    }
  } catch (e) {
    console.error('Plaid transactions/get', e);
    if (balance == null) {
      return {
        ok: false,
        imported: 0,
        balance: null,
        message: 'Plaid transactions sync error',
      };
    }
  }

  const now = new Date().toISOString();
  await supabase
    .from('os_af_bank_connections')
    .update({
      last_sync_at: now,
      status: 'connected',
      last_error: null,
      updated_at: now,
      meta: {
        ...meta,
        last_live_sync_at: now,
        last_live_balance: balance,
        last_live_txn_count: imported,
      },
    })
    .eq('bank_account_id', bankAccountId);

  // Dynamic import avoids circular deps with seed/store
  const { ingestLiveFeedTxns, applyLiveBankBalance } = await import(
    '@/lib/af/seed/store'
  );
  if (bank.books === 'company' && bank.entityCode !== 'PERS') {
    ingestLiveFeedTxns(
      bankAccountId,
      bank.entityCode as EntityCode,
      txns,
    );
    if (balance != null) {
      applyLiveBankBalance(
        bank.entityCode as EntityCode,
        bank.glAccount,
        balance,
      );
    }
  } else if (bank.books === 'personal' && balance != null) {
    applyLiveBankBalance('PERS', bank.glAccount, balance);
  }

  return {
    ok: true,
    imported,
    balance,
    message:
      imported > 0 || balance != null
        ? 'Live Plaid sync complete'
        : 'Plaid connected but no recent transactions',
  };
}

export async function syncAllConnectedCompanyFeeds(): Promise<{
  ok: boolean;
  banks: number;
  imported: number;
  message: string;
}> {
  const connections = await listBankConnections();
  const live = connections.filter(
    (c) => c.status === 'connected' && !c.stubMode,
  );
  let imported = 0;
  let okCount = 0;
  for (const c of live) {
    const result = await syncPlaidBankFeed(c.bankAccountId);
    if (result.ok) {
      okCount += 1;
      imported += result.imported;
    }
  }
  return {
    ok: okCount > 0 || live.length === 0,
    banks: okCount,
    imported,
    message:
      live.length === 0
        ? 'No connected company banks to sync'
        : `Synced ${okCount}/${live.length} bank(s) · ${imported} transaction(s)`,
  };
}

function plaidAppBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://app.tagevc.com')
    .trim()
    .replace(/\/$/, '');
}

function plaidRedirectUri(scope: FeedBooksScope = 'company'): string {
  if (scope === 'personal') {
    const explicit = process.env.PLAID_PERSONAL_REDIRECT_URI?.trim();
    if (explicit) return explicit.replace(/\/$/, '');
    return `${plaidAppBase()}/personal/finance/accounts/connect`;
  }
  const explicit = process.env.PLAID_REDIRECT_URI?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  return `${plaidAppBase()}/shared-services/af/setup/banks/connect`;
}

async function createPlaidLinkToken(input: {
  clientUserId: string;
  clientName: string;
  redirectUri: string;
}): Promise<string | null> {
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SECRET?.trim();
  if (!clientId || !secret) return null;

  const res = await fetch(`${plaidApiBase()}/link/token/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      secret,
      client_name: input.clientName,
      language: 'en',
      country_codes: ['US'],
      user: { client_user_id: input.clientUserId },
      products: ['transactions'],
      redirect_uri: input.redirectUri,
    }),
  });
  if (!res.ok) {
    console.error('Plaid link/token/create', await res.text());
    return null;
  }
  const json = (await res.json()) as { link_token?: string };
  return json.link_token ?? null;
}

/** Public helper for UI copy / dashboard registration. */
export function getPlaidRedirectUri(): string {
  return plaidRedirectUri('company');
}

export function getPlaidPersonalRedirectUri(): string {
  return plaidRedirectUri('personal');
}

/**
 * Start personal (PERS) bank connect — same Plaid Link as A&F, isolated books.
 */
export async function startPersonalBankConnect(input: {
  bankAccountId: string;
  actorLabel?: string;
}): Promise<{
  ok: boolean;
  connection: BankConnection;
  mode: 'live' | 'stub';
  message: string;
  linkToken?: string;
  redirectUri?: string;
}> {
  const bank = resolveFeedBank(input.bankAccountId);
  if (!bank || bank.books !== 'personal') {
    throw new Error(`Unknown personal bank ${input.bankAccountId}`);
  }
  const creds = detectFeedCredentials();
  const supabase = await createPersistClient();
  const redirectUri = plaidRedirectUri('personal');

  if (creds.ready && creds.provider === 'plaid') {
    const linkToken = await createPlaidLinkToken({
      clientUserId: `pers-${bank.id}`,
      clientName: 'Tage VC Personal',
      redirectUri,
    }).catch(() => null);
    if (linkToken) {
      if (supabase) {
        await supabase.from('os_af_bank_connections').upsert(
          {
            bank_account_id: bank.id,
            entity_code: 'PERS',
            provider: 'plaid',
            status: 'pending',
            institution_name: null,
            last_error: null,
            updated_at: new Date().toISOString(),
            meta: {
              books_id: 'PERS',
              link_started_at: new Date().toISOString(),
              redirect_uri: redirectUri,
            },
          },
          { onConflict: 'bank_account_id' },
        );
      }
      return {
        ok: true,
        mode: 'live',
        message: 'Plaid Link token issued for Personal Finance.',
        linkToken,
        redirectUri,
        connection: {
          bankAccountId: bank.id,
          entityCode: 'PERS',
          provider: 'plaid',
          status: 'pending',
          stubMode: false,
          linkToken,
        },
      };
    }
  }

  const stubConn: BankConnection = {
    bankAccountId: bank.id,
    entityCode: 'PERS',
    provider: 'stub',
    status: 'stubbed',
    accountMask: '••••',
    lastSyncAt: new Date().toISOString(),
    stubMode: true,
  };
  if (supabase) {
    await supabase.from('os_af_bank_connections').upsert(
      {
        bank_account_id: bank.id,
        entity_code: 'PERS',
        provider: 'stub',
        status: 'stubbed',
        account_mask: '0000',
        last_sync_at: new Date().toISOString(),
        last_error: creds.ready
          ? 'Provider API unavailable — stubbed'
          : `Missing secrets: ${creds.missing.join(', ')}`,
        updated_at: new Date().toISOString(),
        meta: { books_id: 'PERS', stub: true },
      },
      { onConflict: 'bank_account_id' },
    );
  }
  return {
    ok: true,
    mode: 'stub',
    message: 'Personal bank feed stubbed — add Plaid secrets for live Link.',
    connection: stubConn,
  };
}
