import { describe, expect, it } from 'vitest';
import { buildComplianceFooter, injectFooter, marketingHeaders } from '@/lib/campaign/core/footer';
import { renderMergeTemplate } from '@/lib/campaign/core/merge';
import { evaluateSegment, filterContactsBySegment } from '@/lib/campaign/core/segment-dsl';
import { scoreEngagement } from '@/lib/campaign/core/engagement';
import { resolveDeliveryPlane } from '@/lib/campaign/mta';
import { canTransition } from '@/lib/campaign/core/state-machine';
import { checkMutex, DEFAULT_MUTEX_POLICY } from '@/lib/campaign/core/mutex';
import { PERMISSIONED_LIFECYCLES } from '@/lib/campaign/core/types';
import { canSendMarketing } from '@/lib/campaign/core/consent';

describe('ecc core', () => {
  it('permissioned lifecycle keeps unsub', () => {
    expect(PERMISSIONED_LIFECYCLES.has('active')).toBe(true);
    expect(buildComplianceFooter({ physicalAddress: 'x', unsubUrl: 'https://u', prefsUrl: 'https://p', lifecycle: 'Active' }).toLowerCase()).toContain('unsub');
  });
  it('footer idempotent', () => {
    const a = injectFooter('<p>a</p>', buildComplianceFooter({ physicalAddress: 'x', unsubUrl: 'https://u', prefsUrl: 'https://p' }));
    expect(injectFooter(a, 'x')).toBe(a);
  });
  it('rfc8058 headers', () => {
    expect(marketingHeaders({ unsubUrl: 'https://u', listId: 'l', campaignId: 'c', entityId: 'ENT-FIRM' })['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
  it('merge escapes', () => {
    expect(renderMergeTemplate('{{contact.first_name}}', { contact: { first_name: '<b>' } }).html).toContain('&lt;b&gt;');
  });
  it('segment filter', () => {
    expect(filterContactsBySegment([{ id: '1', lifecycle: 'Active' }, { id: '2', lifecycle: 'Target' }], { op: 'and', rules: [{ field: 'lifecycle', operator: 'eq', value: 'Active' }] })).toHaveLength(1);
  });
  it('evaluateSegment', () => {
    expect(evaluateSegment({ id: '1', lifecycle: 'Active' }, { op: 'and', rules: [{ field: 'lifecycle', operator: 'eq', value: 'Active' }] })).toBe(true);
  });
  it('engagement + plane + mutex + gate + transition', () => {
    expect(scoreEngagement({ openCount: 1, clickCount: 1 })).toBeGreaterThan(scoreEngagement({ openCount: 1 }));
    expect(resolveDeliveryPlane({ plane: 'auto', sequenceType: 'sequence', hasOwner: true })).toBe('graph');
    expect(resolveDeliveryPlane({ plane: 'auto' })).toBe('controlled_graph');
    expect(canTransition('draft', 'pending_approval')).toBe(true);
    expect(checkMutex({ active: [{ id: 'e1', journeyId: 'j1', mutexGroup: 'x' }], nextMutexGroup: 'x', policy: DEFAULT_MUTEX_POLICY }).ok).toBe(false);
    expect(canSendMarketing({ email: 'a@b.com', permission: 'opted_out' }).allow).toBe(false);
  });
});
