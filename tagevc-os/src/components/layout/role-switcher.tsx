'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  startImpersonationAction,
  stopImpersonationAction,
} from '@/app/(app)/impersonation/actions';
import { APP_ROLE_LABELS, type AppRole } from '@/lib/types/roles';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

type Props = {
  roles: AppRole[];
  current: AppRole | null;
};

export function RoleSwitcher({ roles, current }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(current ?? roles[0] ?? '');

  function apply() {
    setError(null);
    startTransition(async () => {
      if (!selected) return;
      const result = await startImpersonationAction(selected);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function exit() {
    setError(null);
    startTransition(async () => {
      await stopImpersonationAction();
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 p-3">
      <Label
        htmlFor="role-switcher"
        className="text-[10px] font-medium tracking-[0.14em] text-sidebar-foreground/60 uppercase"
      >
        Role switcher
      </Label>
      <select
        id="role-switcher"
        value={selected}
        disabled={pending}
        onChange={(e) => setSelected(e.target.value)}
        className="h-8 w-full rounded-md border border-sidebar-border bg-sidebar px-2 text-xs text-sidebar-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {roles.map((role) => (
          <option key={role} value={role}>
            {APP_ROLE_LABELS[role]}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !selected}
          onClick={apply}
          className="h-7 flex-1 bg-[#3a414f] text-xs text-white hover:bg-[#535c63]"
        >
          {pending ? '…' : current ? 'Switch' : 'View as'}
        </Button>
        {current ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={exit}
            className="h-7 border-sidebar-border bg-transparent text-xs text-sidebar-foreground hover:bg-sidebar-accent"
          >
            Exit
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
