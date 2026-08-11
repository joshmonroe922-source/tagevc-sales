/** @vitest-environment jsdom */
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/(app)/entity-os/actions', () => ({
  switchEntityOsAction: async () => ({ ok: true, entityId: 'ENT-R619' }),
  exitEntityOsAction: async () => ({ ok: true, entityId: null }),
}));

import { EntityOsSwitcher } from '../entity-os-switcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { EntityOsOption } from '@/lib/rbac/entity-os';

afterEach(() => cleanup());

const options: EntityOsOption[] = [
  { entityId: 'ENT-FIRM', label: 'Tage VC', shortLabel: 'Tage VC', isSubsidiary: false },
  { entityId: 'ENT-R619', label: 'Recruit 619', shortLabel: 'Recruit 619', isSubsidiary: true },
  { entityId: 'ENT-SIGNENT', label: 'Signent HR', shortLabel: 'Signent HR', isSubsidiary: true },
];

describe('EntityOsSwitcher', () => {
  it('opens the operating system menu without throwing', async () => {
    let thrown: unknown = null;
    try {
      render(
        createElement(EntityOsSwitcher, {
          options,
          active: null,
          canSwitch: true,
          fallbackLabel: 'Tage VC',
        }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: /switch entity operating system/i }),
      );
      await waitFor(() => {
        expect(screen.getByText('Recruit 619')).toBeTruthy();
        expect(screen.getByText('Signent HR')).toBeTruthy();
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeNull();
  });

  it('exposes every option as a menu item', async () => {
    render(
      createElement(EntityOsSwitcher, {
        options,
        active: 'ENT-R619',
        canSwitch: true,
        fallbackLabel: 'Tage VC',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /switch entity operating system/i }),
    );
    await waitFor(() => {
      expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    });
  });
});

describe('DropdownMenuLabel outside a group', () => {
  it('renders instead of crashing the popup', async () => {
    render(
      createElement(
        DropdownMenu,
        null,
        createElement(DropdownMenuTrigger, null, 'Open'),
        createElement(
          DropdownMenuContent,
          null,
          createElement(DropdownMenuLabel, null, 'Ungrouped label'),
          createElement(DropdownMenuItem, null, 'Only item'),
        ),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(screen.getByText('Ungrouped label')).toBeTruthy();
    });
  });
});
