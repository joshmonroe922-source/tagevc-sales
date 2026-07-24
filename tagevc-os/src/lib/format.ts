export function formatUsdK(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPct(
  value: number | null | undefined,
  digits = 1,
): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatRunway(value: number | null | undefined): string {
  if (value == null) return 'n/a';
  return `${value} mo`;
}

export function formatDate(
  value: string | null | undefined,
  timeZone?: string | null,
): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  try {
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
}

export function formatDateTime(
  value: string | null | undefined,
  timeZone?: string | null,
): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  try {
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return d.toLocaleString('en-US');
  }
}
