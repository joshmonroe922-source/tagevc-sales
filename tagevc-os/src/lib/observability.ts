/**
 * Lightweight observability helpers.
 * When SENTRY_DSN is set, errors are forwarded to Sentry (server-side).
 */

type Extra = Record<string, unknown>;

function baseTags(): Record<string, string> {
  const tags: Record<string, string> = { app: 'tagevc-os' };
  if (process.env.WRITE_CUTOVER_ALL === '1') tags.cutover = 'all';
  else if (process.env.WRITE_CUTOVER_MATURE === '1') tags.cutover = 'mature';
  else tags.cutover = 'off';
  if (process.env.VERCEL_ENV) tags.vercel_env = process.env.VERCEL_ENV;
  return tags;
}

export function captureException(error: unknown, extra?: Extra) {
  const message =
    error instanceof Error ? error.message : String(error ?? 'unknown error');
  console.error('[observability]', message, extra ?? '');

  if (!process.env.SENTRY_DSN) return;

  void import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.withScope((scope) => {
        scope.setTags(baseTags());
        if (extra) scope.setExtras(extra);
        Sentry.captureException(error);
      });
    })
    .catch(() => {
      // Package missing or init failed — console already logged
    });
}

export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  extra?: Extra,
) {
  if (level === 'error') console.error('[observability]', message, extra ?? '');
  else if (level === 'warning') console.warn('[observability]', message, extra ?? '');
  else console.info('[observability]', message, extra ?? '');

  if (!process.env.SENTRY_DSN) return;

  void import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.withScope((scope) => {
        scope.setTags(baseTags());
        if (extra) scope.setExtras(extra);
        Sentry.captureMessage(message, level);
      });
    })
    .catch(() => undefined);
}

export function isSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}
