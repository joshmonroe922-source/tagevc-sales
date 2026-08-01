import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';
import type { AdminRoleId } from '@/lib/vendor-mgmt/types';

const LINKS: Array<{ href: string; label: string }> = [
  { href: '/shared-services/ops/vendor-management', label: 'Dashboard' },
  { href: '/shared-services/ops/vendor-management/vendors', label: 'Vendors' },
  { href: '/shared-services/ops/vendor-management/renewals', label: 'Renewals' },
  { href: '/shared-services/ops/vendor-management/products', label: 'Products' },
  { href: '/shared-services/ops/vendor-management/roles', label: 'Roles' },
  { href: '/shared-services/ops/vendor-management/employees', label: 'People' },
  { href: '/shared-services/ops/vendor-management/access', label: 'Access' },
  { href: '/shared-services/ops/vendor-management/lifecycle', label: 'Lifecycle' },
  { href: '/shared-services/ops/vendor-management/budgets', label: 'Budgets' },
  { href: '/shared-services/ops/vendor-management/chargeback', label: 'Chargeback' },
  { href: '/shared-services/ops/vendor-management/usage', label: 'Usage' },
  { href: '/shared-services/ops/vendor-management/hire', label: 'Hire sim' },
  { href: '/shared-services/ops/vendor-management/alerts', label: 'Alerts' },
  { href: '/shared-services/ops/vendor-management/audit', label: 'Audit' },
  { href: '/shared-services/ops/vendor-management/integrations', label: 'Integrations' },
  { href: '/shared-services/ops/vendor-management/settings', label: 'Settings' },
  { href: '/shared-services/ops/vendor-management/cost-centers', label: 'Cost centers' },
  { href: '/shared-services/ops/vendor-management/admins', label: 'Admins' },
];

export function VmShell({
  title,
  description,
  context,
  active,
  adminRole,
  primaryAction,
  children,
}: {
  title: string;
  description?: string;
  context?: string;
  active: string;
  adminRole?: AdminRoleId;
  primaryAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Shared Services · Operations"
        title={title}
        description={description}
        context={
          context ||
          (adminRole
            ? `Vendor Management · ${adminRole}`
            : 'Vendor Management')
        }
        primaryAction={primaryAction}
        secondaryActions={
          <Link
            href="/shared-services/it/technology-stack"
            className="text-sm underline underline-offset-2"
          >
            Partner stack
          </Link>
        }
      />

      <nav className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        {LINKS.map((l) => {
          const isActive =
            active === l.href ||
            (active !== '/shared-services/ops/vendor-management' &&
              l.href !== '/shared-services/ops/vendor-management' &&
              active.startsWith(l.href));
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-[#3a414f] text-white'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}

export function VmStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="min-w-[140px] flex-1 border-b border-[#9F957C]/30 pb-3">
      <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 font-heading text-2xl font-semibold tracking-tight text-[#3a414f]">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function VmTable({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function money(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
  }).format(n);
}

export const ENTITY_OPTIONS = [
  { id: 'ENT-FIRM', label: 'TAGE · Tage VC' },
  { id: 'ENT-R619', label: 'R619 · Recruit 619' },
  { id: 'ENT-SIGNENT', label: 'SHR · Signent HR' },
  { id: 'ENT-INDA', label: 'INDA · Instant NDA' },
] as const;
