'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { createHelpDeskTicketAction } from '@/app/(app)/help-desk/actions';
import { CompanySelect } from '@/components/shared/company-select';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SS_SERVICES, TICKET_PRIORITIES } from '@/lib/types';
import { capturePageScreenshot } from '@/lib/help-desk/screenshot';
import { cn } from '@/lib/utils';

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
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [service, setService] = useState<(typeof SS_SERVICES)[number]>('IT');
  const [priority, setPriority] = useState<(typeof TICKET_PRIORITIES)[number]>('P2');
  const [entityId, setEntityId] = useState('ENT-FIRM');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = useCallback((preset?: { title?: string }) => {
    setVisible(true);
    setError(null);
    setOkMsg(null);
    if (preset?.title) setTitle(preset.title);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  const value = useMemo(() => ({ open, close }), [open, close]);

  function submit() {
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      let screenshotDataUrl: string | null = null;
      let screenshotNote: string | null = null;
      try {
        screenshotDataUrl = await capturePageScreenshot();
      } catch {
        screenshotNote = 'Screenshot capture blocked — page path recorded instead.';
      }

      const fd = new FormData();
      fd.set('title', title.trim());
      fd.set('description', description.trim());
      fd.set('service', service);
      fd.set('priority', priority);
      fd.set('entity_id', entityId);
      fd.set('page_path', pathname || '/');
      if (screenshotDataUrl) fd.set('screenshot_data_url', screenshotDataUrl);
      if (screenshotNote) fd.set('screenshot_note', screenshotNote);
      if (docFile) fd.set('document', docFile);

      const res = await createHelpDeskTicketAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOkMsg(res.message);
      setTitle('');
      setDescription('');
      setDocFile(null);
      window.setTimeout(() => setVisible(false), 900);
    });
  }

  return (
    <CreateTicketModalContext.Provider value={value}>
      {children}
      {visible ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-ticket-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2
                  id="create-ticket-title"
                  className="font-heading text-lg text-foreground"
                >
                  Create ticket
                </h2>
                <p className="text-xs text-muted-foreground">
                  Page context: {pathname}. A screenshot is attached when
                  allowed.
                </p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={close}>
                Close
              </Button>
            </div>

            <div className="grid gap-3">
              <div className="space-y-1">
                <Label htmlFor="ct-title">Subject *</Label>
                <Input
                  id="ct-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct-desc">Description</Label>
                <textarea
                  id="ct-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="ct-service">Service</Label>
                  <select
                    id="ct-service"
                    value={service}
                    onChange={(e) =>
                      setService(e.target.value as (typeof SS_SERVICES)[number])
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {SS_SERVICES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ct-pri">Priority</Label>
                  <select
                    id="ct-pri"
                    value={priority}
                    onChange={(e) =>
                      setPriority(
                        e.target.value as (typeof TICKET_PRIORITIES)[number],
                      )
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct-company">Company</Label>
                <CompanySelect
                  id="ct-company"
                  value={entityId}
                  onChange={setEntityId}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ct-doc">Attach document (optional)</Label>
                <Input
                  id="ct-doc"
                  type="file"
                  onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                />
              </div>
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              {okMsg ? (
                <p className="text-sm text-emerald-700">{okMsg}</p>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={pending || title.trim().length < 3}
                  onClick={submit}
                >
                  {pending ? 'Submitting…' : 'Submit ticket'}
                </Button>
              </div>
            </div>
          </div>
        </div>
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
