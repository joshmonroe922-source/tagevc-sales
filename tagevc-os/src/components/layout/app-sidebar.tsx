'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  ChevronRight,
  FileText,
  History,
  Home,
  Landmark,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  Ticket,
} from 'lucide-react';
import { stopImpersonationAction } from '@/app/(app)/impersonation/actions';
import { RoleSwitcher } from '@/components/layout/role-switcher';
import { LiveLookNavControl } from '@/components/layout/live-look-nav';
import { MessagesUnreadBadge } from '@/components/messaging/messages-unread-badge';
import { SidebarAvailabilityControl } from '@/components/messaging/sidebar-availability-control';
import { ActivityUnreadBadge } from '@/components/layout/activity-unread-badge';
import { createClient } from '@/lib/supabase/client';
import { MAIN_NAV, type NavItem } from '@/lib/nav';
import {
  roleCanAccessModule,
  type AppRole,
  APP_ROLE_LABELS,
} from '@/lib/types/roles';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { stopLiveLookAction } from '@/app/(app)/live-look/actions';

const NAV_ACCORDION_STORAGE_KEY = 'tagevc.nav.accordion.v1';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  command_center: Home,
  messages: MessageSquare,
  deal_flow_vc: Briefcase,
  deal_flow_ma: Briefcase,
  deal_flow_re: Briefcase,
  portfolio: LayoutDashboard,
  shared_services: Ticket,
  firm: Landmark,
  documents: FileText,
  admin: Settings,
};

type Props = {
  role: AppRole;
  realRole: AppRole;
  fullName: string | null;
  email: string;
  impersonatingAs: AppRole | null;
  impersonatableRoles: AppRole[];
  liveLookActive?: boolean;
};

function isNavActive(pathname: string, href: string): boolean {
  if (href === '/home') {
    return pathname === '/home';
  }
  if (href === '/dashboard') {
    return pathname === '/dashboard' || pathname.startsWith('/dashboard/');
  }
  if (href === '/help-desk') {
    return pathname === '/help-desk' || pathname.startsWith('/help-desk/');
  }
  if (href === '/deal-flow/vc/intake') {
    return (
      pathname === '/deal-flow/vc/intake' ||
      pathname.startsWith('/deal-flow/vc/intake/')
    );
  }
  if (href === '/deal-flow') {
    // Lead Intake is a sibling under Business Development — do not light both.
    if (
      pathname === '/deal-flow/vc/intake' ||
      pathname.startsWith('/deal-flow/vc/intake/')
    ) {
      return false;
    }
    return (
      pathname === '/deal-flow' ||
      pathname.startsWith('/deal-flow/vc') ||
      pathname.startsWith('/deal-flow/ma') ||
      pathname.startsWith('/deal-flow/re')
    );
  }
  if (href === '/portfolio') {
    return pathname === '/portfolio' || pathname.startsWith('/portfolio/');
  }
  if (href === '/entities') {
    return pathname === '/entities' || pathname.startsWith('/entities/');
  }
  if (href === '/portfolio/net-worth') {
    return (
      pathname === '/portfolio/net-worth' ||
      pathname.startsWith('/portfolio/net-worth/')
    );
  }
  if (href === '/portfolio') {
    return pathname === '/portfolio' || pathname.startsWith('/portfolio/');
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function childRouteActive(pathname: string, children: NavItem[]): boolean {
  return children.some(
    (c) => !!c.href && isNavActive(pathname, c.href),
  );
}

function readAccordionState(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(NAV_ACCORDION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAccordionState(state: Record<string, boolean>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      NAV_ACCORDION_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

function filterNavForRole(
  items: NavItem[],
  role: AppRole,
  realRole: AppRole,
  liveLookActive = false,
): NavItem[] {
  const out: NavItem[] = [];
  for (const item of items) {
    if (item.visionaryOnly && realRole !== 'visionary') continue;
    if (item.hideDuringLiveLook && liveLookActive) continue;
    if (!roleCanAccessModule(role, item.module)) continue;
    const children = item.children
      ? filterNavForRole(item.children, role, realRole, liveLookActive)
      : undefined;
    if (!item.href && (!children || children.length === 0)) continue;
    out.push({ ...item, children });
  }
  return out;
}

function NavGroup({
  item,
  pathname,
  expanded,
  onToggle,
}: {
  item: NavItem;
  pathname: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const GroupIcon = ICONS[item.module] ?? Briefcase;
  const children = item.children ?? [];
  const groupId = `nav-group-${item.label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="space-y-0.5 pt-1">
      <button
        type="button"
        id={groupId}
        aria-expanded={expanded}
        aria-controls={`${groupId}-panel`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className={cn(
          'flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
          'text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        )}
      >
        <GroupIcon className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block font-medium">{item.label}</span>
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 opacity-70 transition-transform duration-200',
                expanded && 'rotate-90',
              )}
              aria-hidden
            />
          </span>
          {item.description ? (
            <span className="mt-0.5 block text-xs opacity-70">
              {item.description}
            </span>
          ) : null}
        </span>
      </button>
      <div
        id={`${groupId}-panel`}
        role="region"
        aria-labelledby={groupId}
        hidden={!expanded}
        className={cn(expanded ? 'space-y-0.5' : 'hidden')}
      >
        {children.map((child) => (
          <NavLink
            key={child.href ?? child.label}
            item={child}
            pathname={pathname}
            nested
          />
        ))}
      </div>
    </div>
  );
}

function NavLink({
  item,
  pathname,
  nested = false,
}: {
  item: NavItem;
  pathname: string;
  nested?: boolean;
}) {
  if (!item.href) return null;
  const Icon =
    item.href === '/activity'
      ? History
      : item.href === '/messages'
        ? MessageSquare
        : item.href === '/home'
          ? Home
          : item.href === '/dashboard'
            ? LayoutDashboard
            : item.href === '/help-desk'
              ? Ticket
              : (ICONS[item.module] ?? Home);
  const active = isNavActive(pathname, item.href);

  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-start gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
        nested && 'py-2 pl-9',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
      )}
    >
      {!nested ? <Icon className="mt-0.5 size-4 shrink-0" /> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="block font-medium">{item.label}</span>
          {item.href === '/messages' ? <MessagesUnreadBadge /> : null}
          {item.href === '/activity' ? <ActivityUnreadBadge /> : null}
        </span>
        {item.description && !nested ? (
          <span className="mt-0.5 block text-xs opacity-70">
            {item.description}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export function AppSidebar({
  role,
  realRole,
  fullName,
  email,
  impersonatingAs,
  impersonatableRoles,
  liveLookActive = false,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const items = useMemo(
    () => filterNavForRole(MAIN_NAV, role, realRole, liveLookActive),
    [role, realRole, liveLookActive],
  );
  const showSwitcher =
    realRole === 'visionary' &&
    impersonatableRoles.length > 0 &&
    !liveLookActive;
  const showLiveLook = realRole === 'visionary' && !liveLookActive;

  const [accordion, setAccordion] = useState<Record<string, boolean>>({});
  const [accordionReady, setAccordionReady] = useState(false);

  useEffect(() => {
    const stored = readAccordionState();
    const next: Record<string, boolean> = { ...stored };
    for (const item of items) {
      if (!item.children?.length) continue;
      if (childRouteActive(pathname, item.children)) {
        next[item.label] = true;
      } else if (next[item.label] === undefined) {
        next[item.label] = false;
      }
    }
    setAccordion(next);
    setAccordionReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once; path effect below keeps active parents open
  }, []);

  useEffect(() => {
    if (!accordionReady) return;
    setAccordion((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of items) {
        if (!item.children?.length) continue;
        if (childRouteActive(pathname, item.children) && !next[item.label]) {
          next[item.label] = true;
          changed = true;
        }
      }
      if (changed) writeAccordionState(next);
      return changed ? next : prev;
    });
  }, [pathname, items, accordionReady]);

  const toggleGroup = (label: string) => {
    setAccordion((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      writeAccordionState(next);
      return next;
    });
  };

  async function signOut() {
    if (liveLookActive) {
      await stopLiveLookAction();
    }
    if (impersonatingAs) {
      await stopImpersonationAction();
    }
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="shrink-0 px-5 py-6">
        <SidebarAvailabilityControl />
        <p className="text-xs font-medium tracking-[0.18em] text-sidebar-foreground/60 uppercase">
          Tage VC
        </p>
        <h1 className="mt-1 font-heading text-lg font-semibold tracking-tight text-sidebar-foreground">
          Operating System
        </h1>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {showLiveLook ? (
          <div className="mb-1 px-0.5">
            <LiveLookNavControl />
          </div>
        ) : null}
        {items.map((item) => {
          if (item.children?.length) {
            const expanded = accordionReady
              ? Boolean(accordion[item.label])
              : childRouteActive(pathname, item.children);
            return (
              <NavGroup
                key={item.label}
                item={item}
                pathname={pathname}
                expanded={expanded}
                onToggle={() => toggleGroup(item.label)}
              />
            );
          }
          return (
            <NavLink
              key={item.href ?? item.label}
              item={item}
              pathname={pathname}
            />
          );
        })}
      </nav>

      <Separator className="shrink-0" />
      <div className="shrink-0 space-y-3 px-4 py-4">
        {showSwitcher ? (
          <RoleSwitcher
            roles={impersonatableRoles}
            current={impersonatingAs}
          />
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-sidebar-foreground">
            {fullName ?? email}
          </p>
          <p className="truncate text-xs text-sidebar-foreground/60">{email}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="font-normal">
              {APP_ROLE_LABELS[role]}
            </Badge>
            {impersonatingAs ? (
              <Badge variant="outline" className="font-normal">
                Real: Visionary
              </Badge>
            ) : null}
            {liveLookActive ? (
              <Badge variant="outline" className="font-normal">
                Live Look
              </Badge>
            ) : null}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={signOut}
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
