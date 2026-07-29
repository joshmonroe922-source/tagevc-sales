'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * Phone-only nav drawer (below `md`). Desktop keeps the sticky left sidebar.
 * Place in AppTopBar near Alerts / Create Ticket. Children = full sidebar panel.
 */
export function MobileNavDrawer({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        type="button"
        aria-label="Open navigation menu"
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'gap-1.5 md:hidden',
        )}
      >
        <Menu className="size-4" aria-hidden />
        Menu
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton
        className={cn(
          'w-[min(100vw,18rem)] gap-0 border-sidebar-border bg-sidebar p-0',
          'text-sidebar-foreground sm:max-w-xs',
        )}
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex h-full max-h-dvh flex-col overflow-hidden">
          {/* Mount panel only while open — avoids duplicate sidebar side-effects while closed. */}
          {open ? children : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
