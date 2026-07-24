'use client';

import { entityDisplayName } from '@/lib/entities/display-name';
import { cn } from '@/lib/utils';

export const COMPANY_SELECT_OPTIONS = [
  { value: 'ENT-FIRM', label: 'Tage Venture Capital' },
  { value: 'ENT-R619', label: 'Recruit 619' },
  { value: 'ENT-INDA', label: 'Instant NDA' },
  { value: 'ENT-001', label: 'Sample Closed Co' },
  { value: 'ENT-003', label: 'Sample Indy SFR' },
] as const;

type Props = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (entityId: string) => void;
  allowAll?: boolean;
  allLabel?: string;
  required?: boolean;
  className?: string;
  /** Extra options (value stays entity id; label should be company name). */
  options?: Array<{ value: string; label: string }>;
};

/**
 * Company dropdown for forms/filters.
 * Values remain entity ids for routing/RBAC; labels are company names only.
 */
export function CompanySelect({
  id,
  name,
  value,
  defaultValue,
  onChange,
  allowAll = false,
  allLabel = 'All companies',
  required,
  className,
  options,
}: Props) {
  const list =
    options && options.length > 0
      ? options
      : COMPANY_SELECT_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
        }));

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
        : { defaultValue: defaultValue ?? (allowAll ? '' : list[0]?.value) })}
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
