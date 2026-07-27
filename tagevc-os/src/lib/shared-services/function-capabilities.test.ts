import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { getSscFunctionCapabilities } from '@/lib/shared-services/function-capabilities';
import { SSC_FUNCTIONS } from '@/lib/shared-services/ssc-checklist/types';

describe('SSC function capabilities catalog', () => {
  it('exposes capabilities for every SSC function', () => {
    for (const fn of SSC_FUNCTIONS) {
      const caps = getSscFunctionCapabilities(fn, null);
      assert.ok(caps.length >= 4, `${fn} should list capabilities`);
      assert.ok(
        caps.some((c) => c.href.includes('/checklists')),
        `${fn} should include period checklist`,
      );
      assert.ok(
        caps.every((c) => c.title && c.description && c.href),
        `${fn} capabilities must be complete`,
      );
    }
  });

  it('scopes checklist and audit links when entity is set', () => {
    const caps = getSscFunctionCapabilities('hr', 'ENT-R619');
    const checklist = caps.find((c) => c.id === 'hr-checklist');
    const screening = caps.find((c) => c.id === 'hr-screening');
    assert.ok(checklist?.href.includes('entity=ENT-R619'));
    assert.ok(screening?.href.includes('entity=ENT-R619'));
  });

  it('keeps Legal desk ops and leaves DocuSign/docs under Admin', () => {
    const caps = getSscFunctionCapabilities('legal', null);
    const titles = caps.map((c) => c.title);
    assert.deepEqual(titles, [
      'Legal tasks',
      'Counsel desk',
      'Legal tickets',
      'Audits',
    ]);
    assert.ok(!titles.includes('DocuSign'));
    assert.ok(!titles.includes('Document Library'));
    assert.ok(caps.every((c) => c.badge !== 'Admin'));
  });
});
