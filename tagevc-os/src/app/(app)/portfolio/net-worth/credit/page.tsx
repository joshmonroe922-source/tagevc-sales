import { redirect } from 'next/navigation';

/** Legacy path — Credit Management now lives under Personal. */
export default async function LegacyCreditManagementRedirect({
  searchParams,
}: {
  searchParams?: Promise<{ entity?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const entity = sp.entity?.trim();
  const qs = entity ? `?entity=${encodeURIComponent(entity)}` : '';
  redirect(`/personal/credit${qs}`);
}
