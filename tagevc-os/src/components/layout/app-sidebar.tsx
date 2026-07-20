'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Building2,
  Briefcase,
  FileText,
  History,
  Home,
  Landmark,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  Ticket,
  Warehouse,
} from 'lucide-react';
import { stopImpersonationAction } from '@/app/(app)/impersonation/actions';
import { RoleSwitcher } from '@/components/layout/role-switcher';
import { MessagesUnreadBadge } from '@/components/messaging/messages-unread-badge';
import { createClient } from '@/lib/supabase/client';
import { MAIN_NAV } from '@/lib/nav';
import {
  roleCanAccessModule,
  type AppRole,
  APP_ROLE_LABELS,
} from '@/lib/types/roles';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  command_center: Home,
  messages: MessageSquare,
  deal_flow_vc: Briefcase,
  deal_flow_ma: Building2,
  deal_flow_re: Warehouse,
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
};

export function AppSidebar({
  role,
  realRole,
  fullName,
  email,
  impersonatingAs,
  impersonatableRoles,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const items = MAIN_NAV.filter((item) => roleCanAccessModule(role, item.module));
  const showSwitcher = realRole === 'visionary' && impersonatableRoles.length > 0;

  async function signOut() {
    if (impersonatingAs) {
      await stopImpersonationAction();
    }
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="px-5 py-6">
        <p className="text-xs font-medium tracking-[0.18em] text-sidebar-foreground/60 uppercase">
          Tage VC
        </p>
        <h1 className="mt-1 font-heading text-lg font-semibold tracking-tight text-sidebar-foreground">
          Operating System
        </h1>
      </div>

      <nav className="flex-1 space-y-1 px-3 pb-4">
        {items.map((item) => {
          const Icon =
            item.href === '/activity'
              ? History
              : item.href === '/messages'
                ? MessageSquare
                : (ICONS[item.module] ?? Home);
          const active =
            item.href === '/deal-flow'
              ? pathname === '/deal-flow'
              : item.href === '/deal-flow/vc'
                ? pathname === '/deal-flow/vc' ||
                  (pathname.startsWith('/deal-flow/vc/') &&
                    !pathname.startsWith('/deal-flow/vc/intake'))
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-start gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="block font-medium">{item.label}</span>
                  {item.href === '/messages' ? <MessagesUnreadBadge /> : null}
                </span>
                {item.description ? (
                  <span className="mt-0.5 block text-xs opacity-70">
                    {item.description}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </nav>

      <Separator />
      <div className="space-y-3 px-4 py-4">
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
