import { createHash } from 'crypto';
import { z } from 'zod';

export const PAID_CONTRACT_VERSION = 'phase37-v1';

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

export const linkedInCampaignPageSchema = z.object({
  elements: z.array(
    z.object({
      pivotValues: z.array(z.string()).min(1),
      dateRange: z.object({
        start: z.object({
          year: z.number().int().min(2000).max(2200),
          month: z.number().int().min(1).max(12),
          day: z.number().int().min(1).max(31),
        }),
      }),
      impressions: integerText,
      clicks: integerText,
      costInLocalCurrency: decimalText,
      externalWebsiteConversions: decimalText.optional().default('0'),
    }),
  ),
  paging: z.object({
    start: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});

export type ContractMetricRow = {
  external_campaign_id: string;
  metric_date: string;
  impressions: number;
  clicks: number;
  spend: string;
  conversions: string | null;
};

export class PaidContractError extends Error {
  readonly code: string;
  readonly retryable = false;
  readonly errorClass = 'contract';

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PaidContractError';
    this.code = code;
  }
}

function inWindow(date: string, start: string, end: string) {
  return date >= start && date <= end;
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
  requestedStart: number;
}) {
  const parsed = linkedInCampaignPageSchema.safeParse(input.raw);
  if (!parsed.success) {
    throw new PaidContractError(
      'linkedin_contract_invalid',
      parsed.error.issues[0]?.message || 'LinkedIn response contract failed',
    );
  }
  if (parsed.data.paging.start !== input.requestedStart) {
    throw new PaidContractError(
      'linkedin_paging_start_mismatch',
      'LinkedIn paging start did not match the requested offset',
    );
  }
  const seen = new Set<string>();
  const rows: ContractMetricRow[] = parsed.data.elements.map((row) => {
    const externalId = row.pivotValues[0]?.match(/(\d+)$/)?.[1] ?? '';
    if (!input.knownCampaignIds.has(externalId)) {
      throw new PaidContractError(
        'linkedin_unknown_campaign',
        `LinkedIn returned unknown campaign ${externalId || 'missing'}`,
      );
    }
    const { year, month, day } = row.dateRange.start;
    const metricDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!inWindow(metricDate, input.windowStart, input.windowEnd)) {
      throw new PaidContractError(
        'linkedin_date_outside_window',
        `LinkedIn returned date ${metricDate} outside the leased window`,
      );
    }
    const key = `${externalId}:${metricDate}`;
    if (seen.has(key)) {
      throw new PaidContractError(
        'linkedin_duplicate_metric',
        `LinkedIn returned duplicate campaign/date ${key}`,
      );
    }
    seen.add(key);
    return {
      external_campaign_id: externalId,
      metric_date: metricDate,
      impressions: row.impressions,
      clicks: row.clicks,
      spend: row.costInLocalCurrency,
      conversions: row.externalWebsiteConversions,
    };
  });
  const nextStart = parsed.data.paging.start + parsed.data.paging.count;
  if (
    parsed.data.paging.total > nextStart &&
    parsed.data.paging.count === 0
  ) {
    throw new PaidContractError(
      'linkedin_pagination_stalled',
      'LinkedIn paging made no progress',
    );
  }
  return {
    rows,
    nextStart:
      nextStart < parsed.data.paging.total ? nextStart : null,
    total: parsed.data.paging.total,
  };
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
