/**
 * Optional connector scaffolds for Net Worth — always fail-soft.
 */

export type ConnectorProbe = {
  kind: string;
  configured: boolean;
  detail: string;
};

export function probeNetWorthConnectors(): ConnectorProbe[] {
  const plaid =
    Boolean(process.env.PLAID_CLIENT_ID) && Boolean(process.env.PLAID_SECRET);
  const crypto =
    Boolean(process.env.CRYPTO_EXCHANGE_API_KEY) ||
    Boolean(process.env.COINBASE_API_KEY);
  const dnb = Boolean(process.env.DNB_API_KEY);

  return [
    {
      kind: 'plaid',
      configured: plaid,
      detail: plaid
        ? 'Plaid credentials present — live sync not wired in v1'
        : 'Set PLAID_CLIENT_ID + PLAID_SECRET for brokerage/bank sync (future)',
    },
    {
      kind: 'crypto_exchange',
      configured: crypto,
      detail: crypto
        ? 'Exchange API key present — live sync not wired in v1'
        : 'Set CRYPTO_EXCHANGE_API_KEY or COINBASE_API_KEY for crypto sync (future)',
    },
    {
      kind: 'dnb',
      configured: dnb,
      detail: dnb
        ? 'D&B key present — enable DNB_API_ENABLED=1 when endpoint is ready'
        : 'Set DNB_API_KEY + DNB_API_ENABLED=1 for business credit pull (future)',
    },
  ];
}
