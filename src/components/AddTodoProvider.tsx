import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AddTodoModal, type AddTodoDealPrefill } from './AddTodoModal';
import type { SalesUser } from '../lib/types';

export type { AddTodoDealPrefill };

type AddTodoContextValue = {
  openAddTodo: (deal?: AddTodoDealPrefill) => void;
};

const AddTodoContext = createContext<AddTodoContextValue | null>(null);

export function useAddTodo(): AddTodoContextValue {
  const ctx = useContext(AddTodoContext);
  if (!ctx) {
    throw new Error('useAddTodo must be used within AddTodoProvider');
  }
  return ctx;
}

/** Optional hook when the provider may be absent (rare). */
export function useAddTodoOptional(): AddTodoContextValue | null {
  return useContext(AddTodoContext);
}

export function AddTodoProvider({
  salesUser,
  children,
}: {
  salesUser: SalesUser;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [deal, setDeal] = useState<AddTodoDealPrefill | null>(null);

  const openAddTodo = useCallback((prefill?: AddTodoDealPrefill) => {
    setDeal(prefill ?? null);
    setOpen(true);
  }, []);

  const onClose = useCallback(() => {
    setOpen(false);
    setDeal(null);
  }, []);

  const value = useMemo(() => ({ openAddTodo }), [openAddTodo]);

  return (
    <AddTodoContext.Provider value={value}>
      {children}
      <AddTodoModal
        salesUser={salesUser}
        open={open}
        dealPrefill={deal}
        onClose={onClose}
      />
    </AddTodoContext.Provider>
  );
}
