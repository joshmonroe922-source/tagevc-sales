/** Access-token lifetime on the shared Tage VC Supabase project. */
export const ACCESS_TOKEN_EXPIRY_SECONDS = 3600;

const TIMEOUT_RE =
  /jwt expired|invalid jwt|invalid.?token|auth session missing|session expired|not authenticated|unauthorized|401|pgrst301|signed out|token refresh|refresh.?token|chunkloaderror|loading chunk|failed to fetch dynamically imported module/i;

export function isSessionTimeoutError(
  error: { message?: string; name?: string; digest?: string } | null | undefined,
): boolean {
  if (!error) return true;
  const blob = [error.name, error.message, error.digest].filter(Boolean).join(' ');
  if (!blob.trim()) return true;
  return TIMEOUT_RE.test(blob);
}

export const SESSION_TIMEOUT_COPY = {
  kicker: 'Session ended',
  title: "You've timed out",
  body: 'You have timed out of the system. Refresh this page or log in again to continue.',
} as const;
