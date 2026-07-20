/**
 * Lightweight observability helpers.
 * When SENTRY_DSN is set, errors are forwarded to Sentry (server-side).
 */

type Extra = Record<string, unknown>;

export function captureException(error: unknown, extra?: Extra) {
  const message =
    error instanceof Error ? error.message : String(error ?? 'unknown error');
  console.error('[observability]', message, extra ?? '');

  if (!process.env.SENTRY_DSN) return;

  void import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.captureException(error, { extra });
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
      Sentry.captureMessage(message, { level, extra });
    })
    .catch(() => undefined);
}

export function isSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}
