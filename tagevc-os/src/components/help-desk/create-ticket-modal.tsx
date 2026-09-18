'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const CreateTicketDialog = dynamic(
  () =>
    import('@/components/help-desk/create-ticket-dialog').then(
      (mod) => mod.CreateTicketDialog,
    ),
  { ssr: false },
);

type Ctx = {
  open: (preset?: { title?: string }) => void;
  close: () => void;
};

const CreateTicketModalContext = createContext<Ctx | null>(null);

export function useCreateTicketModal(): Ctx {
  const ctx = useContext(CreateTicketModalContext);
  if (!ctx) {
    return {
      open: () => {
        window.location.href = '/help-desk';
      },
      close: () => undefined,
    };
  }
  return ctx;
}

export function CreateTicketModalProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [presetTitle, setPresetTitle] = useState<string | undefined>();

  const open = useCallback((preset?: { title?: string }) => {
    setPresetTitle(preset?.title);
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <CreateTicketModalContext.Provider value={value}>
      {children}
      {visible ? (
        <CreateTicketDialog
          pathname={pathname}
          presetTitle={presetTitle}
          onClose={close}
        />
      ) : null}
    </CreateTicketModalContext.Provider>
  );
}

const createTicketBtnClass =
  'bg-[#3a414f] text-white hover:bg-[#535c63] focus-visible:ring-white/30';

export function GlobalCreateTicketButton() {
  const { open } = useCreateTicketModal();
  return (
    <div
      className="inline-flex items-stretch overflow-hidden rounded-[min(var(--radius-md),12px)] shadow-sm"
      role="group"
      aria-label="Create ticket and Help Desk"
    >
      <Button
        type="button"
        size="sm"
        onClick={() => open()}
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
            render={<Link href="/help-desk" />}
            className="cursor-pointer"
          >
            Help Desk
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
