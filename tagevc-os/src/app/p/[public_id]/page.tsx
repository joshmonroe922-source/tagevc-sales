import { redirect } from 'next/navigation';

type PageProps = {
  params: Promise<{ public_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Short alias on app host → /card/p/{id} */
export default async function ShortPublicCardPage({
  params,
  searchParams,
}: PageProps) {
  const { public_id } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') qs.set(k, v);
  }
  const q = qs.toString();
  redirect(
    `/card/p/${encodeURIComponent(public_id)}${q ? `?${q}` : ''}`,
  );
}
