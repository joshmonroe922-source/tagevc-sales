import { createHash } from 'crypto';
import { z } from 'zod';

export const PAID_CONTRACT_VERSION = 'phase38-v2';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decimalText = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => /^\d+(?:\.\d{1,6})?$/.test(value), {
    message: 'Expected a non-negative decimal with at most 6 decimals',
  });
const integerText = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => /^\d+$/.test(value), {
    message: 'Expected a non-negative integer',
  })
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, { message: 'Integer exceeds safe range' });
const safeIntegerDecimalText = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine(
    (value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)),
    { message: 'Expected a non-negative safe integer' },
  );
const linkedInDate = z.object({
  year: z.number().int().min(2000).max(2200),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

export const metaCampaignPageSchema = z.object({
  data: z.array(
    z.object({
      campaign_id: z.string().min(1),
      date_start: isoDate,
      date_stop: isoDate,
      impressions: integerText,
      clicks: integerText,
      spend: decimalText,
      actions: z
        .array(
          z.object({
            action_type: z.string().min(1),
            value: decimalText,
          }),
        )
        .optional()
        .default([]),
    }),
  ),
  paging: z
    .object({
      cursors: z.object({ after: z.string().min(1).optional() }).optional(),
      next: z.string().url().optional(),
    })
    .optional(),
});

export const metaAccountPageSchema = z.object({
  data: z.array(
    z.object({
      account_id: z.string().min(1),
      date_start: isoDate,
      date_stop: isoDate,
      impressions: integerText,
      clicks: integerText,
      spend: decimalText,
    }),
  ),
  paging: z
    .object({
      cursors: z.object({ after: z.string().min(1).optional() }).optional(),
      next: z.string().url().optional(),
    })
    .optional(),
});

const linkedInPagingSchema = z
  .object({
    start: z.number().int().nonnegative().optional(),
    count: z.number().int().nonnegative().optional(),
    links: z
      .array(
        z.object({
          rel: z.string().optional(),
          href: z.string().optional(),
          type: z.string().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

export const linkedInCampaignPageSchema = z.object({
  elements: z.array(
    z.object({
      pivotValues: z.array(z.string()).min(1),
      dateRange: z.object({
        start: linkedInDate,
        end: linkedInDate,
      }),
      impressions: integerText,
      clicks: integerText,
      costInLocalCurrency: decimalText,
      externalWebsiteConversions: safeIntegerDecimalText
        .optional()
        .default('0'),
    }),
  ),
  paging: linkedInPagingSchema.optional(),
});

export const linkedInAccountPageSchema = z.object({
  elements: z.array(
    z.object({
      pivotValues: z.array(z.string()).min(1),
      dateRange: z.object({
        start: linkedInDate,
        end: linkedInDate,
      }),
      impressions: integerText,
      clicks: integerText,
      costInLocalCurrency: decimalText,
      externalWebsiteConversions: safeIntegerDecimalText
        .optional()
        .default('0'),
    }),
  ),
  paging: linkedInPagingSchema.optional(),
});

export type ContractMetricRow = {
  external_campaign_id: string;
  metric_date: string;
  impressions: number;
  clicks: number;
  spend: string;
  conversions: string | null;
};

export type AccountMetricRow = Omit<
  ContractMetricRow,
  'external_campaign_id'
> & {
  mapping_status?: 'complete' | 'gap';
};

export class PaidContractError extends Error {
  readonly code: string;
  readonly retryable: boolean = false;
  readonly errorClass: string = 'contract';

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PaidContractError';
    this.code = code;
  }
}

export class PaidProviderInconsistentError extends PaidContractError {
  readonly retryable = true;
  readonly errorClass = 'provider_transient';
}

export class PaidAuthorizationAmbiguousError extends PaidContractError {
  readonly errorClass = 'authorization';
}

function inWindow(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function metricDate(
  value: { year: number; month: number; day: number },
): string {
  return `${value.year}-${String(value.month).padStart(2, '0')}-${String(
    value.day,
  ).padStart(2, '0')}`;
}

function normalizeMetaAccountId(value: string): string {
  return value.trim().replace(/^act_/, '');
}

function sponsoredAccountUrn(value: string): string {
  return `urn:li:sponsoredAccount:${value.match(/(\d+)$/)?.[1] ?? ''}`;
}

function sponsoredCampaignUrn(value: string): string {
  return `urn:li:sponsoredCampaign:${value.match(/(\d+)$/)?.[1] ?? ''}`;
}

function assertLinkedInDailyRange(
  range: {
    start: { year: number; month: number; day: number };
    end: { year: number; month: number; day: number };
  },
  code: string,
) {
  const start = metricDate(range.start);
  const end = metricDate(range.end);
  if (start !== end) {
    throw new PaidContractError(
      code,
      `LinkedIn DAILY row must have identical start and end dates (${start}–${end})`,
    );
  }
  return start;
}

function assertNoLinkedInNextPage(
  paging: z.infer<typeof linkedInPagingSchema> | undefined,
) {
  if (
    paging?.links?.some(
      (link) => link.rel?.toLowerCase() === 'next' && Boolean(link.href),
    )
  ) {
    throw new PaidProviderInconsistentError(
      'linkedin_unexpected_pagination',
      'LinkedIn analytics returned a next-page link for a non-paginated request',
    );
  }
}

export function parseMetaCampaignPage(input: {
  raw: unknown;
  knownCampaignIds: Set<string>;
  conversionMetricByCampaign: Map<string, string | null>;
  windowStart: string;
  windowEnd: string;
}) {
  const parsed = metaCampaignPageSchema.safeParse(input.raw);
  if (!parsed.success) {
    throw new PaidContractError(
      'meta_contract_invalid',
      parsed.error.issues[0]?.message || 'Meta response contract failed',
    );
  }
  const seen = new Set<string>();
  const rows: ContractMetricRow[] = parsed.data.data.map((row) => {
    if (!input.knownCampaignIds.has(row.campaign_id)) {
      throw new PaidContractError(
        'meta_unknown_campaign',
        `Meta returned unknown campaign ${row.campaign_id}`,
      );
    }
    if (
      row.date_start !== row.date_stop ||
      !inWindow(row.date_start, input.windowStart, input.windowEnd)
    ) {
      throw new PaidContractError(
        'meta_date_outside_window',
        `Meta returned invalid daily date ${row.date_start}`,
      );
    }
    const key = `${row.campaign_id}:${row.date_start}`;
    if (seen.has(key)) {
      throw new PaidContractError(
        'meta_duplicate_metric',
        `Meta returned duplicate campaign/date ${key}`,
      );
    }
    seen.add(key);
    const conversionMetric =
      input.conversionMetricByCampaign.get(row.campaign_id) ?? null;
    return {
      external_campaign_id: row.campaign_id,
      metric_date: row.date_start,
      impressions: row.impressions,
      clicks: row.clicks,
      spend: row.spend,
      conversions: conversionMetric
        ? (row.actions.find(
            (action) => action.action_type === conversionMetric,
          )?.value ?? '0')
        : null,
    };
  });
  const nextCursor = parsed.data.paging?.next
    ? parsed.data.paging.cursors?.after
    : undefined;
  if (parsed.data.paging?.next && !nextCursor) {
    throw new PaidContractError(
      'meta_pagination_stalled',
      'Meta returned a next page without an after cursor',
    );
  }
  return { rows, nextCursor: nextCursor ?? null };
}

export function parseLinkedInCampaignPage(input: {
  raw: unknown;
  knownCampaignIds: Set<string>;
  windowStart: string;
  windowEnd: string;
}) {
  const parsed = linkedInCampaignPageSchema.safeParse(input.raw);
  if (!parsed.success) {
    throw new PaidContractError(
      'linkedin_contract_invalid',
      parsed.error.issues[0]?.message || 'LinkedIn response contract failed',
    );
  }
  assertNoLinkedInNextPage(parsed.data.paging);
  const seen = new Set<string>();
  const rows: ContractMetricRow[] = parsed.data.elements.map((row) => {
    const expectedUrns = new Map(
      [...input.knownCampaignIds].map((id) => [
        sponsoredCampaignUrn(id),
        id.match(/(\d+)$/)?.[1] ?? '',
      ]),
    );
    const exactUrn = row.pivotValues.find((value) =>
      expectedUrns.has(value),
    );
    const externalId = exactUrn ? expectedUrns.get(exactUrn) ?? '' : '';
    if (!exactUrn || !externalId) {
      throw new PaidContractError(
        'linkedin_campaign_identity_mismatch',
        'LinkedIn campaign pivot did not contain an exact expected sponsoredCampaign URN',
      );
    }
    const date = assertLinkedInDailyRange(
      row.dateRange,
      'linkedin_campaign_daily_range_invalid',
    );
    if (!inWindow(date, input.windowStart, input.windowEnd)) {
      throw new PaidContractError(
        'linkedin_date_outside_window',
        `LinkedIn returned date ${date} outside the leased window`,
      );
    }
    const key = `${externalId}:${date}`;
    if (seen.has(key)) {
      throw new PaidContractError(
        'linkedin_duplicate_metric',
        `LinkedIn returned duplicate campaign/date ${key}`,
      );
    }
    seen.add(key);
    return {
      external_campaign_id: externalId,
      metric_date: date,
      impressions: row.impressions,
      clicks: row.clicks,
      spend: row.costInLocalCurrency,
      conversions: row.externalWebsiteConversions,
    };
  });
  return { rows };
}

export function parseMetaAccountPage(input: {
  raw: unknown;
  expectedExternalAccountId: string;
  windowStart: string;
  windowEnd: string;
}) {
  const parsed = metaAccountPageSchema.safeParse(input.raw);
  if (!parsed.success) {
    throw new PaidContractError(
      'meta_account_contract_invalid',
      parsed.error.issues[0]?.message || 'Meta account response contract failed',
    );
  }
  const seen = new Set<string>();
  const rows: AccountMetricRow[] = parsed.data.data.map((row) => {
    if (
      normalizeMetaAccountId(row.account_id) !==
      normalizeMetaAccountId(input.expectedExternalAccountId)
    ) {
      throw new PaidContractError(
        'meta_account_identity_mismatch',
        `Meta account identity ${row.account_id} did not match the bound account`,
      );
    }
    if (
      row.date_start !== row.date_stop ||
      !inWindow(row.date_start, input.windowStart, input.windowEnd) ||
      seen.has(row.date_start)
    ) {
      throw new PaidContractError(
        'meta_account_date_invalid',
        `Meta returned an invalid or duplicate account date ${row.date_start}`,
      );
    }
    seen.add(row.date_start);
    return {
      metric_date: row.date_start,
      impressions: row.impressions,
      clicks: row.clicks,
      spend: row.spend,
      conversions: null,
    };
  });
  const nextCursor = parsed.data.paging?.next
    ? parsed.data.paging.cursors?.after
    : undefined;
  if (parsed.data.paging?.next && !nextCursor) {
    throw new PaidProviderInconsistentError(
      'meta_account_pagination_stalled',
      'Meta account totals returned a next page without an after cursor',
    );
  }
  return { rows, nextCursor: nextCursor ?? null };
}

export function parseLinkedInAccountPage(input: {
  raw: unknown;
  expectedExternalAccountId: string;
  windowStart: string;
  windowEnd: string;
}) {
  const parsed = linkedInAccountPageSchema.safeParse(input.raw);
  if (!parsed.success) {
    throw new PaidContractError(
      'linkedin_account_contract_invalid',
      parsed.error.issues[0]?.message ||
        'LinkedIn account response contract failed',
    );
  }
  assertNoLinkedInNextPage(parsed.data.paging);
  const seen = new Set<string>();
  return {
    rows: parsed.data.elements.map((row): AccountMetricRow => {
      const expectedUrn = sponsoredAccountUrn(input.expectedExternalAccountId);
      if (!row.pivotValues.includes(expectedUrn)) {
        throw new PaidContractError(
          'linkedin_account_identity_mismatch',
          'LinkedIn account pivot did not contain the exact bound sponsoredAccount URN',
        );
      }
      const date = assertLinkedInDailyRange(
        row.dateRange,
        'linkedin_account_daily_range_invalid',
      );
      if (
        !inWindow(date, input.windowStart, input.windowEnd) ||
        seen.has(date)
      ) {
        throw new PaidContractError(
          'linkedin_account_date_invalid',
          `LinkedIn returned an invalid or duplicate account date ${date}`,
        );
      }
      seen.add(date);
      return {
        metric_date: date,
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.costInLocalCurrency,
        conversions: String(row.externalWebsiteConversions),
      };
    }),
  };
}

export function linkedinAccountAccessConfirmed(
  raw: unknown,
  expectedExternalAccountId: string,
): boolean {
  const parsed = z
    .object({
      elements: z.array(
        z.object({ id: z.union([z.string(), z.number()]) }),
      ),
    })
    .safeParse(raw);
  if (!parsed.success) return false;
  const expectedId =
    expectedExternalAccountId.match(/(\d+)$/)?.[1] ?? '';
  return parsed.data.elements.some(
    (account) => String(account.id) === expectedId,
  );
}

const DECIMAL_SCALE = BigInt(1_000_000);
const BIGINT_ZERO = BigInt(0);

function decimalUnits(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * DECIMAL_SCALE + BigInt(fraction.padEnd(6, '0'));
}

function unitsDecimal(value: bigint): string {
  const whole = value / DECIMAL_SCALE;
  const fraction = (value % DECIMAL_SCALE).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function reconcileAccountDailyTotals(input: {
  campaignRows: ContractMetricRow[];
  providerRows: AccountMetricRow[];
  windowStart: string;
  windowEnd: string;
  reconcileConversions?: boolean;
}): AccountMetricRow[] {
  const providerDates = new Set<string>();
  for (const row of input.providerRows) {
    if (providerDates.has(row.metric_date)) {
      throw new PaidProviderInconsistentError(
        'provider_duplicate_account_date',
        `Provider returned duplicate account totals for ${row.metric_date}`,
      );
    }
    providerDates.add(row.metric_date);
  }
  const providerByDate = new Map(
    input.providerRows.map((row) => [row.metric_date, row]),
  );
  return datesBetween(input.windowStart, input.windowEnd).map((date) => {
    const provider = providerByDate.get(date) ?? {
      metric_date: date,
      impressions: 0,
      clicks: 0,
      spend: '0',
      conversions:
        (input.reconcileConversions ??
        input.providerRows.some((row) => row.conversions !== null))
          ? '0'
          : null,
    };
    const mapped = input.campaignRows.filter(
      (row) => row.metric_date === date,
    );
    const mappedImpressions = mapped.reduce(
      (sum, row) => sum + BigInt(row.impressions),
      BIGINT_ZERO,
    );
    const mappedClicks = mapped.reduce(
      (sum, row) => sum + BigInt(row.clicks),
      BIGINT_ZERO,
    );
    const mappedSpend = mapped.reduce(
      (sum, row) => sum + decimalUnits(row.spend),
      BIGINT_ZERO,
    );
    const mappedConversions = mapped.reduce(
      (sum, row) =>
        sum +
        (row.conversions === null
          ? BIGINT_ZERO
          : decimalUnits(row.conversions)),
      BIGINT_ZERO,
    );
    const providerConversions =
      provider.conversions === null
        ? null
        : decimalUnits(provider.conversions);
    if (
      mappedImpressions > BigInt(provider.impressions) ||
      mappedClicks > BigInt(provider.clicks) ||
      mappedSpend > decimalUnits(provider.spend) ||
      (providerConversions !== null &&
        mappedConversions > providerConversions)
    ) {
      throw new PaidProviderInconsistentError(
        'provider_account_total_below_mapped',
        `Provider account totals are below mapped campaign totals on ${date}`,
      );
    }
    const mappingComplete =
      mappedImpressions === BigInt(provider.impressions) &&
      mappedClicks === BigInt(provider.clicks) &&
      mappedSpend === decimalUnits(provider.spend) &&
      (providerConversions === null ||
        mappedConversions === providerConversions);
    return {
      ...provider,
      spend: unitsDecimal(decimalUnits(provider.spend)),
      conversions:
        providerConversions === null ? null : unitsDecimal(providerConversions),
      mapping_status: mappingComplete ? 'complete' : 'gap',
    };
  });
}

export function canonicalEvidenceHash(value: unknown): string {
  function canonicalize(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, nested]) => [key, canonicalize(nested)]),
      );
    }
    return input;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function parseRetryAfter(
  value: string | null,
  nowMs = Date.now(),
): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Math.min(Number(value), 21_600);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(Math.max(Math.ceil((date - nowMs) / 1000), 0), 21_600);
}

export function classifyPaidFailure(input: {
  status?: number;
  code?: string;
  message: string;
  retryAfter?: string | null;
}) {
  const status = input.status;
  const metaAuthorization = input.code === '190';
  const metaTransient = input.code === '613';
  const retryable =
    metaTransient ||
    (!metaAuthorization && status === 408) ||
    status === 425 ||
    status === 429 ||
    (status != null && status >= 500) ||
    status == null;
  return {
    retryable,
    errorClass: retryable
      ? status == null
        ? 'transport'
        : 'provider_transient'
      : metaAuthorization || status === 401 || status === 403
        ? 'authorization'
        : 'provider_permanent',
    code: input.code || (status ? `http_${status}` : 'transport_error'),
    retryAfterSeconds:
      parseRetryAfter(input.retryAfter ?? null) ??
      (retryable ? 300 : null),
  };
}
