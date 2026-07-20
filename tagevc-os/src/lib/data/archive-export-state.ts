/**
 * In-process record of last archive export download (Stage 4d retention ops).
 * Survives for the life of the serverless/process instance.
 */

export type ArchiveExportRecord = {
  exported_at: string;
  count: number;
  source: 'admin' | 'cron' | 'secret';
};

declare global {
  // eslint-disable-next-line no-var
  var __tageLastArchiveExport: ArchiveExportRecord | undefined;
}

export function recordArchiveExport(rec: ArchiveExportRecord) {
  globalThis.__tageLastArchiveExport = rec;
}

export function getLastArchiveExport(): ArchiveExportRecord | null {
  return globalThis.__tageLastArchiveExport ?? null;
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
  const last = getLastArchiveExport();
  if (last) {
    return {
      confirmed: false,
      detail: `Last in-process export ${last.exported_at} · ${last.count} rows — set ARCHIVE_EXPORT_CONFIRMED_AT after offsite store (≥90 days)`,
    };
  }
  return {
    confirmed: false,
    detail:
      'No export recorded — download /api/admin/archive-export and retain ≥90 days; set ARCHIVE_EXPORT_CONFIRMED_AT when done',
  };
}
