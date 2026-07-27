/**
 * Future bureau API stubs — fail-closed. Live path = guided upload only.
 */

export type AccountCreditApiProvider =
  | 'dnb_api'
  | 'experian_business_api'
  | 'equifax_business_api';

export function isAccountCreditApiEnabled(
  provider: AccountCreditApiProvider,
): boolean {
  const map: Record<AccountCreditApiProvider, string | undefined> = {
    dnb_api: process.env.ACCOUNT_CREDIT_DNB_API_ENABLED,
    experian_business_api: process.env.ACCOUNT_CREDIT_EXPERIAN_API_ENABLED,
    equifax_business_api: process.env.ACCOUNT_CREDIT_EQUIFAX_API_ENABLED,
  };
  return map[provider] === '1';
}

export async function fetchAccountCreditFromApi(_input: {
  provider: AccountCreditApiProvider;
  identifiers: Record<string, unknown>;
}): Promise<{ ok: false; error: string; dryRun: true }> {
  return {
    ok: false,
    dryRun: true,
    error:
      'Bureau APIs are scaffold-only this pass. Use guided PDF/export upload. Set ACCOUNT_CREDIT_*_API_ENABLED=1 only when a live integration ships.',
  };
}
