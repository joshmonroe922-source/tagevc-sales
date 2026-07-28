'use client';

/**
 * Portable Create Ticket split-button (Tage AppTopBar pattern).
 * Copy into subsidiary `create-ticket-modal.tsx` as GlobalCreateTicketButton.
 * Wire `useCreateTicketModal` + Link/DropdownMenu from the portal.
 */
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const createTicketBtnClass =
  'bg-[#3a414f] text-white hover:bg-[#535c63] focus-visible:ring-white/30';

export function CreateTicketSplitButton({
  onCreate,
  helpDeskHref = '/help-desk',
}: {
  onCreate: () => void;
  helpDeskHref?: string;
}) {
  return (
    <div
      className="inline-flex items-stretch overflow-hidden rounded-[min(var(--radius-md),12px)] shadow-sm"
      role="group"
      aria-label="Create ticket and Help Desk"
    >
      <Button
        type="button"
        size="sm"
        onClick={onCreate}
        className={cn(createTicketBtnClass, 'rounded-none rounded-l-[inherit]')}
      >
        Create Ticket
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          aria-label="Open Help Desk menu"
          className={cn(
            buttonVariants({ size: 'sm' }),
            createTicketBtnClass,
            'rounded-none rounded-r-[inherit] border-l border-white/20 px-1.5',
          )}
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-40">
          <DropdownMenuItem
            render={<Link href={helpDeskHref} />}
            className="cursor-pointer"
          >
            Help Desk
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
