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
import { filterNavForRole } from '@/lib/nav/role-visibility';
import {
  type AppRole,
  APP_ROLE_LABELS,
} from '@/lib/types/roles';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { stopLiveLookAction } from '@/app/(app)/live-look/actions';
import { canUseLiveLook } from '@/lib/live-look/access';

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
  /** Effective profile entity — labels Subsidiary Leader company nav. */
  entityId?: string | null;
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
  if (href === '/activity') {
    return pathname === '/activity' || pathname.startsWith('/activity/');
  }
  if (href === '/admin') {
    // Audit log nests under Technology/IT — do not light Admin.
    // Document Library + DocuSign nest under Admin — children light themselves.
    if (
      pathname === '/admin/audit' ||
      pathname.startsWith('/admin/audit/') ||
      pathname === '/documents' ||
      pathname.startsWith('/documents/') ||
      pathname === '/shared-services/legal/docusign' ||
      pathname.startsWith('/shared-services/legal/docusign/')
    ) {
      return false;
    }
    return pathname === '/admin' || pathname.startsWith('/admin/');
  }
  if (href === '/deal-flow/vc/intake') {
    return (
      pathname === '/deal-flow/vc/intake' ||
      pathname.startsWith('/deal-flow/vc/intake/')
    );
  }
  if (href === '/deal-flow/vc') {
    // VC Sourcing portal — include intake/deals/IC under /deal-flow/vc/*
    return (
      pathname === '/deal-flow/vc' || pathname.startsWith('/deal-flow/vc/')
    );
  }
  if (href === '/deal-flow/ma') {
    return (
      pathname === '/deal-flow/ma' || pathname.startsWith('/deal-flow/ma/')
    );
  }
  if (href === '/deal-flow/re') {
    return (
      pathname === '/deal-flow/re' || pathname.startsWith('/deal-flow/re/')
    );
  }
  if (href === '/deal-flow') {
    // Track portals + Lead Intake are siblings under BD — do not light hub too.
    if (
      pathname === '/deal-flow/vc/intake' ||
      pathname.startsWith('/deal-flow/vc/intake/') ||
      pathname === '/deal-flow/vc' ||
      pathname.startsWith('/deal-flow/vc/') ||
      pathname === '/deal-flow/ma' ||
      pathname.startsWith('/deal-flow/ma/') ||
      pathname === '/deal-flow/re' ||
      pathname.startsWith('/deal-flow/re/')
    ) {
      return false;
    }
    return pathname === '/deal-flow' || pathname.startsWith('/deal-flow/');
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
  if (href === '/portfolio/investments') {
    return (
      pathname === '/portfolio/investments' ||
      pathname.startsWith('/portfolio/investments/')
    );
  }
  if (href === '/portfolio/real-estate') {
    return (
      pathname === '/portfolio/real-estate' ||
      pathname.startsWith('/portfolio/real-estate/')
    );
  }
  if (href === '/portfolio') {
    return pathname === '/portfolio' || pathname.startsWith('/portfolio/');
  }
  if (href === '/shared-services/af/accounting') {
    return (
      pathname === '/shared-services/af/accounting' ||
      pathname.startsWith('/shared-services/af/accounting/')
    );
  }
  if (href === '/shared-services/af/finance') {
    return (
      pathname === '/shared-services/af/finance' ||
      pathname.startsWith('/shared-services/af/finance/')
    );
  }
  if (href === '/shared-services/af/audit') {
    return (
      pathname === '/shared-services/af/audit' ||
      pathname.startsWith('/shared-services/af/audit/')
    );
  }
  if (href === '/shared-services/af/controls') {
    return (
      pathname === '/shared-services/af/controls' ||
      pathname.startsWith('/shared-services/af/controls/')
    );
  }
  if (href === '/personal/finance') {
    return (
      pathname === '/personal/finance' ||
      pathname.startsWith('/personal/finance/')
    );
  }
  if (href === '/shared-services/af') {
    // Nested A&F children light themselves — do not light A&F hub.
    if (
      pathname === '/shared-services/af/accounting' ||
      pathname.startsWith('/shared-services/af/accounting/') ||
      pathname === '/shared-services/af/finance' ||
      pathname.startsWith('/shared-services/af/finance/') ||
      pathname === '/shared-services/af/audit' ||
      pathname.startsWith('/shared-services/af/audit/') ||
      pathname === '/shared-services/af/controls' ||
      pathname.startsWith('/shared-services/af/controls/') ||
      pathname === '/shared-services/af/setup' ||
      pathname.startsWith('/shared-services/af/setup/')
    ) {
      return false;
    }
    return (
      pathname === '/shared-services/af' ||
      pathname.startsWith('/shared-services/af/')
    );
  }
  if (href === '/shared-services/finance') {
    return (
      pathname === '/shared-services/finance' ||
      pathname.startsWith('/shared-services/finance/')
    );
  }
  if (href === '/shared-services/hr/screening') {
    return (
      pathname === '/shared-services/hr/screening' ||
      pathname.startsWith('/shared-services/hr/screening/')
    );
  }
  if (href === '/shared-services/hr') {
    // Screening is nested under HR — do not light both.
    if (
      pathname === '/shared-services/hr/screening' ||
      pathname.startsWith('/shared-services/hr/screening/')
    ) {
      return false;
    }
    return (
      pathname === '/shared-services/hr' ||
      pathname.startsWith('/shared-services/hr/')
    );
  }
  if (href === '/shared-services/it/activity') {
    return (
      pathname === '/shared-services/it/activity' ||
      pathname.startsWith('/shared-services/it/activity/')
    );
  }
  if (href === '/shared-services/it/assets') {
    // Nested IT children (Activity / Visionary Audit) — do not light IT home.
    if (
      pathname === '/shared-services/it/activity' ||
      pathname.startsWith('/shared-services/it/activity/') ||
      pathname === '/admin/audit' ||
      pathname.startsWith('/admin/audit/')
    ) {
      return false;
    }
    return (
      pathname === '/shared-services/it' ||
      pathname.startsWith('/shared-services/it/')
    );
  }
  if (href === '/shared-services/marketing') {
    return (
      pathname === '/shared-services/marketing' ||
      pathname.startsWith('/shared-services/marketing/')
    );
  }
  if (href === '/shared-services/legal/docusign') {
    return (
      pathname === '/shared-services/legal/docusign' ||
      pathname.startsWith('/shared-services/legal/docusign/')
    );
  }
  if (href === '/shared-services/legal') {
    // DocuSign lives under Admin — do not light Legal desk.
    if (
      pathname === '/shared-services/legal/docusign' ||
      pathname.startsWith('/shared-services/legal/docusign/')
    ) {
      return false;
    }
    return (
      pathname === '/shared-services/legal' ||
      pathname.startsWith('/shared-services/legal/')
    );
  }
  if (href === '/documents') {
    return (
      pathname === '/documents' || pathname.startsWith('/documents/')
    );
  }
  if (href === '/admin/audit') {
    return (
      pathname === '/admin/audit' || pathname.startsWith('/admin/audit/')
    );
  }
  if (href === '/c-suite') {
    return pathname === '/c-suite';
  }
  if (href.startsWith('/c-suite/')) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function childRouteActive(pathname: string, children: NavItem[]): boolean {
  return children.some(
    (c) =>
      (!!c.href && isNavActive(pathname, c.href)) ||
      (!!c.children?.length && childRouteActive(pathname, c.children)),
  );
}

/** Force-open every ancestor whose descendant route is active. */
function applyActiveAccordionParents(
  items: NavItem[],
  pathname: string,
  next: Record<string, boolean>,
): boolean {
  let changed = false;
  for (const item of items) {
    if (!item.children?.length) continue;
    if (childRouteActive(pathname, item.children)) {
      if (!next[item.label]) {
        next[item.label] = true;
        changed = true;
      }
      if (applyActiveAccordionParents(item.children, pathname, next)) {
        changed = true;
      }
    }
  }
  return changed;
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

function NavGroup({
  item,
  pathname,
  expanded,
  onToggle,
  accordion,
  onToggleGroup,
  depth = 0,
}: {
  item: NavItem;
  pathname: string;
  expanded: boolean;
  onToggle: () => void;
  accordion: Record<string, boolean>;
  onToggleGroup: (label: string) => void;
  depth?: number;
}) {
  const GroupIcon = ICONS[item.module] ?? Briefcase;
  const children = item.children ?? [];
  const groupId = `nav-group-${item.label.replace(/\s+/g, '-').toLowerCase()}`;
  const nested = depth > 0;
  const active = item.href ? isNavActive(pathname, item.href) : false;

  const chevron = (
    <ChevronRight
      className={cn(
        'size-3.5 shrink-0 opacity-70 transition-transform duration-200 motion-reduce:transition-none',
        expanded && 'rotate-90',
      )}
      aria-hidden
    />
  );

  return (
    <div className={cn('space-y-0.5', !nested && 'pt-1')}>
      {item.href ? (
        <div
          className={cn(
            'flex w-full items-start gap-1 rounded-md text-sm transition-colors',
            nested ? 'py-0 pl-9' : 'px-0',
            active
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
          )}
        >
          <Link
            href={item.href}
            className={cn(
              'flex min-w-0 flex-1 items-start gap-3 rounded-md px-3 py-2 text-left',
              nested && 'pl-0',
            )}
          >
            {!nested ? <GroupIcon className="mt-0.5 size-4 shrink-0" /> : null}
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{item.label}</span>
              {item.description && !nested ? (
                <span className="mt-0.5 block text-xs opacity-70">
                  {item.description}
                </span>
              ) : null}
            </span>
          </Link>
          <button
            type="button"
            id={groupId}
            aria-expanded={expanded}
            aria-controls={`${groupId}-panel`}
            aria-label={`Toggle ${item.label} submenu`}
            onClick={onToggle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggle();
              }
            }}
            className={cn(
              'mt-1 mr-1 shrink-0 rounded-md p-1.5',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            )}
          >
            {chevron}
          </button>
        </div>
      ) : (
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
            nested && 'pl-9',
          )}
        >
          {!nested ? <GroupIcon className="mt-0.5 size-4 shrink-0" /> : null}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="block font-medium">{item.label}</span>
              {chevron}
            </span>
            {item.description && !nested ? (
              <span className="mt-0.5 block text-xs opacity-70">
                {item.description}
              </span>
            ) : null}
          </span>
        </button>
      )}
      <div
        id={`${groupId}-panel`}
        role="region"
        aria-labelledby={groupId}
        hidden={!expanded}
        className={cn(expanded ? 'space-y-0.5' : 'hidden')}
      >
        {children.map((child) => {
          if (child.children?.length) {
            const childExpanded = Boolean(accordion[child.label]);
            return (
              <NavGroup
                key={child.label}
                item={child}
                pathname={pathname}
                expanded={childExpanded}
                onToggle={() => onToggleGroup(child.label)}
                accordion={accordion}
                onToggleGroup={onToggleGroup}
                depth={depth + 1}
              />
            );
          }
          return (
            <NavLink
              key={child.href ?? child.label}
              item={child}
              pathname={pathname}
              nested
              depth={depth + 1}
            />
          );
        })}
      </div>
    </div>
  );
}

function NavLink({
  item,
  pathname,
  nested = false,
  depth = 0,
}: {
  item: NavItem;
  pathname: string;
  nested?: boolean;
  depth?: number;
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
        nested && (depth >= 2 ? 'py-2 pl-14' : 'py-2 pl-9'),
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

type SidebarVariant = 'desktop' | 'panel';

export function AppSidebar({
  role,
  realRole,
  fullName,
  email,
  impersonatingAs,
  impersonatableRoles,
  liveLookActive = false,
  entityId = null,
  variant = 'desktop',
}: Props & { variant?: SidebarVariant }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = useMemo(
    () =>
      filterNavForRole(MAIN_NAV, {
        role,
        realRole,
        liveLookActive,
        entityId,
      }),
    [role, realRole, liveLookActive, entityId],
  );
  const showSwitcher =
    realRole === 'visionary' &&
    impersonatableRoles.length > 0 &&
    !liveLookActive;
  const showLiveLook =
    !liveLookActive &&
    canUseLiveLook({
      email,
      realRole,
      effectiveRole: role,
      impersonatingAs,
    });

  const [accordion, setAccordion] = useState<Record<string, boolean>>({});
  const [accordionReady, setAccordionReady] = useState(false);

  useEffect(() => {
    const stored = readAccordionState();
    const next: Record<string, boolean> = { ...stored };
    for (const item of items) {
      if (!item.children?.length) continue;
      if (next[item.label] === undefined) {
        next[item.label] = false;
      }
    }
    applyActiveAccordionParents(items, pathname, next);
    setAccordion(next);
    setAccordionReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once; path effect below keeps active parents open
  }, []);

  useEffect(() => {
    if (!accordionReady) return;
    setAccordion((prev) => {
      const next = { ...prev };
      const changed = applyActiveAccordionParents(items, pathname, next);
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

  const shellClass =
    variant === 'panel'
      ? 'flex h-full w-full flex-col overflow-hidden bg-sidebar text-sidebar-foreground'
      : cn(
          // Desktop only: pin to viewport. Phone uses MobileNavDrawer in AppTopBar.
          'sticky top-0 z-20 hidden h-dvh max-h-dvh w-64 shrink-0 flex-col self-start md:flex',
          'overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        );

  return (
    <aside className={shellClass}>
      <div className="shrink-0 px-5 py-6">
        <SidebarAvailabilityControl />
        <p className="text-xs font-medium tracking-[0.18em] text-sidebar-foreground/60 uppercase">
          Tage VC
        </p>
        <h1 className="mt-1 font-heading text-lg font-semibold tracking-tight text-sidebar-foreground">
          Operating System
        </h1>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 pb-4">
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
                accordion={accordion}
                onToggleGroup={toggleGroup}
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
