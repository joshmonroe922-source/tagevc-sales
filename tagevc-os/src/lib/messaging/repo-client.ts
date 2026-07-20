import type { DirectoryProfile } from '@/lib/messaging/types';

export function displayName(
  p: DirectoryProfile | null | undefined,
  fallback = 'Unknown',
) {
  if (!p) return fallback;
  return p.full_name?.trim() || p.email || fallback;
}
