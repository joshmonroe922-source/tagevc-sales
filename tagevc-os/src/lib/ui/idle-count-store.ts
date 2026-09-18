'use client';

import { afterIdle } from '@/lib/ui/after-idle';

type IdleCountStoreOptions = {
  fetchCount: () => Promise<number>;
  subscribeRealtime?: (onChange: () => void) => () => void;
};

/**
 * One fetch + optional realtime channel, shared across duplicate badge mounts
 * (desktop Messaging control + nav link, Network inbox nav + footer).
 */
export function createIdleCountStore(options: IdleCountStoreOptions) {
  let count = 0;
  let started = false;
  const listeners = new Set<(next: number) => void>();
  let stopSideEffects: (() => void) | undefined;

  function emit() {
    for (const listener of listeners) listener(count);
  }

  async function refresh() {
    try {
      const next = await options.fetchCount();
      if (next === count) return;
      count = next;
      emit();
    } catch {
      /* keep last known count */
    }
  }

  function start() {
    if (started) return;
    started = true;
    const cancelIdle = afterIdle(() => {
      void refresh();
      const onFocus = () => void refresh();
      window.addEventListener('focus', onFocus);
      const stopRealtime = options.subscribeRealtime?.(() => void refresh());
      stopSideEffects = () => {
        window.removeEventListener('focus', onFocus);
        stopRealtime?.();
      };
    });
    const prior = stopSideEffects;
    stopSideEffects = () => {
      cancelIdle();
      prior?.();
    };
  }

  return {
    subscribe(listener: (next: number) => void) {
      listeners.add(listener);
      listener(count);
      start();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
