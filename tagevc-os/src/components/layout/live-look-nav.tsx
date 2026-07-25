'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Search, X } from 'lucide-react';
import {
  searchLiveLookUsersAction,
  startLiveLookAction,
} from '@/app/(app)/live-look/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  company_name: string;
};

export function LiveLookNavControl() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      start(async () => {
        const res = await searchLiveLookUsersAction(query);
        if (res.ok) setUsers(res.users);
        else setError(res.error);
      });
    }, 180);
    return () => clearTimeout(t);
  }, [open, query]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
          'text-muted-foreground hover:bg-muted hover:text-foreground',
          open && 'bg-muted text-foreground',
        )}
      >
        <Eye className="size-4 shrink-0 opacity-70" />
        <span className="truncate font-medium">Live Look</span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-50 mt-1 rounded-lg border border-border bg-background p-2 shadow-lg">
          <div className="mb-2 flex items-center gap-1">
            <Search className="size-3.5 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users…"
              className="h-8 text-xs"
            />
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <p className="mb-1 px-1 text-[10px] text-muted-foreground">
            Read-only observation · target is not notified
          </p>
          {error ? (
            <p className="px-1 text-xs text-destructive">{error}</p>
          ) : null}
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {users.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  disabled={pending}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={() =>
                    start(async () => {
                      const res = await startLiveLookAction(u.id);
                      if (!res.ok) {
                        setError(res.error);
                        return;
                      }
                      setOpen(false);
                      router.refresh();
                    })
                  }
                >
                  <div className="font-medium text-foreground">
                    {u.full_name || u.email}
                  </div>
                  <div className="text-muted-foreground">
                    {u.company_name} · {u.role} · {u.email}
                  </div>
                </button>
              </li>
            ))}
            {!pending && users.length === 0 ? (
              <li className="px-2 py-2 text-xs text-muted-foreground">
                No users found
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
