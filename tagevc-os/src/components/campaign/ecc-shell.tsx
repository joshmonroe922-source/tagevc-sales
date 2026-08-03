'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ECC_ROUTE_PREFIX } from '@/lib/campaign/core/types';

const NAV = [
  { href: ECC_ROUTE_PREFIX, label: 'Today', exact: true },
  { href: `${ECC_ROUTE_PREFIX}/campaigns`, label: 'Campaigns' },
  { href: `${ECC_ROUTE_PREFIX}/sequences`, label: 'Sequences' },
  { href: `${ECC_ROUTE_PREFIX}/audiences`, label: 'Audiences' },
  { href: `${ECC_ROUTE_PREFIX}/templates`, label: 'Templates' },
  { href: `${ECC_ROUTE_PREFIX}/analytics`, label: 'Analytics' },
  { href: `${ECC_ROUTE_PREFIX}/intelligence`, label: 'Intelligence' },
  { href: `${ECC_ROUTE_PREFIX}/deliverability`, label: 'Deliverability' },
  { href: `${ECC_ROUTE_PREFIX}/settings`, label: 'Settings' },
] as const;

export function EccShell({ children, entityLabel }: { children: React.ReactNode; entityLabel?: string }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl border border-[#d7d3c3] bg-gradient-to-br from-[#ece9e6] via-[#e8e4de] to-[#d7d3c3] px-5 py-6 sm:px-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#9f957c]/20 blur-3xl" aria-hidden />
        <p className="text-xs font-medium tracking-[0.2em] text-[#7c7871] uppercase">Shared Services · Marketing</p>
        <h1 className="font-heading mt-1 text-3xl font-semibold tracking-tight text-[#3a414f]">Email Campaign Center</h1>
        <p className="mt-2 max-w-xl text-sm text-[#7c7871]">
          Owned campaign platform for Tage + subsidiaries. Graph for 1:1 · controlled bulk with Reply-To + tracking.
        </p>
        {entityLabel ? <p className="mt-3 text-xs font-medium text-[#535c63]">{entityLabel}</p> : null}
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-[#d7d3c3] pb-px" aria-label="Email Campaign Center">
        {NAV.map((item) => {
          const exact = 'exact' in item && item.exact;
          const active = exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} className={cn(
              'rounded-t-md px-3 py-2 text-sm transition-colors',
              active ? 'border border-b-white border-[#d7d3c3] bg-white font-medium text-[#3a414f]' : 'text-[#7c7871] hover:text-[#3a414f]',
            )}>{item.label}</Link>
          );
        })}
      </nav>
      <div>{children}</div>
    </div>
  );
}
