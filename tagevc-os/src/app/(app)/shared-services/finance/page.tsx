import { redirect } from 'next/navigation';

type Props = {
  searchParams?: Promise<{ entity?: string; ies?: string; reason?: string }>;
};

/**
 * Soft sunset: legacy Shared Services → Finance (IES control plane).
 * Canonical home is Tage VC A&F → Finance. Keep this route for old bookmarks
 * and OAuth callbacks; do not revive as a nav item.
 */
export default async function LegacyFinanceSunsetRedirect({
  searchParams,
}: Props) {
  const params = (await searchParams) ?? {};
  const qs = new URLSearchParams();
  if (params.entity?.trim()) qs.set('entity', params.entity.trim());
  if (params.ies?.trim()) qs.set('ies', params.ies.trim());
  if (params.reason?.trim()) qs.set('reason', params.reason.trim());
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  redirect(`/shared-services/af/finance${suffix}`);
}
