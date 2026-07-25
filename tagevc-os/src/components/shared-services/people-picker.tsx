'use client';

import { useEffect, useState, useTransition } from 'react';
import { Search, UserMinus, X } from 'lucide-react';
import { searchManagerCandidatesAction } from '@/app/(app)/shared-services/hr/actions-hris';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type PeoplePickerValue = {
  id: string;
  email: string;
  full_name: string | null;
  role_label?: string;
  company_name?: string;
};

type Props = {
  /** Hidden input name written into the surrounding form. */
  name?: string;
  label?: string;
  initial?: PeoplePickerValue | null;
  disabled?: boolean;
  className?: string;
  onChange?: (value: PeoplePickerValue | null) => void;
};

export function PeoplePicker({
  name = 'manager_profile_id',
  label = 'Manager',
  initial = null,
  disabled = false,
  className,
  onChange,
}: Props) {
  const [selected, setSelected] = useState<PeoplePickerValue | null>(initial);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PeoplePickerValue[]>([]);
  const [pending, start] = useTransition();
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setSelected(initial);
  }, [initial?.id]);

  useEffect(() => {
    if (!open || disabled) return;
    const t = setTimeout(() => {
      start(async () => {
        const res = await searchManagerCandidatesAction(query);
        if (res.ok) {
          setRows(
            res.users.map((u) => ({
              id: u.id,
              email: u.email,
              full_name: u.full_name,
              role_label: u.role_label,
              company_name: u.company_name,
            })),
          );
        } else {
          setRows([]);
        }
      });
    }, 180);
    return () => clearTimeout(t);
  }, [open, query, disabled]);

  const pick = (row: PeoplePickerValue) => {
    setSelected(row);
    setOpen(false);
    setConfirmClear(false);
    onChange?.(row);
  };

  const clear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setSelected(null);
    setConfirmClear(false);
    onChange?.(null);
  };

  return (
    <div className={cn('relative space-y-1.5', className)}>
      <Label>{label}</Label>
      <input type="hidden" name={name} value={selected?.id ?? ''} />
      {selected ? (
        <div className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {selected.full_name || selected.email}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {selected.email}
              {selected.role_label ? ` · ${selected.role_label}` : ''}
              {selected.company_name ? ` · ${selected.company_name}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setOpen(true);
                setConfirmClear(false);
              }}
            >
              Change
            </Button>
            <Button
              type="button"
              size="sm"
              variant={confirmClear ? 'destructive' : 'ghost'}
              disabled={disabled}
              onClick={clear}
              title="Clear manager"
            >
              <UserMinus className="size-3.5" />
              {confirmClear ? 'Confirm' : null}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-left text-sm',
            'text-muted-foreground hover:border-foreground/30 hover:text-foreground',
            disabled && 'opacity-60',
          )}
        >
          <Search className="size-3.5 shrink-0" />
          <span>No manager assigned — search people…</span>
        </button>
      )}

      {open ? (
        <div className="absolute left-0 right-0 z-50 mt-1 rounded-lg border border-border bg-background p-2 shadow-lg">
          <div className="mb-2 flex items-center gap-1">
            <Search className="size-3.5 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or email…"
              className="h-8 text-xs"
              disabled={disabled}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {rows.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  disabled={pending || disabled}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={() => pick(u)}
                >
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <span className="truncate">{u.full_name || u.email}</span>
                    {u.role_label ? (
                      <Badge variant="outline" className="font-normal">
                        {u.role_label}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="truncate text-muted-foreground">
                    {u.email}
                    {u.company_name ? ` · ${u.company_name}` : ''}
                  </div>
                </button>
              </li>
            ))}
            {!pending && rows.length === 0 ? (
              <li className="px-2 py-2 text-xs text-muted-foreground">
                No active managers found
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
