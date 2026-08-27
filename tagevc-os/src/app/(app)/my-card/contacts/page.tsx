import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/rbac/session';
import { listMyContacts } from '@/lib/digital-cards/repo';
import { entityDisplayName } from '@/lib/entities/display-name';
import { PortalReturnBanner } from '@/components/digital-cards/portal-return-banner';

export default async function MyCardContactsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getSessionContext();
  if (!ctx?.profile?.id) redirect('/login?next=/my-card/contacts');
  const contacts = await listMyContacts(ctx.profile.id, 100);

  const sp = (await searchParams) ?? {};
  const returnTo = typeof sp.return_to === 'string' ? sp.return_to : null;
  const from = typeof sp.from === 'string' ? sp.from : null;

  return (
    <div className="space-y-2">
      <PortalReturnBanner returnTo={returnTo} from={from} />
      <Link
        href="/my-card"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← My Card
      </Link>
      <h1 className="mt-3 font-heading text-3xl font-semibold text-[#3B4559]">
        Network contacts
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Source-tracked exchanges owned by you.
      </p>
      <ul className="mt-6 divide-y divide-[#e8e4dc] rounded-xl border border-[#e0dcd2] bg-white">
        {contacts.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            Inbox empty — share your card to collect contacts.
          </li>
        ) : (
          contacts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/my-card/contacts/${c.id}`}
                className="flex items-start justify-between gap-3 px-4 py-4 hover:bg-[#faf8f4]"
              >
                <div className="min-w-0">
                  <p className="font-medium text-[#3B4559]">{c.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {[c.title, c.company].filter(Boolean).join(' · ')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entityDisplayName(c.entity_id)} · {c.source_channel}
                    {c.event_tag ? ` · event:${c.event_tag}` : ''}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[#ece9e6] px-2 py-0.5 text-[11px]">
                  {c.status}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
