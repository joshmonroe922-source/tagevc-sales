/**
 * In-process record of last archive export download (Stage 4d retention ops).
 * Survives for the life of the serverless/process instance.
 */

export type ArchiveExportRecord = {
  exported_at: string;
  count: number;
  source: 'admin' | 'cron' | 'secret';
};

export type ArchiveExportConfirmation = {
  confirmed_at: string;
  note: string | null;
  source: 'admin' | 'env';
};

declare global {
  // eslint-disable-next-line no-var
  var __tageLastArchiveExport: ArchiveExportRecord | undefined;
  // eslint-disable-next-line no-var
  var __tageArchiveExportConfirmed: ArchiveExportConfirmation | undefined;
}

export function recordArchiveExport(rec: ArchiveExportRecord) {
  globalThis.__tageLastArchiveExport = rec;
}

export function getLastArchiveExport(): ArchiveExportRecord | null {
  return globalThis.__tageLastArchiveExport ?? null;
}

export function confirmArchiveExportOffsite(opts?: {
  note?: string | null;
}): ArchiveExportConfirmation {
  const rec: ArchiveExportConfirmation = {
    confirmed_at: new Date().toISOString(),
    note: opts?.note?.trim() || null,
    source: 'admin',
  };
  globalThis.__tageArchiveExportConfirmed = rec;
  return rec;
}

export function getInProcessArchiveConfirmation(): ArchiveExportConfirmation | null {
  return globalThis.__tageArchiveExportConfirmed ?? null;
}

/** Ops can set ARCHIVE_EXPORT_CONFIRMED_AT=ISO date after offsite store. */
export function getArchiveExportOpsConfirmation(): {
  confirmed: boolean;
  detail: string;
} {
  const envAt = process.env.ARCHIVE_EXPORT_CONFIRMED_AT?.trim();
  if (envAt) {
    return {
      confirmed: true,
      detail: `Ops confirmed at ${envAt} (ARCHIVE_EXPORT_CONFIRMED_AT)`,
    };
  }
  const inProc = getInProcessArchiveConfirmation();
  if (inProc) {
    return {
      confirmed: true,
      detail: `In-process confirm ${inProc.confirmed_at}${
        inProc.note ? ` · ${inProc.note}` : ''
      } (set ARCHIVE_EXPORT_CONFIRMED_AT for durable across deploys)`,
    };
  }
  const last = getLastArchiveExport();
  if (last) {
    return {
      confirmed: false,
      detail: `Last in-process export ${last.exported_at} · ${last.count} rows — confirm offsite store or set ARCHIVE_EXPORT_CONFIRMED_AT (≥90 days)`,
    };
  }
  return {
    confirmed: false,
    detail:
      'No export recorded — download /api/admin/archive-export and retain ≥90 days; confirm via POST or ARCHIVE_EXPORT_CONFIRMED_AT',
  };
}
