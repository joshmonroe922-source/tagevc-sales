export type PaidCurrencyTotal = {
  currency: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
};

export function authoritativePaidHeadlines(
  totals: PaidCurrencyTotal[],
): { spendK: number | null; ctr: number | null } {
  const impressions = totals.reduce(
    (sum, row) => sum + Number(row.impressions),
    0,
  );
  const clicks = totals.reduce((sum, row) => sum + Number(row.clicks), 0);
  return {
    spendK:
      totals.length === 1 ? Number(totals[0].spend) / 1000 : null,
    ctr: impressions > 0 ? clicks / impressions : null,
  };
}
