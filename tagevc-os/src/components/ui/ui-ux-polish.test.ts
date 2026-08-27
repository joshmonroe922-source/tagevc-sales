import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

describe('UI/UX polish primitives', () => {
  it('ships PageHeader, ErrorState, Skeleton, EmptyState', () => {
    for (const file of [
      'src/components/ui/page-header.tsx',
      'src/components/ui/error-state.tsx',
      'src/components/ui/skeleton.tsx',
      'src/components/ui/empty-state.tsx',
    ]) {
      const body = readFileSync(join(process.cwd(), file), 'utf8');
      assert.ok(body.length > 50, file);
    }
  });

  it('adds SSC route loading skeleton', () => {
    const body = readFileSync(
      join(process.cwd(), 'src/app/(app)/shared-services/loading.tsx'),
      'utf8',
    );
    assert.match(body, /PageSkeleton/);
  });

  it('function home chrome exposes Needs attention and Active period', () => {
    const chrome = readFileSync(
      join(
        process.cwd(),
        'src/components/shared-services/ssc-function-home-chrome.tsx',
      ),
      'utf8',
    );
    assert.match(chrome, /SscFunctionCapabilities/);
    assert.match(chrome, /Needs attention/);
    assert.match(chrome, /time: 'active'/);
    assert.match(chrome, /Overdue/);
    assert.match(chrome, /Nothing needing attention/);
    assert.match(chrome, /No open active-period work/);
    assert.doesNotMatch(chrome, /Nothing overdue or due today/);
  });

  it('ships In this service capabilities grid', () => {
    const caps = readFileSync(
      join(
        process.cwd(),
        'src/components/shared-services/ssc-function-capabilities.tsx',
      ),
      'utf8',
    );
    assert.match(caps, /In this service/);
    assert.match(caps, /ViewModeLayout/);
  });

  it('checklist client windows tasks and sticks filters', () => {
    const body = readFileSync(
      join(
        process.cwd(),
        'src/components/shared-services/ssc-checklist-client.tsx',
      ),
      'utf8',
    );
    assert.match(body, /TASK_WINDOW/);
    assert.match(body, /sticky top-0/);
    assert.match(body, /EmptyState/);
  });

  it('nav accordion respects reduced motion', () => {
    const body = readFileSync(
      join(process.cwd(), 'src/components/layout/app-sidebar.tsx'),
      'utf8',
    );
    assert.match(body, /motion-reduce:transition-none/);
  });

  it('nav accordion uses exclusive sibling expand on user toggle', () => {
    const body = readFileSync(
      join(process.cwd(), 'src/components/layout/app-sidebar.tsx'),
      'utf8',
    );
    assert.match(body, /exclusiveAccordionToggle/);
    assert.match(body, /accordionSiblingLabels/);
  });

  it('pins left sidebar to viewport while main scrolls', () => {
    const sidebar = readFileSync(
      join(process.cwd(), 'src/components/layout/app-sidebar.tsx'),
      'utf8',
    );
    assert.match(sidebar, /sticky top-0/);
    assert.match(sidebar, /h-dvh/);
    assert.match(sidebar, /self-start/);
    assert.match(sidebar, /overflow-y-auto/);
    assert.match(sidebar, /hidden.*md:flex|md:flex/);

    const layout = readFileSync(
      join(process.cwd(), 'src/app/(app)/layout.tsx'),
      'utf8',
    );
    assert.match(layout, /h-dvh max-h-dvh/);
    assert.match(layout, /overflow-hidden/);
    assert.match(layout, /MobileNavDrawer/);

    // The main scroller lives in AppMain so messaging can opt out of page scroll.
    const main = readFileSync(
      join(process.cwd(), 'src/components/layout/app-main.tsx'),
      'utf8',
    );
    assert.match(layout, /<AppMain>/);
    assert.match(main, /overflow-y-auto/);

    const frame = readFileSync(
      join(process.cwd(), 'src/components/layout/app-content-frame.tsx'),
      'utf8',
    );
    assert.match(frame, /w-full max-w-none/);
    assert.doesNotMatch(frame, /max-w-6xl/);
    assert.doesNotMatch(frame, /mx-auto max-w-/);
  });

  it('ships phone Menu drawer in AppTopBar below md', () => {
    const drawer = readFileSync(
      join(process.cwd(), 'src/components/layout/mobile-nav-drawer.tsx'),
      'utf8',
    );
    assert.match(drawer, /md:hidden/);
    assert.match(drawer, /Open navigation menu/);
    assert.match(drawer, /SheetContent/);
    // Dual-sidebar crash fix: mount panel only while drawer is open.
    assert.match(drawer, /open \? children : null/);

    const topBar = readFileSync(
      join(process.cwd(), 'src/components/help-desk/help-desk-shell.tsx'),
      'utf8',
    );
    assert.match(topBar, /mobileNav/);
    assert.match(topBar, /AppTopBarShell/);

    // Mobile visual order lives in shared AppTopBarShell (Create Ticket | Alerts | Menu).
    const shell = readFileSync(
      join(process.cwd(), 'src/lib/platform/shell/app-top-bar.tsx'),
      'utf8',
    );
    assert.match(shell, /order-3 md:order-1/);
    assert.match(shell, /order-1 md:order-4/);
  });

  it('ships Cards | List on Dashboard and Command Center boards', () => {
    const roleDash = readFileSync(
      join(process.cwd(), 'src/components/dashboard/role-dashboard-client.tsx'),
      'utf8',
    );
    assert.match(roleDash, /ViewModeToggle/);
    assert.match(roleDash, /Cards/);
    assert.match(roleDash, /<table/);

    const metricBoard = readFileSync(
      join(process.cwd(), 'src/components/dashboard/dashboard-metric-board.tsx'),
      'utf8',
    );
    assert.match(metricBoard, /ViewModeLayout/);
    assert.match(metricBoard, /<table/);

    const viewMode = readFileSync(
      join(process.cwd(), 'src/lib/platform/view-mode/index.ts'),
      'utf8',
    );
    assert.match(viewMode, /role-dashboard/);
    assert.match(viewMode, /dashboard-operating-cadence/);
    assert.match(viewMode, /command-center-funnel/);
    assert.match(viewMode, /firm-ops-command-metrics/);
    assert.match(viewMode, /af-hub-accounting/);
    assert.match(viewMode, /personal-finance-modules/);
    assert.match(viewMode, /net-worth-breakdown/);
  });

  it('ships platform ModuleLinkBoard for A&F / Personal card sections', () => {
    const board = readFileSync(
      join(process.cwd(), 'src/components/platform/module-link-board.tsx'),
      'utf8',
    );
    assert.match(board, /ViewModeLayout/);
    assert.match(board, /<table/);
    const afGrid = readFileSync(
      join(process.cwd(), 'src/components/af/af-module-grid.tsx'),
      'utf8',
    );
    assert.match(afGrid, /ModuleLinkBoard/);
    const shell = readFileSync(
      join(process.cwd(), 'docs/SUBSIDIARY_OS_SHELL.md'),
      'utf8',
    );
    assert.match(shell, /Cards \| List/);
    assert.match(shell, /module-link-board/);
  });
});
