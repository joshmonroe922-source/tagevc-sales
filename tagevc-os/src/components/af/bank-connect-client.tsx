'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { StatusPill } from '@/components/af/af-ui';
import {
  actionApplyPlaidAccountMaps,
  actionCompletePlaidLink,
  actionConnectBank,
  actionTestBankImport,
} from '@/app/(app)/shared-services/af/actions';
import {
  actionApplyPersonalPlaidMaps,
  actionCompletePersonalPlaidLink,
  actionConnectPersonalBank,
  actionSyncPersonalBank,
} from '@/app/(app)/personal/finance/actions';

export type BankConnectRow = {
  bankAccountId: string;
  name: string;
  entityCode: string;
  glAccount: string;
  bankType?: string;
  coaName?: string | null;
  status: string;
  stubMode: boolean;
  accountMask?: string | null;
  lastSyncAt?: string | null;
  message?: string;
};

type PlaidAccountOption = {
  accountId: string;
  name: string;
  mask: string | null;
  type: string | null;
  subtype: string | null;
};

type MatchSession = {
  sourceBankAccountId: string;
  institutionName: string | null;
  accounts: PlaidAccountOption[];
  selections: Record<string, string>;
};

type PlaidHandler = {
  open: () => void;
  exit: (opts?: { force?: boolean }) => void;
  destroy: () => void;
};

type PlaidExitError = {
  error_message?: string;
  display_message?: string;
  error_code?: string;
} | null;

type PlaidCreateConfig = {
  token: string;
  receivedRedirectUri?: string;
  onSuccess: (
    publicToken: string,
    metadata: {
      institution?: { name?: string } | null;
      accounts?: Array<{
        id?: string;
        name?: string;
        mask?: string;
        type?: string;
        subtype?: string;
      }>;
    },
  ) => void;
  onExit?: (err: PlaidExitError, metadata?: { status?: string | null }) => void;
};

declare global {
  interface Window {
    Plaid?: {
      create: (config: PlaidCreateConfig) => PlaidHandler;
    };
  }
}

const PLAID_OAUTH_TOKEN_KEY_AF = 'tagevc_plaid_link_token';
const PLAID_OAUTH_BANK_KEY_AF = 'tagevc_plaid_bank_account_id';
const PLAID_OAUTH_TOKEN_KEY_PERS = 'tagevc_personal_plaid_link_token';
const PLAID_OAUTH_BANK_KEY_PERS = 'tagevc_personal_plaid_bank_account_id';
const PLAID_REDIRECT_HINT =
  'https://app.tagevc.com/shared-services/af/setup/banks/connect';

function loadPlaidScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if (window.Plaid) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(
    'script[data-plaid-link]',
  );
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error('Plaid Link failed to load')),
      );
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.async = true;
    s.dataset.plaidLink = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Plaid Link failed to load'));
    document.body.appendChild(s);
  });
}

function oauthKeys(variant: 'af' | 'personal') {
  return variant === 'personal'
    ? {
        token: PLAID_OAUTH_TOKEN_KEY_PERS,
        bank: PLAID_OAUTH_BANK_KEY_PERS,
      }
    : {
        token: PLAID_OAUTH_TOKEN_KEY_AF,
        bank: PLAID_OAUTH_BANK_KEY_AF,
      };
}

function clearPlaidOauthSession(variant: 'af' | 'personal') {
  const keys = oauthKeys(variant);
  try {
    sessionStorage.removeItem(keys.token);
    sessionStorage.removeItem(keys.bank);
  } catch {
    /* ignore */
  }
}

function persistPlaidOauthSession(
  variant: 'af' | 'personal',
  bankAccountId: string,
  linkToken: string,
) {
  const keys = oauthKeys(variant);
  try {
    sessionStorage.setItem(keys.token, linkToken);
    sessionStorage.setItem(keys.bank, bankAccountId);
  } catch {
    /* ignore */
  }
}

function isOauthReturnUrl(href: string): boolean {
  return /[?&]oauth_state_id=/.test(href);
}

/** Digits-only last4; null when mask is missing/ambiguous. */
function normalizeLast4(mask: string | null | undefined): string | null {
  if (!mask) return null;
  const digits = mask.replace(/\D/g, '');
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

/** Every Plaid row starts unmapped — Josh picks OS banks explicitly. */
function buildBlankSelections(
  accounts: PlaidAccountOption[],
): Record<string, string> {
  const selections: Record<string, string> = {};
  for (const account of accounts) {
    selections[account.accountId] = '';
  }
  return selections;
}

function formatOsBankOptionLabel(
  row: BankConnectRow,
  opts?: { takenElsewhere?: boolean },
): string {
  const last4 = normalizeLast4(row.accountMask);
  const typeBit = row.bankType ? `${row.bankType} · ` : '';
  const coaBit = row.coaName ? ` · ${row.coaName}` : '';
  const maskBit = last4 ? ` · ••••${last4}` : '';
  const takenBit = opts?.takenElsewhere ? ' — already mapped' : '';
  return `${row.entityCode} · ${typeBit}${row.name} (${row.bankAccountId} → GL ${row.glAccount}${coaBit}${maskBit})${takenBit}`;
}

export function BankConnectClient({
  rows: initial,
  mapTargets: mapTargetsProp,
  credentialsReady,
  missingSecrets,
  redirectUri = PLAID_REDIRECT_HINT,
  variant = 'af',
}: {
  rows: BankConnectRow[];
  /** Full MD feed banks for Match dropdown (never entity-truncated). */
  mapTargets?: BankConnectRow[];
  credentialsReady: boolean;
  missingSecrets: string[];
  redirectUri?: string;
  variant?: 'af' | 'personal';
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState(initial);
  const [mapTargets] = useState(
    mapTargetsProp?.length ? mapTargetsProp : initial,
  );
  const [banner, setBanner] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchSession | null>(null);
  const oauthResumeStarted = useRef(false);
  const isPersonal = variant === 'personal';

  const connectAction = isPersonal
    ? actionConnectPersonalBank
    : actionConnectBank;
  const completeAction = isPersonal
    ? actionCompletePersonalPlaidLink
    : actionCompletePlaidLink;
  const applyAction = isPersonal
    ? actionApplyPersonalPlaidMaps
    : actionApplyPlaidAccountMaps;
  const syncAction = isPersonal
    ? actionSyncPersonalBank
    : actionTestBankImport;

  const destinationBanks = useMemo(() => {
    const maskById = new Map(
      rows.map((r) => [r.bankAccountId, r.accountMask] as const),
    );
    return mapTargets.map((t) => ({
      ...t,
      accountMask: maskById.get(t.bankAccountId) ?? t.accountMask,
    }));
  }, [mapTargets, rows]);

  const destinationsByEntity = useMemo(() => {
    const groups = new Map<string, BankConnectRow[]>();
    for (const bank of destinationBanks) {
      const list = groups.get(bank.entityCode) ?? [];
      list.push(bank);
      groups.set(bank.entityCode, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [destinationBanks]);

  const usedBankIds = useMemo(() => {
    if (!match) return new Set<string>();
    return new Set(
      Object.values(match.selections).filter((id) => Boolean(id)),
    );
  }, [match]);

  const handleLinkSuccess = useCallback(
    (
      bankAccountId: string,
      publicToken: string,
      metadata: {
        institution?: { name?: string } | null;
        accounts?: Array<{
          id?: string;
          name?: string;
          mask?: string;
          type?: string;
          subtype?: string;
        }>;
      },
    ) => {
      clearPlaidOauthSession(variant);
      if (
        typeof window !== 'undefined' &&
        isOauthReturnUrl(window.location.href)
      ) {
        window.history.replaceState(
          {},
          '',
          window.location.pathname + window.location.hash,
        );
      }
      start(async () => {
        const result = await completeAction({
          bankAccountId,
          publicToken,
          institutionName: metadata.institution?.name ?? null,
          accounts: metadata.accounts ?? [],
        });
        if (!result.ok) {
          setBanner(result.message || 'Plaid Link exchange failed');
          return;
        }
        if (result.needsMapping && result.accounts?.length) {
          const accounts = result.accounts;
          setMatch({
            sourceBankAccountId: result.sourceBankAccountId ?? bankAccountId,
            institutionName: result.institutionName ?? null,
            accounts,
            selections: buildBlankSelections(accounts),
          });
          setBanner(
            result.message ||
              `Choose OS bank for each of ${accounts.length} Plaid account(s), then Save mappings.`,
          );
          setRows((prev) =>
            prev.map((r) =>
              r.bankAccountId === bankAccountId
                ? { ...r, status: 'pending', stubMode: false }
                : r,
            ),
          );
          return;
        }
        setBanner(result.message);
        router.refresh();
      });
    },
    [router, variant, completeAction],
  );

  const openPlaidLink = useCallback(
    async (
      bankAccountId: string,
      linkToken: string,
      opts?: { receivedRedirectUri?: string },
    ) => {
      await loadPlaidScript();
      if (!window.Plaid) {
        throw new Error('Plaid Link unavailable');
      }
      if (!opts?.receivedRedirectUri) {
        persistPlaidOauthSession(variant, bankAccountId, linkToken);
      }
      const config: PlaidCreateConfig = {
        token: linkToken,
        onSuccess: (publicToken, metadata) => {
          handleLinkSuccess(bankAccountId, publicToken, metadata);
        },
        onExit: (err, metadata) => {
          if (!err) {
            if (metadata?.status === 'requires_oauth') {
              setBanner(
                'Continuing at your bank (OAuth)… finish login, then you return here.',
              );
            }
            return;
          }
          setBanner(
            err.display_message ||
              err.error_message ||
              err.error_code ||
              'Plaid Link exited',
          );
        },
      };
      if (opts?.receivedRedirectUri) {
        config.receivedRedirectUri = opts.receivedRedirectUri;
      }
      window.Plaid.create(config).open();
    },
    [handleLinkSuccess, variant],
  );

  useEffect(() => {
    if (oauthResumeStarted.current) return;
    if (typeof window === 'undefined') return;
    const href = window.location.href;
    if (!isOauthReturnUrl(href)) return;
    const keys = oauthKeys(variant);
    const linkToken = sessionStorage.getItem(keys.token);
    const bankAccountId = sessionStorage.getItem(keys.bank);
    if (!linkToken || !bankAccountId) {
      setBanner(
        'OAuth returned but Link session was lost — click Connect again. Confirm the Plaid redirect URI is registered.',
      );
      return;
    }
    oauthResumeStarted.current = true;
    setBanner('Resuming Plaid Link after bank OAuth…');
    void openPlaidLink(bankAccountId, linkToken, {
      receivedRedirectUri: href,
    }).catch((e) => {
      setBanner(
        e instanceof Error
          ? e.message
          : 'Could not resume Plaid Link after OAuth',
      );
    });
  }, [openPlaidLink, variant]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/80 bg-gradient-to-r from-[#f7f6f3] to-[#eef2f7] px-5 py-4">
        <p className="text-sm font-medium text-[#3a414f]">
          {credentialsReady
            ? 'Live Plaid credentials detected — Connect opens Plaid Link (OAuth banks like KeyBank redirect back here), then map last4 → OS banks.'
            : 'No bank OAuth secrets configured — connections run in clean stub mode.'}
        </p>
        {credentialsReady ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Plaid Allowed redirect URI must include:{' '}
            <span className="font-mono text-[11px] text-[#3a414f]">
              {redirectUri}
            </span>
          </p>
        ) : null}
        {!credentialsReady && (
          <p className="mt-1 text-xs text-muted-foreground">
            Provide {missingSecrets.slice(0, 2).join(' + ')} on Vercel to enable
            live Plaid.
          </p>
        )}
        {banner ? (
          <p className="mt-2 text-xs text-muted-foreground">{banner}</p>
        ) : null}
      </div>

      {match ? (
        <div className="space-y-4 rounded-xl border border-border px-4 py-4">
          <div>
            <p className="text-sm font-medium text-[#3a414f]">
              Match Plaid accounts
              {match.institutionName ? ` · ${match.institutionName}` : ''}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Left: every Plaid account from Link. Right: full MD bank / CoA cash
              list ({destinationBanks.length} options, all entities) — each
              starts as Select… (no auto-assign). Duplicate OS banks blocked.
            </p>
          </div>
          <ul className="space-y-3">
            {match.accounts.map((account) => {
              const selected = match.selections[account.accountId] ?? '';
              const last4 = normalizeLast4(account.mask);
              const typeLabel =
                [account.type, account.subtype].filter(Boolean).join(' / ') ||
                'account';
              return (
                <li
                  key={account.accountId}
                  className="flex flex-col gap-2 border-b border-border/60 pb-3 last:border-0 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Plaid account
                    </p>
                    <p className="text-sm font-medium text-[#3a414f]">
                      {account.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {typeLabel}
                      {last4 ? ` · last4 ${last4}` : ' · last4 n/a'}
                      {account.mask && account.mask !== last4
                        ? ` · mask ${account.mask}`
                        : ''}
                    </p>
                  </div>
                  <label className="flex w-full min-w-[18rem] max-w-xl flex-col gap-1 text-xs text-muted-foreground sm:w-[55%]">
                    Map to OS bank / CoA cash
                    <select
                      value={selected}
                      disabled={pending}
                      onChange={(e) => {
                        const next = e.target.value;
                        setMatch((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            selections: {
                              ...prev.selections,
                              [account.accountId]: next,
                            },
                          };
                        });
                      }}
                      className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-sm text-[#3a414f]"
                    >
                      <option value="">Select… / don’t map</option>
                      {destinationsByEntity.map(([entityCode, banks]) => (
                        <optgroup key={entityCode} label={`${entityCode} banks`}>
                          {banks.map((row) => {
                            const takenElsewhere =
                              usedBankIds.has(row.bankAccountId) &&
                              selected !== row.bankAccountId;
                            return (
                              <option
                                key={row.bankAccountId}
                                value={row.bankAccountId}
                                disabled={takenElsewhere}
                              >
                                {formatOsBankOptionLabel(row, {
                                  takenElsewhere,
                                })}
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || usedBankIds.size === 0}
              onClick={() =>
                start(async () => {
                  const mappings = Object.entries(match.selections)
                    .filter(([, bankAccountId]) => Boolean(bankAccountId))
                    .map(([plaidAccountId, bankAccountId]) => ({
                      plaidAccountId,
                      bankAccountId,
                    }));
                  const result = await applyAction({
                    sourceBankAccountId: match.sourceBankAccountId,
                    institutionName: match.institutionName,
                    mappings,
                  });
                  setBanner(result.message);
                  if (!result.ok) return;
                  const byId = new Map(
                    result.connected.map((c) => [c.bankAccountId, c]),
                  );
                  setRows((prev) =>
                    prev.map((r) => {
                      const hit = byId.get(r.bankAccountId);
                      if (!hit) return r;
                      return {
                        ...r,
                        status: 'connected',
                        stubMode: false,
                        accountMask: hit.accountMask ?? r.accountMask,
                        lastSyncAt: hit.lastSyncAt ?? new Date().toISOString(),
                      };
                    }),
                  );
                  setMatch(null);
                  router.refresh();
                })
              }
              className="rounded-md bg-[#3a414f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#535c63] disabled:opacity-50"
            >
              Save mappings
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setMatch(null);
                setBanner('Mapping cancelled — click Connect to try again.');
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <ul className="space-y-3">
        {rows.map((b, i) => (
          <li
            key={b.bankAccountId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-[#3a414f]">
                {i + 1}. {b.name} · {b.entityCode}
              </p>
              <p className="text-xs text-muted-foreground">
                {b.bankAccountId} → GL {b.glAccount}
                {b.accountMask ? ` · ••••${b.accountMask}` : ''}
                {b.lastSyncAt
                  ? ` · synced ${new Date(b.lastSyncAt).toLocaleString()}`
                  : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={b.status} />
              <button
                type="button"
                disabled={pending || Boolean(match)}
                onClick={() =>
                  start(async () => {
                    setBanner(null);
                    const result = await connectAction(b.bankAccountId);
                    setBanner(result.message);
                    if (result.mode === 'live' && result.linkToken) {
                      try {
                        await openPlaidLink(b.bankAccountId, result.linkToken);
                      } catch (e) {
                        setBanner(
                          e instanceof Error
                            ? e.message
                            : 'Could not open Plaid Link',
                        );
                      }
                    } else {
                      setRows((prev) =>
                        prev.map((r) =>
                          r.bankAccountId === b.bankAccountId
                            ? {
                                ...r,
                                status: result.connection.status,
                                stubMode: result.connection.stubMode,
                              }
                            : r,
                        ),
                      );
                      router.refresh();
                    }
                  })
                }
                className="rounded-md bg-[#3a414f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#535c63] disabled:opacity-50"
              >
                Connect
              </button>
              <button
                type="button"
                disabled={pending || Boolean(match)}
                onClick={() =>
                  start(async () => {
                    const result = await syncAction(b.bankAccountId);
                    setBanner(result.message);
                    setRows((prev) =>
                      prev.map((r) =>
                        r.bankAccountId === b.bankAccountId
                          ? {
                              ...r,
                              status: result.ok ? 'connected' : r.status,
                              lastSyncAt: new Date().toISOString(),
                            }
                          : r,
                      ),
                    );
                    router.refresh();
                  })
                }
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {isPersonal ? 'Sync live' : 'Sync live'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
