import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  isNavItemActive,
  isPathMatch,
  resolveActiveNavHref,
} from '@/lib/platform/shell/nav-active';

describe('nav active route (shared shell)', () => {
  const hrefs = [
    '/home',
    '/sales',
    '/go/my-card',
    '/go/my-card/contacts',
    '/shared-services/af',
    '/shared-services/af/accounting',
    '/shared-services/af/finance',
    '/admin',
    '/admin/org-chart',
  ] as const;

  it('matches exact and nested paths', () => {
    assert.equal(isPathMatch('/sales', '/sales'), true);
    assert.equal(isPathMatch('/sales/proposals', '/sales'), true);
    assert.equal(isPathMatch('/sales', '/home'), false);
    assert.equal(
      isPathMatch('/shared-services/marketing/ecc', '/shared-services/marketing', {
        exact: true,
      }),
      false,
    );
  });

  it('picks the longest matching nav href so only one tab is active', () => {
    assert.equal(
      resolveActiveNavHref('/shared-services/af/accounting', hrefs),
      '/shared-services/af/accounting',
    );
    assert.equal(
      resolveActiveNavHref('/shared-services/af', hrefs),
      '/shared-services/af',
    );
    assert.equal(
      resolveActiveNavHref('/go/my-card/contacts', hrefs),
      '/go/my-card/contacts',
    );
    assert.equal(resolveActiveNavHref('/go/my-card', hrefs), '/go/my-card');
    assert.equal(resolveActiveNavHref('/admin/org-chart', hrefs), '/admin/org-chart');
    assert.equal(resolveActiveNavHref('/admin', hrefs), '/admin');
    assert.equal(resolveActiveNavHref('/sales/proposals/abc', hrefs), '/sales');
  });

  it('marks only the winning item active', () => {
    assert.equal(
      isNavItemActive('/shared-services/af/finance', '/shared-services/af', hrefs),
      false,
    );
    assert.equal(
      isNavItemActive(
        '/shared-services/af/finance',
        '/shared-services/af/finance',
        hrefs,
      ),
      true,
    );
    assert.equal(
      isNavItemActive('/admin/org-chart', '/admin', hrefs),
      false,
    );
    assert.equal(
      isNavItemActive('/admin/org-chart', '/admin/org-chart', hrefs),
      true,
    );
  });
});
