'use client';

import { useRouter } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';

export function EosActionForm({
  action,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<unknown>;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <form
      className={className ?? 'flex flex-wrap items-end gap-2'}
      action={(fd) => {
        startTransition(async () => {
          await action(fd);
          router.refresh();
        });
      }}
    >
      {children}
    </form>
  );
}
