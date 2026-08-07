import { redirect } from 'next/navigation';

type PageProps = {
  params: Promise<{ public_id: string; alias: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Path alias → same card with source from alias (e.g. /l/linkedin). */
export default async function PublicCardAliasPage({
  params,
  searchParams,
}: PageProps) {
  const { public_id, alias } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set('src', alias.toLowerCase());
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'src') continue;
    if (typeof v === 'string') qs.set(k, v);
  }
  redirect(`/card/p/${encodeURIComponent(public_id)}?${qs.toString()}`);
}
