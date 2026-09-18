'use client';

import { useEffect, useState } from 'react';

type IdleCountStore = {
  subscribe: (listener: (next: number) => void) => () => void;
};

export function useIdleCount(store: IdleCountStore) {
  const [count, setCount] = useState(0);
  useEffect(() => store.subscribe(setCount), [store]);
  return count;
}
