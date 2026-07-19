import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CreateTicketModal } from './CreateTicketModal';
import type { TicketCategory } from '../lib/ticketTypes';
import type { SalesUser } from '../lib/types';

type CreateTicketContextValue = {
  openCreateTicket: (opts?: { category?: TicketCategory }) => void;
};

const CreateTicketContext = createContext<CreateTicketContextValue | null>(null);

export function useCreateTicket(): CreateTicketContextValue {
  const ctx = useContext(CreateTicketContext);
  if (!ctx) {
    throw new Error('useCreateTicket must be used within CreateTicketProvider');
  }
  return ctx;
}

export function useCreateTicketOptional(): CreateTicketContextValue | null {
  return useContext(CreateTicketContext);
}

export function CreateTicketProvider({
  salesUser,
  children,
}: {
  salesUser: SalesUser;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [prefCategory, setPrefCategory] = useState<TicketCategory | null>(null);

  const openCreateTicket = useCallback((opts?: { category?: TicketCategory }) => {
    setPrefCategory(opts?.category ?? null);
    setOpen(true);
  }, []);

  const onClose = useCallback(() => {
    setOpen(false);
    setPrefCategory(null);
  }, []);

  const value = useMemo(() => ({ openCreateTicket }), [openCreateTicket]);

  return (
    <CreateTicketContext.Provider value={value}>
      {children}
      <CreateTicketModal
        salesUser={salesUser}
        open={open}
        preferredCategory={prefCategory}
        onClose={onClose}
      />
    </CreateTicketContext.Provider>
  );
}
