import { describe, expect, it } from 'vitest';
import { canTransition } from './state-machine';

describe('campaign state machine', () => {
  it('allows draft → pending_approval → approved → sending → sent', () => {
    expect(canTransition('draft', 'pending_approval')).toBe(true);
    expect(canTransition('pending_approval', 'approved')).toBe(true);
    expect(canTransition('approved', 'sending')).toBe(true);
    expect(canTransition('sending', 'sent')).toBe(true);
    expect(canTransition('sent', 'draft')).toBe(false);
  });
});
