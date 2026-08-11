import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAIN_NAV, flattenNavItems } from '@/lib/nav';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('sidebar messaging control (shared shell)', () => {
  it('ships the split control with both presence states', () => {
    const twin = read('src/lib/platform/shell/sidebar-messaging-control.tsx');
    expect(twin).toMatch(/Messaging/);
    expect(twin).toMatch(/bg-emerald-500/);
    expect(twin).toMatch(/bg-red-500/);
    expect(twin).toMatch(/Do Not Disturb/);
    expect(twin).toMatch(/DropdownMenuRadioGroup/);
  });

  it('lets cross-origin subsidiary portals open the Tage Message Center', () => {
    const twin = read('src/lib/platform/shell/sidebar-messaging-control.tsx');
    expect(twin).toMatch(/external/);
    expect(twin).toMatch(/target="_blank"/);
  });

  it('mounts the control in the brand header, above the nav', () => {
    const sidebar = read('src/components/layout/app-sidebar.tsx');
    expect(sidebar).toMatch(/SidebarMessagingControl/);
    expect(sidebar.indexOf('SidebarMessagingControl')).toBeLessThan(
      sidebar.indexOf('<nav'),
    );
  });

  it('keeps Messaging out of the left nav on every entity OS', () => {
    expect(flattenNavItems(MAIN_NAV).some((n) => n.href === '/messages')).toBe(
      false,
    );
    expect(MAIN_NAV.some((n) => n.label === 'Message Center')).toBe(false);
  });
});
