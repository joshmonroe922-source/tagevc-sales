/** @vitest-environment jsdom */
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href, ...rest }, children),
}));

/**
 * Emulates Supabase realtime: same topic reuses the channel; calling .on()
 * after subscribe() throws (the Menu crash on dual AppSidebar mount).
 */
function createRealtimeClient() {
  const channels = new Map<string, { subscribed: boolean; on: (...a: unknown[]) => unknown; subscribe: () => unknown }>();
  return {
    auth: { signOut: vi.fn() },
    channel(topic: string) {
      const existing = channels.get(topic);
      if (existing) return existing;
      const chan = {
        subscribed: false,
        on() {
          if (chan.subscribed) {
            throw new Error(
              `cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`,
            );
          }
          return chan;
        },
        subscribe() {
          chan.subscribed = true;
          return chan;
        },
      };
      channels.set(topic, chan);
      return chan;
    },
    removeChannel: vi.fn(),
  };
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => createRealtimeClient(),
}));

vi.mock('@/app/(app)/messages/actions', () => ({
  getUnreadTotalAction: async () => ({ ok: true, count: 0 }),
}));
vi.mock('@/app/(app)/activity/actions', () => ({
  getUnreadNotificationsCountAction: async () => ({ ok: true, count: 0 }),
}));
vi.mock('@/app/(app)/messages/presence-actions', () => ({
  getMyAvailabilityAction: async () => ({ ok: true, status: 'available', source: 'manual' }),
  setMyAvailabilityAction: async () => ({ ok: true, status: 'available', source: 'manual' }),
}));
vi.mock('@/app/(app)/impersonation/actions', () => ({
  startImpersonationAction: async () => ({ ok: true }),
  stopImpersonationAction: async () => ({ ok: true }),
}));
vi.mock('@/app/(app)/live-look/actions', () => ({
  searchLiveLookUsersAction: async () => ({ ok: true, users: [] }),
  startLiveLookAction: async () => ({ ok: true }),
  stopLiveLookAction: async () => ({ ok: true }),
}));

import { MobileNavDrawer } from '../mobile-nav-drawer';
import { AppSidebar } from '../app-sidebar';
import type { AppRole } from '@/lib/types/roles';

afterEach(() => cleanup());

const sidebarProps = {
  role: 'visionary' as AppRole,
  realRole: 'visionary' as AppRole,
  fullName: 'Josh Monroe',
  email: 'joshmonroe@tagevc.com',
  impersonatingAs: null as AppRole | null,
  impersonatableRoles: ['partner', 'coo'] as AppRole[],
  liveLookActive: false,
  entityId: 'ENT-FIRM',
};

describe('MobileNavDrawer + dual AppSidebar (phone Menu)', () => {
  it('opens with panel beside desktop sidebar without realtime channel throw', async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });

    let thrown: unknown = null;
    try {
      render(
        createElement(
          'div',
          null,
          createElement(AppSidebar, sidebarProps),
          createElement(
            MobileNavDrawer,
            null,
            createElement(AppSidebar, { ...sidebarProps, variant: 'panel' }),
          ),
        ),
      );
      fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
      await waitFor(() => {
        expect(document.body.textContent || '').toContain(
          'Performance Management',
        );
      });
    } catch (e) {
      thrown = e;
    }

    spy.mockRestore();
    expect(thrown).toBeNull();
    const fatal = errors.filter((args) =>
      String((args as unknown[])[0] ?? '').includes('cannot add') ||
      (args as unknown[]).some((a) => a instanceof Error && String(a.message).includes('cannot add')),
    );
    expect(fatal).toEqual([]);
  });
});
