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

  it('pins left sidebar to viewport while main scrolls', () => {
    const sidebar = readFileSync(
      join(process.cwd(), 'src/components/layout/app-sidebar.tsx'),
      'utf8',
    );
    assert.match(sidebar, /sticky top-0/);
    assert.match(sidebar, /h-dvh/);
    assert.match(sidebar, /self-start/);
    assert.match(sidebar, /overflow-y-auto/);

    const layout = readFileSync(
      join(process.cwd(), 'src/app/(app)/layout.tsx'),
      'utf8',
    );
    assert.match(layout, /h-dvh max-h-dvh/);
    assert.match(layout, /overflow-y-auto/);
    assert.match(layout, /overflow-hidden/);
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
      join(process.cwd(), 'src/lib/view-mode.ts'),
      'utf8',
    );
    assert.match(viewMode, /role-dashboard/);
    assert.match(viewMode, /dashboard-operating-cadence/);
    assert.match(viewMode, /command-center-funnel/);
    assert.match(viewMode, /firm-ops-command-metrics/);
  });
});
