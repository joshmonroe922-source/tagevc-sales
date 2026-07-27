'use client';

import {
  DEFAULT_COMPANY_SELECT_OPTIONS,
  CONSOLIDATED_SELECT_LABEL,
  CONSOLIDATED_SELECT_VALUE,
  entitySelectLabel,
  sortEntitiesForSelect,
} from '@/lib/entities/display-order';
import { entityDisplayName } from '@/lib/entities/display-name';
import {
  isHiddenRegistryEntity,
  toVisibleCompanySelectOptions,
} from '@/lib/entities/registry-visibility';
import { cn } from '@/lib/utils';

/** @deprecated Prefer DEFAULT_COMPANY_SELECT_OPTIONS from display-order. */
export const COMPANY_SELECT_OPTIONS = DEFAULT_COMPANY_SELECT_OPTIONS;

type Props = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (entityId: string) => void;
  allowAll?: boolean;
  allLabel?: string;
  /** When true, prepend Consolidated rollup option. */
  allowConsolidated?: boolean;
  consolidatedLabel?: string;
  required?: boolean;
  className?: string;
  /** Extra options (value stays entity id; label should be company name). */
  options?: Array<{ value: string; label: string }>;
};

/**
 * Company dropdown for forms/filters.
 * Values remain entity ids for routing/RBAC; labels are company names only.
 * Order: Consolidated (optional) → Tage Venture Capital → Recruit 619 → Signent HR → Instant NDA → A–Z.
 * Samples / legacy Instant NDA duplicates are filtered via registry-visibility.
 */
export function CompanySelect({
  id,
  name,
  value,
  defaultValue,
  onChange,
  allowAll = false,
  allLabel = 'All companies',
  allowConsolidated = false,
  consolidatedLabel = CONSOLIDATED_SELECT_LABEL,
  required,
  className,
  options,
}: Props) {
  const base =
    options && options.length > 0
      ? toVisibleCompanySelectOptions(
          options.map((o) => ({
            entity_id: o.value,
            name:
              o.label ||
              entitySelectLabel(o.value) ||
              entityDisplayName(o.value),
          })),
        ).map((o) => ({ value: o.entity_id, label: o.name }))
      : DEFAULT_COMPANY_SELECT_OPTIONS.filter(
          (o) =>
            !isHiddenRegistryEntity({
              entity_id: o.value,
              canonical_name: o.label,
            }),
        ).map((o) => ({
          value: o.value,
          label: o.label,
        }));

  const sorted = sortEntitiesForSelect(
    base.map((o) => ({ value: o.value, label: o.label })),
  ).map((o) => ({
    value: String((o as { value: string }).value),
    label: String((o as { label: string }).label),
  }));

  const list = allowConsolidated
    ? [
        { value: CONSOLIDATED_SELECT_VALUE, label: consolidatedLabel },
        ...sorted.filter((o) => o.value !== CONSOLIDATED_SELECT_VALUE),
      ]
    : sorted;

  return (
    <select
      id={id}
      name={name}
      required={required}
      className={cn(
        'h-9 w-full min-w-[12rem] rounded-md border border-border bg-background px-2 text-sm',
        className,
      )}
      {...(value !== undefined
        ? { value, onChange: (e) => onChange?.(e.target.value) }
        : {
            defaultValue:
              defaultValue ??
              (allowAll
                ? ''
                : allowConsolidated
                  ? CONSOLIDATED_SELECT_VALUE
                  : list[0]?.value),
          })}
    >
      {allowAll ? <option value="">{allLabel}</option> : null}
      {list.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label || entityDisplayName(o.value)}
        </option>
      ))}
    </select>
  );
}
